import test from "node:test";
import assert from "node:assert/strict";
import { loadCultivationRules, CultivationEngine, CombatEngine } from "../src/index.mjs";

async function setup() {
  const rules = await loadCultivationRules();
  return { rules, cultivation: new CultivationEngine(rules), combat: new CombatEngine(rules) };
}

test("meditation gains cultivation without mutating input state", async () => {
  const { cultivation } = await setup();
  const original = cultivation.createCharacter({ id: "hero", name: "陆尘", spiritualRoot: 1.5, comprehension: 1.2 });
  const result = cultivation.meditate(original, { hours: 2 });
  assert.equal(original.cultivation, 0);
  assert.equal(result.state.cultivation, 43);
  assert.ok(result.event.tags.includes("meditation_completed"));
});

test("breakthrough requires enough cultivation", async () => {
  const { cultivation } = await setup();
  const hero = cultivation.createCharacter({ id: "hero", name: "陆尘" });
  assert.throws(() => cultivation.attemptBreakthrough(hero, { random: () => 0 }), /修为不足/);
});

test("successful breakthrough emits a story-compatible realm tag", async () => {
  const { cultivation } = await setup();
  const hero = cultivation.createCharacter({ id: "hero", name: "陆尘" });
  hero.cultivation = 100;
  const result = cultivation.attemptBreakthrough(hero, { random: () => 0 });
  assert.equal(result.success, true);
  assert.equal(result.state.realmId, "qi_refining");
  assert.ok(result.event.tags.includes("realm_qi_refining"));
});

test("techniques enforce realm requirements", async () => {
  const { cultivation } = await setup();
  const hero = cultivation.createCharacter({ id: "hero", name: "陆尘" });
  assert.throws(() => cultivation.learnTechnique(hero, "azure-sword"), /炼气境/);
  hero.realmIndex = 1;
  hero.realmId = "qi_refining";
  const learned = cultivation.learnTechnique(hero, "azure-sword");
  assert.equal(learned.learned, true);
  assert.ok(learned.state.learnedTechniqueIds.includes("azure-sword"));
});

test("combat uses learned skills, consumes qi and emits victory tags", async () => {
  const { cultivation, combat } = await setup();
  const hero = cultivation.createCharacter({ id: "hero", name: "陆尘", physique: 2 });
  hero.realmIndex = 1;
  hero.realmId = "qi_refining";
  hero.learnedTechniqueIds.push("azure-sword");
  hero.qi = 30;
  const enemy = cultivation.createCharacter({ id: "wolf", name: "妖狼" });
  enemy.hp = 5;
  const result = combat.resolveTurn({
    attacker: hero,
    defender: enemy,
    action: { type: "skill", techniqueId: "azure-sword", victoryTags: ["trial_enemy_resolved"] },
  });
  assert.equal(result.defeated, true);
  assert.equal(result.attacker.qi, 16);
  assert.ok(result.event.tags.includes("trial_enemy_resolved"));
});
