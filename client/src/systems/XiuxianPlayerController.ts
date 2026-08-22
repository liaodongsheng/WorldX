import Phaser from "phaser";
import type { LocationInfo } from "../types/api";
import type {
  XiuxianGameplayToast,
  XiuxianInteractionContext,
} from "../types/xiuxian-gameplay";
import { apiClient } from "../ui/services/api-client";
import type { CharacterSprite } from "../objects/CharacterSprite";
import type { MapManager, InteractiveObject } from "./MapManager";
import type { CharacterMovement } from "./CharacterMovement";

const INTERACTION_RANGE = 150;
const KEYBOARD_STEP_PX = 72;
const CONTEXT_SCAN_INTERVAL_MS = 100;

export class XiuxianPlayerController {
  private movementKeys!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private alternateInteractKey!: Phaser.Input.Keyboard.Key;
  private readonly directionalKeyBindings: Array<{
    key: Phaser.Input.Keyboard.Key;
    handler: () => void;
  }> = [];
  private context: XiuxianInteractionContext | null = null;
  private busy = false;
  private lastContextScanAt = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private aura: Phaser.GameObjects.Ellipse;
  private targetMarker: Phaser.GameObjects.Arc;
  private readonly objectConfigs = new Map<string, NonNullable<LocationInfo["objects"]>[number]>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly mapManager: MapManager,
    private readonly movement: CharacterMovement,
    private readonly sprites: Map<string, CharacterSprite>,
    private readonly eventBus: Phaser.Events.EventEmitter,
    private readonly playerId: string,
    private readonly protagonistId: string,
    locations: LocationInfo[],
  ) {
    for (const location of locations) {
      for (const object of location.objects ?? []) this.objectConfigs.set(object.id, object);
    }

    this.aura = scene.add.ellipse(0, 0, 64, 30, 0x65f5d0, 0.13)
      .setStrokeStyle(2, 0x91ffe4, 0.85)
      .setDepth(9);
    scene.tweens.add({
      targets: this.aura,
      scaleX: 1.18,
      scaleY: 1.18,
      alpha: 0.42,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.targetMarker = scene.add.circle(0, 0, 18, 0x7fffd4, 0.08)
      .setStrokeStyle(2, 0xb9ffeb, 0.9)
      .setDepth(19)
      .setVisible(false);

    this.setupKeyboard();
    this.setupPointer();
    this.setupEventBus();
    this.movement.setPlayerControlled(protagonistId, true);
    this.emitToast("success", "已接管陆尘：WASD/方向键移动，点击地面寻路，靠近后按 E 交互");
  }

  update(now: number): void {
    const sprite = this.getProtagonist();
    if (!sprite) return;
    this.aura.setPosition(sprite.x, sprite.y + 8);

    if (!this.busy && !sprite.isMoving) {
      const dx = Number(this.movementKeys.right.isDown) - Number(this.movementKeys.left.isDown);
      const dy = Number(this.movementKeys.down.isDown) - Number(this.movementKeys.up.isDown);
      if (dx !== 0 || dy !== 0) void this.moveDirection(dx, dy);
    }

    if (
      !this.busy &&
      (Phaser.Input.Keyboard.JustDown(this.interactKey) ||
        Phaser.Input.Keyboard.JustDown(this.alternateInteractKey))
    ) {
      void this.activateContext();
    }

    if (now - this.lastContextScanAt >= CONTEXT_SCAN_INTERVAL_MS) {
      this.lastContextScanAt = now;
      this.refreshInteractionContext();
    }
  }

  destroy(): void {
    this.movement.setPlayerControlled(this.protagonistId, false);
    this.scene.input.off("pointerdown", this.onPointerDown, this);
    this.scene.input.off("pointerup", this.onPointerUp, this);
    this.eventBus.off("xiuxian_move_direction", this.onMoveDirection, this);
    this.eventBus.off("xiuxian_interact", this.onInteract, this);
    this.eventBus.off("xiuxian_character_targeted", this.onCharacterTargeted, this);
    this.eventBus.off("xiuxian_object_targeted", this.onObjectTargeted, this);
    for (const { key, handler } of this.directionalKeyBindings) key.off("down", handler);
    this.directionalKeyBindings.length = 0;
    this.aura.destroy();
    this.targetMarker.destroy();
    this.eventBus.emit("xiuxian_interaction_context", null);
  }

  private setupKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input unavailable");
    this.movementKeys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }, false) as Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
    this.bindDirectionalKey(keyboard, Phaser.Input.Keyboard.KeyCodes.UP, 0, -1);
    this.bindDirectionalKey(keyboard, Phaser.Input.Keyboard.KeyCodes.DOWN, 0, 1);
    this.bindDirectionalKey(keyboard, Phaser.Input.Keyboard.KeyCodes.LEFT, -1, 0);
    this.bindDirectionalKey(keyboard, Phaser.Input.Keyboard.KeyCodes.RIGHT, 1, 0);
    this.interactKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E, false);
    this.alternateInteractKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false);
  }

  private setupPointer(): void {
    this.scene.input.on("pointerdown", this.onPointerDown, this);
    this.scene.input.on("pointerup", this.onPointerUp, this);
  }

  private setupEventBus(): void {
    this.eventBus.on("xiuxian_move_direction", this.onMoveDirection, this);
    this.eventBus.on("xiuxian_interact", this.onInteract, this);
    this.eventBus.on("xiuxian_character_targeted", this.onCharacterTargeted, this);
    this.eventBus.on("xiuxian_object_targeted", this.onObjectTargeted, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    this.pointerDown = { x: pointer.x, y: pointer.y };
  }

  private onPointerUp(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
    const pointerDown = this.pointerDown;
    this.pointerDown = null;
    if (!pointerDown || this.busy || gameObjects.length > 0) return;
    const dragDistance = Phaser.Math.Distance.Between(
      pointerDown.x,
      pointerDown.y,
      pointer.x,
      pointer.y,
    );
    if (dragDistance > 8) return;
    void this.moveTo(pointer.worldX, pointer.worldY);
  }

  private onMoveDirection(payload: { dx: number; dy: number }): void {
    if (!this.busy) void this.moveDirection(payload.dx, payload.dy);
  }

  private onInteract(): void {
    if (!this.busy) void this.activateContext();
  }

  private onCharacterTargeted(targetId: string): void {
    if (!this.busy && targetId !== this.protagonistId) void this.activateCharacter(targetId);
  }

  private onObjectTargeted(targetId: string): void {
    if (!this.busy) void this.activateObject(targetId);
  }

  private async moveDirection(dx: number, dy: number): Promise<void> {
    const sprite = this.getProtagonist();
    if (!sprite || sprite.isMoving) return;
    const length = Math.hypot(dx, dy) || 1;
    await this.moveTo(
      sprite.x + dx / length * KEYBOARD_STEP_PX,
      sprite.y + dy / length * KEYBOARD_STEP_PX,
      false,
    );
  }

  private async moveTo(x: number, y: number, showMarker = true): Promise<void> {
    const sprite = this.getProtagonist();
    if (!sprite || this.busy) return;
    this.busy = true;
    const previousLocationId = sprite.currentLocationId || "main_area";
    try {
      if (showMarker) this.showTargetMarker(x, y);
      const result = await this.movement.movePlayerToPoint(this.protagonistId, x, y);
      if (result && result.locationId !== previousLocationId) {
        await apiClient.submitXiuxianAction({
          playerId: this.playerId,
          type: "move",
          targetId: result.locationId,
        });
        this.eventBus.emit("xiuxian_status_changed");
      }
    } catch (error) {
      this.emitToast("error", messageOf(error));
    } finally {
      this.targetMarker.setVisible(false);
      this.busy = false;
    }
  }

  private bindDirectionalKey(
    keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
    keyCode: number,
    dx: number,
    dy: number,
  ): void {
    const key = keyboard.addKey(keyCode, false);
    const handler = () => this.onMoveDirection({ dx, dy });
    key.on("down", handler);
    this.directionalKeyBindings.push({ key, handler });
  }

  private async activateContext(): Promise<void> {
    if (!this.context) return;
    if (this.context.kind === "character") {
      await this.activateCharacter(this.context.targetId);
    } else {
      await this.activateObject(this.context.targetId, this.context.interactionId);
    }
  }

  private async activateCharacter(targetId: string): Promise<void> {
    const target = this.sprites.get(targetId);
    const protagonist = this.getProtagonist();
    if (!target || !protagonist) return;
    this.busy = true;
    try {
      const distance = Phaser.Math.Distance.Between(protagonist.x, protagonist.y, target.x, target.y);
      if (distance > INTERACTION_RANGE) {
        await this.movement.approachForDialogue(this.protagonistId, targetId);
      }
      await apiClient.submitXiuxianAction({
        playerId: this.playerId,
        type: "talk",
        targetId,
        payload: { message: "我想与你谈谈。" },
      });
      await this.maybeProposeAccident();
      this.emitToast("info", `正在与${target.characterName}交谈`);
      this.eventBus.emit("xiuxian_status_changed");
    } catch (error) {
      this.emitToast("error", messageOf(error));
    } finally {
      this.busy = false;
    }
  }

  private async activateObject(targetId: string, preferredInteractionId?: string): Promise<void> {
    const config = this.objectConfigs.get(targetId);
    const interaction = config?.interactions.find((item) => item.id === preferredInteractionId)
      ?? config?.interactions.find((item) => !item.requiresAnchor)
      ?? config?.interactions[0];
    if (!interaction) return;

    this.busy = true;
    try {
      if (this.mapManager.interactiveObjects.has(targetId)) {
        await this.movement.moveToObject(this.protagonistId, targetId);
      }
      await apiClient.submitXiuxianAction({
        playerId: this.playerId,
        type: "interact",
        targetId,
        payload: { interactionId: interaction.id },
      });
      await this.maybeProposeAccident();
      this.emitToast("success", interaction.name);
      this.eventBus.emit("xiuxian_status_changed");
    } catch (error) {
      this.emitToast("error", messageOf(error));
    } finally {
      this.busy = false;
    }
  }

  private refreshInteractionContext(): void {
    const protagonist = this.getProtagonist();
    if (!protagonist) return;
    const candidates: Array<{ distance: number; context: XiuxianInteractionContext }> = [];

    for (const [id, sprite] of this.sprites) {
      if (id === this.protagonistId) continue;
      const distance = Phaser.Math.Distance.Between(protagonist.x, protagonist.y, sprite.x, sprite.y);
      if (distance <= INTERACTION_RANGE) {
        candidates.push({
          distance,
          context: {
            kind: "character",
            targetId: id,
            name: sprite.characterName,
            actionLabel: `与${sprite.characterName}交谈`,
          },
        });
      }
    }

    for (const object of this.mapManager.getInteractiveObjects()) {
      const distance = distanceToRect(protagonist.x, protagonist.y, object);
      const interaction = this.pickObjectInteraction(object.objectId);
      if (distance <= INTERACTION_RANGE && interaction) {
        candidates.push({
          distance,
          context: {
            kind: "object",
            targetId: object.objectId,
            name: object.name,
            actionLabel: interaction.name,
            interactionId: interaction.id,
          },
        });
      }
    }

    const currentLocationId = this.mapManager.getLocationAtPixel(protagonist.x, protagonist.y);
    const location = currentLocationId
      ? Array.from(this.objectConfigs.values()).filter((object) => object.locationId === currentLocationId)
      : [];
    for (const object of location) {
      if (this.mapManager.interactiveObjects.has(object.id)) continue;
      const interaction = this.pickObjectInteraction(object.id);
      if (interaction) {
        candidates.push({
          distance: 20,
          context: {
            kind: "object",
            targetId: object.id,
            name: object.name,
            actionLabel: interaction.name,
            interactionId: interaction.id,
          },
        });
      }
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const next = candidates[0]?.context ?? null;
    if (contextKey(next) === contextKey(this.context)) return;
    this.context = next;
    this.eventBus.emit("xiuxian_interaction_context", next);
  }

  private pickObjectInteraction(objectId: string) {
    const interactions = this.objectConfigs.get(objectId)?.interactions ?? [];
    return interactions.find((interaction) => !interaction.requiresAnchor) ?? interactions[0] ?? null;
  }

  private showTargetMarker(x: number, y: number): void {
    this.targetMarker.setPosition(x, y).setScale(0.55).setAlpha(1).setVisible(true);
    this.scene.tweens.add({
      targets: this.targetMarker,
      scale: 1,
      alpha: 0.35,
      duration: 360,
      yoyo: true,
      repeat: 1,
    });
  }

  private async maybeProposeAccident(): Promise<void> {
    const key = "worldx-xiuxian-actions-since-accident";
    const previous = Number.parseInt(localStorage.getItem(key) ?? "0", 10);
    const next = Number.isFinite(previous) ? previous + 1 : 1;
    if (next < 3) {
      localStorage.setItem(key, String(next));
      return;
    }
    localStorage.setItem(key, "0");
    await apiClient.proposeXiuxianAccident();
  }

  private getProtagonist(): CharacterSprite | null {
    return this.sprites.get(this.protagonistId) ?? null;
  }

  private emitToast(tone: XiuxianGameplayToast["tone"], message: string): void {
    this.eventBus.emit("xiuxian_gameplay_toast", { tone, message } satisfies XiuxianGameplayToast);
  }
}

function contextKey(context: XiuxianInteractionContext | null): string {
  return context ? `${context.kind}:${context.targetId}:${context.interactionId ?? ""}` : "";
}

function distanceToRect(x: number, y: number, object: InteractiveObject): number {
  const nearestX = Phaser.Math.Clamp(x, object.x, object.x + object.width);
  const nearestY = Phaser.Math.Clamp(y, object.y, object.y + object.height);
  return Phaser.Math.Distance.Between(x, y, nearestX, nearestY);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
