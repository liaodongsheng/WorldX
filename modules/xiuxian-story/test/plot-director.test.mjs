import test from "node:test";
import assert from "node:assert/strict";
import { loadOutline, PlotDirector, ProtagonistController } from "../src/index.mjs";

test("loads and validates the bundled cultivation outline", async () => {
  const outline = await loadOutline();
  assert.equal(outline.title, "万劫问仙");
  assert.equal(outline.chapters.length, 6);
  assert.equal(outline.canonicalEnding.id, "ending-free-cultivation");
});

test("does not skip future chapters and advances only after current anchors", async () => {
  const director = new PlotDirector(await loadOutline());
  director.bindProtagonist("hero-1");
  const skipped = director.ingestEvent({ id: "future", actorId: "hero-1", tags: ["xiuxian", "realm_foundation"] });
  assert.deepEqual(skipped.matchedAnchorIds, []);
  assert.equal(skipped.chapterId, "ch01-awakening");
  director.ingestEvent({ id: "awakening", actorId: "hero-1", tags: ["xiuxian", "spirit_root_awakened"] });
  const advanced = director.ingestEvent({ id: "sect", actorId: "hero-1", tags: ["xiuxian", "sect_joined"] });
  assert.equal(advanced.advanced, true);
  assert.equal(advanced.chapterId, "ch02-foundation");
});

test("restores a serializable director state", async () => {
  const outline = await loadOutline();
  const first = new PlotDirector(outline);
  first.bindProtagonist("hero-1");
  first.ingestEvent({ id: "awakening", actorId: "hero-1", tags: ["xiuxian", "spirit_root_awakened"] });
  const restored = new PlotDirector(outline, JSON.parse(JSON.stringify(first.state)));
  assert.equal(restored.state.protagonistCharacterId, "hero-1");
  assert.deepEqual(restored.state.completedAnchorIds, ["a01-awaken-root"]);
});

test("only the bound player can submit protagonist intents", () => {
  const controller = new ProtagonistController();
  controller.bind({ playerId: "player-1", characterId: "hero-1" });
  assert.throws(() => controller.submitIntent({ playerId: "player-2", type: "move" }), /无权控制主角/);
  controller.submitIntent({ playerId: "player-1", type: "meditate", payload: { techniqueId: "chaos-breathing" } });
  const intents = controller.drainIntents();
  assert.equal(intents.length, 1);
  assert.equal(intents[0].characterId, "hero-1");
  assert.equal(controller.drainIntents().length, 0);
});

test("reaches the fixed ending only after every chapter anchor", async () => {
  const outline = await loadOutline();
  const director = new PlotDirector(outline);
  director.bindProtagonist("hero-1");
  let sequence = 0;
  for (const chapter of outline.chapters) {
    for (const anchor of chapter.anchors) {
      const result = director.ingestEvent({
        id: `event-${++sequence}`,
        actorId: "hero-1",
        tags: [...(anchor.match.allTags ?? []), ...(anchor.match.anyTags?.slice(0, 1) ?? [])],
      });
      if (anchor.id === outline.canonicalEnding.finalAnchorId) {
        assert.equal(result.status, "completed");
        assert.equal(result.endingId, "ending-free-cultivation");
      }
    }
  }
});
