import { validateCultivationRules } from "./rules-loader.mjs";

export class CombatEngine {
  #rules;

  constructor(rules) { this.#rules = validateCultivationRules(rules); }

  resolveTurn({ attacker, defender, action }) {
    const nextAttacker = structuredClone(attacker);
    const nextDefender = structuredClone(defender);
    ensureAlive(nextAttacker, "攻击者");
    ensureAlive(nextDefender, "防守者");
    const combatAction = action ?? { type: "attack" };

    let power = 1;
    let qiCost = 0;
    let techniqueId = null;
    if (combatAction.type === "skill") {
      const technique = this.#rules.techniques.find((item) => item.id === combatAction.techniqueId);
      if (!technique || technique.kind !== "attack") throw new Error("无效的攻击功法");
      if (!nextAttacker.learnedTechniqueIds.includes(technique.id)) throw new Error("角色尚未学会该功法");
      if (nextAttacker.qi < technique.qiCost) throw new Error("灵力不足");
      power = technique.power;
      qiCost = technique.qiCost;
      techniqueId = technique.id;
    } else if (combatAction.type !== "attack") {
      throw new Error(`不支持的战斗行动: ${combatAction.type}`);
    }

    nextAttacker.qi -= qiCost;
    const damage = Math.max(1, Math.round(nextAttacker.attack * power - nextDefender.defense * 0.45));
    nextDefender.hp = Math.max(0, nextDefender.hp - damage);
    const defeated = nextDefender.hp === 0;
    const tags = ["xiuxian", techniqueId ? "skill_used" : "basic_attack"];
    if (defeated) tags.push("enemy_defeated", ...(combatAction.victoryTags ?? []));
    return {
      attacker: nextAttacker,
      defender: nextDefender,
      damage,
      defeated,
      event: {
        id: `combat-${Date.now()}`,
        type: "combat",
        actorId: nextAttacker.id,
        targetId: nextDefender.id,
        tags,
        data: { damage, techniqueId, defeated },
      },
    };
  }
}

function ensureAlive(character, label) {
  if (!character || typeof character.id !== "string" || !Number.isFinite(character.hp)) throw new Error(`${label}状态无效`);
  if (character.hp <= 0) throw new Error(`${label}已经失去战斗能力`);
}
