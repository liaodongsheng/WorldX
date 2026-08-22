import test from "node:test";
import assert from "node:assert/strict";
import { loadAccidentRules, AccidentEngine, CausalityGuard } from "../src/index.mjs";

test("accident pool respects chapter eligibility", async () => {
  const config = await loadAccidentRules();
  const engine = new AccidentEngine(config);
  const accident = engine.propose({ chapterIndex: 0, worldTick: 1, random: () => 0.99 });
  assert.equal(accident.templateId, "wounded-spirit-beast");
});

test("an active accident is stable until the player resolves it", async () => {
  const engine = new AccidentEngine(await loadAccidentRules());
  const first = engine.propose({ chapterIndex: 2, worldTick: 10, random: () => 0 });
  const second = engine.propose({ chapterIndex: 2, worldTick: 11, random: () => 0.99 });
  assert.deepEqual(second, first);
});

test("resolved accidents emit consequences and honor cooldowns", async () => {
  const engine = new AccidentEngine(await loadAccidentRules());
  const accident = engine.propose({ chapterIndex: 0, worldTick: 5, random: () => 0 });
  const result = engine.resolve({ instanceId: accident.instanceId, choiceId: "rescue", actorId: "hero", worldTick: 5 });
  assert.ok(result.event.tags.includes("spirit_beast_rescued"));
  assert.equal(result.event.data.consequences.karma, 2);
  const next = engine.propose({ chapterIndex: 0, worldTick: 6, random: () => 0 });
  assert.equal(next, null);
});

test("accident state can be restored", async () => {
  const config = await loadAccidentRules();
  const first = new AccidentEngine(config);
  const active = first.propose({ chapterIndex: 2, worldTick: 8, random: () => 0.5 });
  const restored = new AccidentEngine(config, JSON.parse(JSON.stringify(first.state)));
  assert.deepEqual(restored.state.active, active);
});

test("causality guard converts protagonist death into a costly recoverable event", async () => {
  const config = await loadAccidentRules();
  const guard = new CausalityGuard(config.causalityCorrections);
  const result = guard.protect({ id: "fatal-1", actorId: "hero", tags: ["xiuxian", "protagonist_dead"] });
  assert.equal(result.corrected, true);
  assert.ok(result.event.tags.includes("protagonist_near_death"));
  assert.ok(!result.event.tags.includes("protagonist_dead"));
  assert.ok(result.correctionEvent.tags.includes("fate_rebirth"));
  assert.equal(result.state.karmaDebt, 3);
});
