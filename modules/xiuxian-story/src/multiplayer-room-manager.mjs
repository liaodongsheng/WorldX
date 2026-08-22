import { randomUUID } from "node:crypto";

const ROLES = new Set(["protagonist", "companion", "rival", "sect_member", "observer"]);

export class MultiplayerRoomManager {
  #state;

  constructor(savedState) {
    this.#state = restoreState(savedState);
  }

  get state() { return structuredClone(this.#state); }

  createRoom({ hostPlayerId, protagonistCharacterId, displayName, maxPlayers = 32 }) {
    requireId(hostPlayerId, "hostPlayerId");
    requireId(protagonistCharacterId, "protagonistCharacterId");
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) throw new Error("房间人数必须在 2 到 100 之间");
    const roomId = shortId();
    const resumeToken = randomUUID();
    const room = {
      id: roomId,
      status: "active",
      hostPlayerId,
      protagonistCharacterId,
      maxPlayers,
      createdAt: new Date().toISOString(),
      sequence: 0,
      members: {
        [hostPlayerId]: member({
          playerId: hostPlayerId,
          characterId: protagonistCharacterId,
          displayName,
          role: "protagonist",
          resumeToken,
        }),
      },
      pendingIntents: [],
      resolvedIntents: [],
    };
    this.#state.rooms[roomId] = room;
    return { room: publicRoom(room), resumeToken };
  }

  joinRoom({ roomId, playerId, characterId = null, displayName, role = "companion" }) {
    const room = this.#getRoom(roomId);
    requireId(playerId, "playerId");
    if (!ROLES.has(role) || role === "protagonist") throw new Error("加入者不能占用主角身份");
    if (room.status !== "active") throw new Error("房间当前不可加入");
    if (room.members[playerId]) throw new Error("玩家已经在房间中");
    if (Object.keys(room.members).length >= room.maxPlayers) throw new Error("房间人数已满");
    if (characterId && Object.values(room.members).some((item) => item.characterId === characterId)) {
      throw new Error("该世界角色已经被其他玩家控制");
    }
    const resumeToken = randomUUID();
    room.members[playerId] = member({ playerId, characterId, displayName, role, resumeToken });
    return { room: publicRoom(room), resumeToken };
  }

  reconnect({ roomId, playerId, resumeToken }) {
    const room = this.#getRoom(roomId);
    const roomMember = room.members[playerId];
    if (!roomMember || roomMember.resumeToken !== resumeToken) throw new Error("联机恢复凭证无效");
    roomMember.online = true;
    roomMember.disconnectedAt = null;
    roomMember.lastSeenAt = new Date().toISOString();
    return publicRoom(room);
  }

  disconnect({ roomId, playerId }) {
    const room = this.#getRoom(roomId);
    const roomMember = room.members[playerId];
    if (!roomMember) return publicRoom(room);
    roomMember.online = false;
    roomMember.disconnectedAt = new Date().toISOString();
    if (playerId === room.hostPlayerId) room.status = "paused";
    return publicRoom(room);
  }

  resumeRoom({ roomId, playerId }) {
    const room = this.#getRoom(roomId);
    if (room.hostPlayerId !== playerId) throw new Error("只有主角玩家可以恢复房间");
    room.status = "active";
    return publicRoom(room);
  }

  submitIntent({ roomId, playerId, resumeToken, clientSequence, intent }) {
    const room = this.#getRoom(roomId);
    if (room.status !== "active") throw new Error("房间已暂停");
    const roomMember = room.members[playerId];
    if (!roomMember || roomMember.resumeToken !== resumeToken) throw new Error("玩家联机凭证无效");
    if (!Number.isInteger(clientSequence) || clientSequence <= roomMember.lastClientSequence) {
      throw new Error("行动序号重复或过期");
    }
    if (!intent || typeof intent.type !== "string") throw new Error("行动内容无效");
    roomMember.lastClientSequence = clientSequence;
    roomMember.lastSeenAt = new Date().toISOString();
    room.sequence += 1;
    const envelope = {
      id: `${room.id}-intent-${room.sequence}`,
      roomSequence: room.sequence,
      clientSequence,
      playerId,
      characterId: roomMember.characterId,
      role: roomMember.role,
      intent: structuredClone(intent),
      receivedAt: new Date().toISOString(),
    };
    room.pendingIntents.push(envelope);
    return structuredClone(envelope);
  }

  resolveIntent({ roomId, intentId, result }) {
    const room = this.#getRoom(roomId);
    const index = room.pendingIntents.findIndex((item) => item.id === intentId);
    if (index < 0) throw new Error("待结算行动不存在");
    const [intent] = room.pendingIntents.splice(index, 1);
    const resolved = { ...intent, result: structuredClone(result), resolvedAt: new Date().toISOString() };
    room.resolvedIntents.push(resolved);
    if (room.resolvedIntents.length > 200) room.resolvedIntents.splice(0, room.resolvedIntents.length - 200);
    return structuredClone(resolved);
  }

  getRoom(roomId) { return publicRoom(this.#getRoom(roomId)); }
  listRooms() { return Object.values(this.#state.rooms).map(publicRoom); }

  #getRoom(roomId) {
    const room = this.#state.rooms[roomId];
    if (!room) throw new Error("联机房间不存在");
    return room;
  }
}

function member({ playerId, characterId, displayName, role, resumeToken }) {
  return {
    playerId,
    characterId,
    displayName: displayName || playerId,
    role,
    resumeToken,
    online: true,
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    disconnectedAt: null,
    lastClientSequence: 0,
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    status: room.status,
    hostPlayerId: room.hostPlayerId,
    protagonistCharacterId: room.protagonistCharacterId,
    maxPlayers: room.maxPlayers,
    sequence: room.sequence,
    members: Object.values(room.members).map(({ resumeToken: _secret, ...item }) => ({ ...item })),
    pendingIntentCount: room.pendingIntents.length,
    recentResolvedIntents: structuredClone(room.resolvedIntents.slice(-20)),
  };
}

function restoreState(saved) {
  if (!saved) return { version: 1, rooms: {} };
  if (saved.version !== 1 || !saved.rooms) throw new Error("联机房间存档版本不兼容");
  return structuredClone(saved);
}

function requireId(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} 不能为空`);
}

function shortId() { return randomUUID().replaceAll("-", "").slice(0, 10); }
