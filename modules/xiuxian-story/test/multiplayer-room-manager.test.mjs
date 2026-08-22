import test from "node:test";
import assert from "node:assert/strict";
import { MultiplayerRoomManager } from "../src/index.mjs";

test("creates a room with one exclusive protagonist", () => {
  const manager = new MultiplayerRoomManager();
  const created = manager.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero", displayName: "房主", maxPlayers: 10 });
  assert.equal(created.room.members[0].role, "protagonist");
  assert.equal(created.room.maxPlayers, 10);
  assert.ok(created.resumeToken);
  assert.equal("resumeToken" in created.room.members[0], false);
});

test("supports configurable rooms larger than four players", () => {
  const manager = new MultiplayerRoomManager();
  const { room } = manager.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero", maxPlayers: 32 });
  for (let index = 2; index <= 6; index += 1) {
    manager.joinRoom({ roomId: room.id, playerId: `p${index}`, characterId: `char-${index}`, role: "companion" });
  }
  assert.equal(manager.getRoom(room.id).members.length, 6);
});

test("prevents two players from controlling the same character", () => {
  const manager = new MultiplayerRoomManager();
  const { room } = manager.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero" });
  manager.joinRoom({ roomId: room.id, playerId: "p2", characterId: "friend", role: "companion" });
  assert.throws(() => manager.joinRoom({ roomId: room.id, playerId: "p3", characterId: "friend", role: "rival" }), /已经被其他玩家控制/);
});

test("server rejects duplicate client action sequences", () => {
  const manager = new MultiplayerRoomManager();
  const created = manager.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero" });
  manager.submitIntent({ roomId: created.room.id, playerId: "p1", resumeToken: created.resumeToken, clientSequence: 1, intent: { type: "meditate" } });
  assert.throws(() => manager.submitIntent({ roomId: created.room.id, playerId: "p1", resumeToken: created.resumeToken, clientSequence: 1, intent: { type: "meditate" } }), /重复或过期/);
});

test("host disconnect pauses the world and a valid token reconnects", () => {
  const manager = new MultiplayerRoomManager();
  const created = manager.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero" });
  manager.disconnect({ roomId: created.room.id, playerId: "p1" });
  assert.equal(manager.getRoom(created.room.id).status, "paused");
  manager.reconnect({ roomId: created.room.id, playerId: "p1", resumeToken: created.resumeToken });
  manager.resumeRoom({ roomId: created.room.id, playerId: "p1" });
  assert.equal(manager.getRoom(created.room.id).status, "active");
});

test("room state restores pending and resolved authoritative actions", () => {
  const first = new MultiplayerRoomManager();
  const created = first.createRoom({ hostPlayerId: "p1", protagonistCharacterId: "hero" });
  const intent = first.submitIntent({ roomId: created.room.id, playerId: "p1", resumeToken: created.resumeToken, clientSequence: 1, intent: { type: "move" } });
  first.resolveIntent({ roomId: created.room.id, intentId: intent.id, result: { accepted: true } });
  const restored = new MultiplayerRoomManager(JSON.parse(JSON.stringify(first.state)));
  assert.equal(restored.getRoom(created.room.id).recentResolvedIntents.length, 1);
});
