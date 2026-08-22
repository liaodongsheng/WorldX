export type XiuxianEvent = {
  id: string;
  type: string;
  actorId?: string | null;
  targetId?: string | null;
  tags: string[];
  data?: Record<string, unknown>;
};

export type XiuxianRuntime = {
  id: string;
  version: string;
  director: {
    readonly state: Record<string, unknown>;
    bindProtagonist(characterId: string): Record<string, unknown>;
    ingestEvent(event: XiuxianEvent): Record<string, unknown>;
    guidance(): Record<string, unknown>;
  };
  protagonist: {
    readonly binding: { playerId: string; characterId: string } | null;
    bind(binding: { playerId: string; characterId: string }): { playerId: string; characterId: string };
    submitIntent(intent: Record<string, unknown>): Record<string, unknown>;
    drainIntents(): Record<string, unknown>[];
  };
  cultivation: {
    createCharacter(input: Record<string, unknown>): Record<string, any>;
    meditate(state: Record<string, any>, options?: Record<string, unknown>): { state: Record<string, any>; event: XiuxianEvent };
    attemptBreakthrough(state: Record<string, any>, options?: Record<string, unknown>): { state: Record<string, any>; event: XiuxianEvent; success: boolean; chance: number };
    learnTechnique(state: Record<string, any>, techniqueId: string): { state: Record<string, any>; event?: XiuxianEvent; learned: boolean };
  };
  combat: { resolveTurn(input: Record<string, unknown>): Record<string, unknown> };
  accidents: {
    readonly state: Record<string, any>;
    propose(input: Record<string, unknown>): Record<string, any> | null;
    resolve(input: Record<string, unknown>): { event: XiuxianEvent; state: Record<string, any> };
  };
  causality: {
    readonly state: Record<string, any>;
    protect(event: XiuxianEvent): { corrected: boolean; event: XiuxianEvent; correctionEvent: XiuxianEvent | null; state: Record<string, any> };
  };
  multiplayer: {
    readonly state: Record<string, any>;
    createRoom(input: Record<string, unknown>): { room: Record<string, any>; resumeToken: string };
    joinRoom(input: Record<string, unknown>): { room: Record<string, any>; resumeToken: string };
    reconnect(input: Record<string, unknown>): Record<string, any>;
    disconnect(input: Record<string, unknown>): Record<string, any>;
    resumeRoom(input: Record<string, unknown>): Record<string, any>;
    submitIntent(input: Record<string, unknown>): Record<string, any>;
    resolveIntent(input: Record<string, unknown>): Record<string, any>;
    getRoom(roomId: string): Record<string, any>;
    listRooms(): Record<string, any>[];
  };
};

export function createXiuxianStoryModule(options?: Record<string, unknown>): Promise<XiuxianRuntime>;
