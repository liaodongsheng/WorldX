import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AppContext } from "../services/app-context.js";
import { xiuxianStoryService } from "../modules/xiuxian-story-service.js";

type RoomSession = {
  roomId: string;
  playerId: string;
  resumeToken: string;
};

export function setupWebSocket(server: HttpServer, ctx: AppContext): WebSocketServer {
  const wss = new WebSocketServer({ server });
  const roomSessions = new Map<WebSocket, RoomSession>();

  function send(client: WebSocket, data: unknown): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
  }

  function broadcast(data: unknown): void {
    for (const client of wss.clients) send(client, data);
  }

  function broadcastRoom(roomId: string, data: unknown): void {
    for (const [client, session] of roomSessions) {
      if (session.roomId === roomId) send(client, data);
    }
  }

  ctx.eventBus.on("tick_events", ({ gameTime, events }) => {
    broadcast({ type: "simulation_events", data: { gameTime, events } });
    const highlights = events.filter((event: any) => event.dramScore !== undefined && event.dramScore >= 6);
    for (const highlight of highlights) broadcast({ type: "highlight_detected", data: highlight });
  });

  ctx.eventBus.on("simulation_status", (payload) => {
    broadcast({ type: "simulation_status", data: payload });
  });

  wss.on("connection", (ws) => {
    const gameTime = ctx.hasWorld ? ctx.worldManager.getCurrentTime() : null;
    send(ws, { type: "connected", data: { gameTime, xiuxianMultiplayer: true } });

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, any>;
        if (message.type === "ping") {
          send(ws, { type: "pong", data: { at: Date.now() } });
          return;
        }
        if (!ctx.hasWorld) throw new Error("当前没有加载 WorldX 世界");

        if (message.type === "xiuxian_room_auth") {
          const roomId = requireText(message.data?.roomId, "roomId");
          const playerId = requireText(message.data?.playerId, "playerId");
          const resumeToken = requireText(message.data?.resumeToken, "resumeToken");
          const room = await xiuxianStoryService.reconnectRoom({ roomId, playerId, resumeToken });
          roomSessions.set(ws, { roomId, playerId, resumeToken });
          send(ws, { type: "xiuxian_room_authenticated", data: { room } });
          broadcastRoom(roomId, { type: "xiuxian_presence", data: { playerId, online: true, room } });
          return;
        }

        const session = roomSessions.get(ws);
        if (!session) throw new Error("请先完成修仙房间认证");

        if (message.type === "xiuxian_intent") {
          const result = await xiuxianStoryService.submitRoomIntent({
            ...session,
            clientSequence: requirePositiveInteger(message.data?.clientSequence, "clientSequence"),
            intent: requireIntent(message.data?.intent),
          });
          broadcastRoom(session.roomId, { type: "xiuxian_action_resolved", data: result });
          return;
        }

        if (message.type === "xiuxian_room_resume") {
          const room = await xiuxianStoryService.resumeRoom(session);
          broadcastRoom(session.roomId, { type: "xiuxian_room_state", data: { room } });
          return;
        }

        throw new Error(`不支持的 WebSocket 消息: ${message.type}`);
      } catch (error) {
        send(ws, {
          type: "xiuxian_error",
          data: { message: error instanceof Error ? error.message : "联机消息处理失败" },
        });
      }
    });

    ws.on("close", () => {
      const session = roomSessions.get(ws);
      roomSessions.delete(ws);
      if (!session) return;
      const hasAnotherConnection = [...roomSessions.values()].some(
        (item) => item.roomId === session.roomId && item.playerId === session.playerId,
      );
      if (hasAnotherConnection) return;
      void xiuxianStoryService.disconnectRoom(session).then((room) => {
        broadcastRoom(session.roomId, {
          type: "xiuxian_presence",
          data: { playerId: session.playerId, online: false, room },
        });
      }).catch((error) => {
        console.error("[Xiuxian Multiplayer] Disconnect error:", error);
      });
    });
  });

  return wss;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} 不能为空`);
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${field} 必须是正整数`);
  return value as number;
}

function requireIntent(value: unknown): { type: string; targetId?: string | null; payload?: Record<string, any> } {
  if (!value || typeof value !== "object") throw new Error("行动内容无效");
  const intent = value as Record<string, any>;
  const allowed = new Set(["move", "talk", "world_action", "meditate", "train", "use_skill", "choose"]);
  if (!allowed.has(intent.type)) throw new Error(`不支持的联机行动: ${intent.type}`);
  return { type: intent.type, targetId: intent.targetId ?? null, payload: intent.payload ?? {} };
}
