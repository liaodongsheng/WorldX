export class CausalityGuard {
  #rules;
  #state;

  constructor(corrections, savedState) {
    if (!Array.isArray(corrections)) throw new Error("因果纠偏规则无效");
    this.#rules = structuredClone(corrections);
    this.#state = savedState ? structuredClone(savedState) : { version: 1, karmaDebt: 0, corrections: [] };
  }

  get state() { return structuredClone(this.#state); }

  protect(event) {
    if (!event || !Array.isArray(event.tags)) throw new Error("待检查的世界事件无效");
    const rule = this.#rules.find((item) => event.tags.includes(item.forbiddenTag));
    if (!rule) return { corrected: false, event: structuredClone(event), correctionEvent: null, state: this.state };
    const protectedEvent = structuredClone(event);
    protectedEvent.tags = protectedEvent.tags.map((tag) => tag === rule.forbiddenTag ? rule.replacementTag : tag);
    this.#state.karmaDebt += rule.cost?.karmaDebt ?? 0;
    const correctionEvent = {
      id: `causality-${event.id}`,
      type: "causality_correction",
      actorId: event.actorId ?? null,
      tags: ["xiuxian", "causality_corrected", rule.correctionTag],
      data: { forbiddenTag: rule.forbiddenTag, cost: structuredClone(rule.cost ?? {}), description: rule.description },
    };
    this.#state.corrections.push({ sourceEventId: event.id, rule: rule.forbiddenTag, correctionEventId: correctionEvent.id });
    return { corrected: true, event: protectedEvent, correctionEvent, state: this.state };
  }
}
