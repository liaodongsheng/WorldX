import { getDb, getDbPath } from "../store/db.js";
import { appContext } from "../services/app-context.js";
import type { ActionDecision, SimulationEvent } from "../types/index.js";
import {
  createXiuxianStoryModule,
  type XiuxianEvent,
  type XiuxianRuntime,
} from "../../../modules/xiuxian-story/src/index.mjs";

type PersistedState = {
  version: 1;
  protagonistBinding: { playerId: string; characterId: string } | null;
  directorState: Record<string, unknown> | null;
  accidentState: Record<string, unknown> | null;
  causalityState: Record<string, unknown> | null;
  multiplayerState: Record<string, unknown> | null;
  cultivationCharacters: Record<string, Record<string, any>>;
};

const STATE_KEY = "runtime";

export class XiuxianStoryService {
  private runtime: XiuxianRuntime | null = null;
  private activeDbPath: string | null = null;
  private cultivationCharacters: PersistedState["cultivationCharacters"] = {};

  async getStatus(): Promise<Record<string, unknown>> {
    const runtime = await this.ensureRuntime();
    const binding = runtime.protagonist.binding;
    return {
      enabled: true,
      moduleId: runtime.id,
      version: runtime.version,
      protagonist: binding,
      cultivation: binding ? this.cultivationCharacters[binding.characterId] ?? null : null,
      story: runtime.director.guidance(),
      accident: runtime.accidents.state.active ?? null,
      causality: runtime.causality.state,
    };
  }

  async bindProtagonist(input: { playerId: string; characterId: string; characterName: string }) {
    const runtime = await this.ensureRuntime();
    const binding = runtime.protagonist.bind({ playerId: input.playerId, characterId: input.characterId });
    runtime.director.bindProtagonist(input.characterId);
    if (appContext.hasWorld) appContext.worldManager.setGlobal(`player_controlled:${input.characterId}`, "true");
    if (!this.cultivationCharacters[input.characterId]) {
      this.cultivationCharacters[input.characterId] = runtime.cultivation.createCharacter({
        id: input.characterId,
        name: input.characterName,
      });
    }
    this.persist();
    return { binding, cultivation: this.cultivationCharacters[input.characterId], story: runtime.director.guidance() };
  }

  async submitAction(input: { playerId: string; type: string; targetId?: string | null; payload?: Record<string, any> }) {
    const runtime = await this.ensureRuntime();
    const binding = this.requirePlayer(runtime, input.playerId);
    const intent = runtime.protagonist.submitIntent(input);
    const character = this.requireCultivationCharacter(binding.characterId);
    let event: XiuxianEvent;
    let actionResult: Record<string, unknown>;

    if (input.type === "meditate" || input.type === "train") {
      const result = runtime.cultivation.meditate(character, {
        hours: input.payload?.hours ?? 1,
        techniqueId: input.payload?.techniqueId ?? "basic-breathing",
      });
      this.cultivationCharacters[binding.characterId] = result.state;
      event = result.event;
      actionResult = { cultivation: result.state };
    } else {
      event = {
        id: `player-action-${Date.now()}`,
        type: "player_action",
        actorId: binding.characterId,
        targetId: input.targetId ?? null,
        tags: ["xiuxian", "player_action", ...(input.payload?.tags ?? [])],
        data: { actionType: input.type, ...(input.payload ?? {}) },
      };
      actionResult = { accepted: true };
    }

    const processed = this.processWorldEvent(runtime, event);
    const worldEvents = this.executeWorldXPlayerAction(binding.characterId, input, processed.event);
    runtime.protagonist.drainIntents();
    this.persist();
    return { intent, ...actionResult, ...processed, worldEvents };
  }

  async attemptBreakthrough(playerId: string, random?: () => number) {
    const runtime = await this.ensureRuntime();
    const binding = this.requirePlayer(runtime, playerId);
    const result = runtime.cultivation.attemptBreakthrough(
      this.requireCultivationCharacter(binding.characterId),
      random ? { random } : undefined,
    );
    this.cultivationCharacters[binding.characterId] = result.state;
    const processed = this.processWorldEvent(runtime, result.event);
    this.persist();
    return { ...result, ...processed };
  }

  async learnTechnique(playerId: string, techniqueId: string) {
    const runtime = await this.ensureRuntime();
    const binding = this.requirePlayer(runtime, playerId);
    const result = runtime.cultivation.learnTechnique(this.requireCultivationCharacter(binding.characterId), techniqueId);
    this.cultivationCharacters[binding.characterId] = result.state;
    const processed = result.event ? this.processWorldEvent(runtime, result.event) : null;
    this.persist();
    return { ...result, processed };
  }

  async proposeAccident(worldTick: number) {
    const runtime = await this.ensureRuntime();
    const chapterIndex = runtime.director.state.chapterIndex as number;
    const accident = runtime.accidents.propose({ chapterIndex, worldTick });
    this.persist();
    return accident;
  }

  async resolveAccident(input: { playerId: string; instanceId: string; choiceId: string; worldTick: number }) {
    const runtime = await this.ensureRuntime();
    const binding = this.requirePlayer(runtime, input.playerId);
    const result = runtime.accidents.resolve({ ...input, actorId: binding.characterId });
    const processed = this.processWorldEvent(runtime, result.event);
    this.persist();
    return { ...result, ...processed };
  }

  async createRoom(input: { playerId: string; displayName: string; maxPlayers?: number }) {
    const runtime = await this.ensureRuntime();
    const binding = this.requirePlayer(runtime, input.playerId);
    const result = runtime.multiplayer.createRoom({
      hostPlayerId: input.playerId,
      protagonistCharacterId: binding.characterId,
      displayName: input.displayName,
      maxPlayers: input.maxPlayers ?? 32,
    });
    this.persist();
    return result;
  }

  async joinRoom(input: { roomId: string; playerId: string; characterId?: string | null; displayName: string; role: string }) {
    const runtime = await this.ensureRuntime();
    const result = runtime.multiplayer.joinRoom(input);
    this.persist();
    return result;
  }

  async reconnectRoom(input: { roomId: string; playerId: string; resumeToken: string }) {
    const runtime = await this.ensureRuntime();
    const room = runtime.multiplayer.reconnect(input);
    this.persist();
    return room;
  }

  async disconnectRoom(input: { roomId: string; playerId: string }) {
    const runtime = await this.ensureRuntime();
    const room = runtime.multiplayer.disconnect(input);
    this.persist();
    return room;
  }

  async resumeRoom(input: { roomId: string; playerId: string }) {
    const runtime = await this.ensureRuntime();
    const room = runtime.multiplayer.resumeRoom(input);
    this.persist();
    return room;
  }

  async listRooms() {
    return (await this.ensureRuntime()).multiplayer.listRooms();
  }

  async getRoom(roomId: string) {
    return (await this.ensureRuntime()).multiplayer.getRoom(roomId);
  }

  async submitRoomIntent(input: {
    roomId: string;
    playerId: string;
    resumeToken: string;
    clientSequence: number;
    intent: { type: string; targetId?: string | null; payload?: Record<string, any> };
  }) {
    const runtime = await this.ensureRuntime();
    const envelope = runtime.multiplayer.submitIntent(input);
    let actionResult: Record<string, unknown>;
    if (envelope.role === "protagonist") {
      actionResult = await this.submitAction({
        playerId: input.playerId,
        type: input.intent.type,
        targetId: input.intent.targetId,
        payload: input.intent.payload,
      });
    } else {
      const event: XiuxianEvent = {
        id: `multiplayer-action-${Date.now()}`,
        type: "multiplayer_action",
        actorId: envelope.characterId ?? `player:${input.playerId}`,
        targetId: input.intent.targetId ?? null,
        tags: ["xiuxian", "multiplayer_action", ...(input.intent.payload?.tags ?? [])],
        data: { playerId: input.playerId, role: envelope.role, actionType: input.intent.type, ...(input.intent.payload ?? {}) },
      };
      actionResult = this.processWorldEvent(runtime, event);
    }
    const resolved = runtime.multiplayer.resolveIntent({ roomId: input.roomId, intentId: envelope.id, result: actionResult });
    this.persist();
    return { resolved, room: runtime.multiplayer.getRoom(input.roomId) };
  }

  private processWorldEvent(runtime: XiuxianRuntime, event: XiuxianEvent) {
    const protectedResult = runtime.causality.protect(event);
    const story = runtime.director.ingestEvent(protectedResult.event);
    if (protectedResult.correctionEvent) runtime.director.ingestEvent(protectedResult.correctionEvent);
    return { event: protectedResult.event, correctionEvent: protectedResult.correctionEvent, story };
  }

  private requirePlayer(runtime: XiuxianRuntime, playerId: string) {
    const binding = runtime.protagonist.binding;
    if (!binding || binding.playerId !== playerId) throw new Error("当前玩家无权控制主角");
    return binding;
  }

  private requireCultivationCharacter(characterId: string) {
    const character = this.cultivationCharacters[characterId];
    if (!character) throw new Error("主角尚未初始化修炼状态");
    return character;
  }

  private async ensureRuntime(): Promise<XiuxianRuntime> {
    const dbPath = getDbPath();
    if (this.runtime && this.activeDbPath === dbPath) return this.runtime;
    this.ensureTable();
    const row = getDb().prepare("SELECT value FROM xiuxian_module_state WHERE key = ?").get(STATE_KEY) as { value: string } | undefined;
    const saved = row ? JSON.parse(row.value) as PersistedState : emptyState();
    this.cultivationCharacters = saved.cultivationCharacters ?? {};
    this.runtime = await createXiuxianStoryModule({
      savedState: saved.directorState,
      accidentState: saved.accidentState,
      causalityState: saved.causalityState,
      multiplayerState: saved.multiplayerState,
      playerId: saved.protagonistBinding?.playerId,
      characterId: saved.protagonistBinding?.characterId,
    });
    const binding = this.runtime.protagonist.binding;
    if (binding && appContext.hasWorld) {
      appContext.worldManager.setGlobal(`player_controlled:${binding.characterId}`, "true");
    }
    this.activeDbPath = dbPath;
    return this.runtime;
  }

  private ensureTable() {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS xiuxian_module_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  private executeWorldXPlayerAction(
    characterId: string,
    input: { type: string; targetId?: string | null; payload?: Record<string, any> },
    moduleEvent: XiuxianEvent,
  ): SimulationEvent[] {
    if (!appContext.hasWorld) return [];
    let decision: ActionDecision | null = null;
    if (input.type === "move" && input.targetId) {
      decision = {
        actionType: input.targetId.startsWith("main_area:") || input.targetId.startsWith("main_area_point:")
          ? "move_within_main_area"
          : "move_to",
        targetId: input.targetId,
        reason: "玩家主角主动移动",
      };
    } else if (input.type === "talk" && input.targetId) {
      decision = { actionType: "talk_to", targetId: input.targetId, reason: String(input.payload?.message ?? "玩家主角主动交谈") };
    } else if (input.type === "world_action" && input.targetId) {
      decision = { actionType: "world_action", targetId: input.targetId, reason: "玩家主角主动执行世界行动" };
    }

    const events = decision
      ? appContext.simulationEngine.executePlayerAction(characterId, decision)
      : appContext.simulationEngine.recordExternalEvent({
          actorId: characterId,
          tags: moduleEvent.tags,
          data: { moduleEventId: moduleEvent.id, moduleEventType: moduleEvent.type, ...(moduleEvent.data ?? {}) },
        });
    if (events.length > 0) {
      appContext.eventBus.emit("tick_events", {
        gameTime: appContext.worldManager.getCurrentTime(),
        events,
      });
    }
    return events;
  }

  private persist() {
    if (!this.runtime) return;
    const state: PersistedState = {
      version: 1,
      protagonistBinding: this.runtime.protagonist.binding,
      directorState: this.runtime.director.state,
      accidentState: this.runtime.accidents.state,
      causalityState: this.runtime.causality.state,
      multiplayerState: this.runtime.multiplayer.state,
      cultivationCharacters: this.cultivationCharacters,
    };
    getDb().prepare(`
      INSERT INTO xiuxian_module_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(STATE_KEY, JSON.stringify(state));
  }
}

function emptyState(): PersistedState {
  return {
    version: 1,
    protagonistBinding: null,
    directorState: null,
    accidentState: null,
    causalityState: null,
    multiplayerState: null,
    cultivationCharacters: {},
  };
}

export const xiuxianStoryService = new XiuxianStoryService();
