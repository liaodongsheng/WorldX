import { validateCultivationRules } from "./rules-loader.mjs";

export class CultivationEngine {
  #rules;

  constructor(rules) { this.#rules = validateCultivationRules(rules); }

  createCharacter({ id, name, spiritualRoot = 1, comprehension = 1, physique = 1 }) {
    requireId(id, "角色 ID");
    requireId(name, "角色名称");
    for (const [field, value] of Object.entries({ spiritualRoot, comprehension, physique })) {
      if (!Number.isFinite(value) || value < 0.5 || value > 2) throw new Error(`${field} 必须在 0.5 到 2 之间`);
    }
    const realm = this.#rules.realms[0];
    return {
      version: 1,
      id,
      name,
      realmIndex: 0,
      realmId: realm.id,
      cultivation: 0,
      spiritualRoot,
      comprehension,
      physique,
      hp: Math.round(realm.hp * physique),
      maxHp: Math.round(realm.hp * physique),
      qi: realm.qi,
      maxQi: realm.qi,
      attack: Math.round(realm.attack * physique),
      defense: Math.round(realm.defense * physique),
      speed: realm.speed,
      learnedTechniqueIds: ["basic-breathing"],
    };
  }

  meditate(character, { hours = 1, techniqueId = "basic-breathing" } = {}) {
    const state = cloneCharacter(character);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error("单次打坐时长必须在 0 到 24 小时之间");
    const technique = this.#getTechnique(techniqueId);
    if (technique.kind !== "cultivation") throw new Error(`${technique.name} 不是修炼功法`);
    if (!state.learnedTechniqueIds.includes(techniqueId)) throw new Error(`尚未学会功法: ${technique.name}`);
    const gained = Math.max(1, Math.round(technique.cultivationPerHour * hours * state.spiritualRoot * state.comprehension));
    state.cultivation += gained;
    state.qi = Math.min(state.maxQi, state.qi + Math.ceil(gained * 0.15));
    return {
      state,
      event: cultivationEvent(state.id, "meditation_completed", { techniqueId, hours, gained }),
    };
  }

  learnTechnique(character, techniqueId) {
    const state = cloneCharacter(character);
    const technique = this.#getTechnique(techniqueId);
    if (state.learnedTechniqueIds.includes(techniqueId)) return { state, learned: false };
    const requiredIndex = this.#rules.realms.findIndex((realm) => realm.id === technique.requiredRealm);
    if (state.realmIndex < requiredIndex) throw new Error(`学习 ${technique.name} 需要达到${this.#rules.realms[requiredIndex].name}境`);
    state.learnedTechniqueIds.push(techniqueId);
    return {
      state,
      learned: true,
      event: cultivationEvent(state.id, "technique_learned", { techniqueId }),
    };
  }

  attemptBreakthrough(character, { random = Math.random } = {}) {
    const state = cloneCharacter(character);
    const current = this.#rules.realms[state.realmIndex];
    if (state.realmIndex >= this.#rules.realms.length - 1) throw new Error("已经达到当前规则的最高境界");
    if (state.cultivation < current.requiredCultivation) throw new Error(`修为不足，需要 ${current.requiredCultivation}`);
    const chance = Math.min(0.98, current.breakthroughChance + (state.comprehension - 1) * 0.1);
    const roll = random();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("随机数必须在 [0, 1) 范围内");
    if (roll >= chance) {
      const lost = Math.max(1, Math.round(current.requiredCultivation * 0.1));
      state.cultivation = Math.max(0, state.cultivation - lost);
      state.hp = Math.max(1, state.hp - Math.round(state.maxHp * 0.2));
      return { state, success: false, chance, event: cultivationEvent(state.id, "breakthrough_failed", { realmId: current.id, lost }) };
    }

    state.cultivation -= current.requiredCultivation;
    state.realmIndex += 1;
    const next = this.#rules.realms[state.realmIndex];
    state.realmId = next.id;
    state.maxHp = Math.round(next.hp * state.physique);
    state.hp = state.maxHp;
    state.maxQi = next.qi;
    state.qi = state.maxQi;
    state.attack = Math.round(next.attack * state.physique);
    state.defense = Math.round(next.defense * state.physique);
    state.speed = next.speed;
    return {
      state,
      success: true,
      chance,
      event: cultivationEvent(state.id, `realm_${next.id}`, { fromRealmId: current.id, toRealmId: next.id }),
    };
  }

  getTechnique(techniqueId) { return structuredClone(this.#getTechnique(techniqueId)); }

  #getTechnique(id) {
    const technique = this.#rules.techniques.find((item) => item.id === id);
    if (!technique) throw new Error(`未知功法: ${id}`);
    return technique;
  }
}

function cultivationEvent(actorId, tag, data) {
  return { id: `cultivation-${Date.now()}`, type: "xiuxian", actorId, tags: ["xiuxian", tag], data };
}

function cloneCharacter(character) {
  if (!character || character.version !== 1 || typeof character.id !== "string") throw new Error("角色修炼状态无效");
  return structuredClone(character);
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label}不能为空`);
}
