const ALLOWED_INTENTS = new Set(["move", "talk", "world_action", "meditate", "train", "use_skill", "choose"]);

export class ProtagonistController {
  #binding = null;
  #queue = [];

  bind({ playerId, characterId }) {
    requireId(playerId, "playerId");
    requireId(characterId, "characterId");
    if (this.#binding && (this.#binding.playerId !== playerId || this.#binding.characterId !== characterId)) {
      throw new Error("主角已经由其他玩家控制");
    }
    this.#binding = { playerId, characterId };
    return this.binding;
  }

  get binding() { return this.#binding ? { ...this.#binding } : null; }

  isPlayerControlled(characterId) { return this.#binding?.characterId === characterId; }

  submitIntent({ playerId, type, targetId = null, payload = {} }) {
    if (!this.#binding || this.#binding.playerId !== playerId) throw new Error("当前玩家无权控制主角");
    if (!ALLOWED_INTENTS.has(type)) throw new Error(`不支持的主角行动: ${type}`);
    const intent = {
      id: `intent-${Date.now()}-${this.#queue.length + 1}`,
      playerId,
      characterId: this.#binding.characterId,
      type,
      targetId,
      payload: structuredClone(payload),
      submittedAt: new Date().toISOString(),
    };
    this.#queue.push(intent);
    return structuredClone(intent);
  }

  drainIntents() {
    const intents = structuredClone(this.#queue);
    this.#queue = [];
    return intents;
  }
}

function requireId(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} 不能为空`);
}
