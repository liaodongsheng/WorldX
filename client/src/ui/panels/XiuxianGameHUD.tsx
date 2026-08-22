import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type Phaser from "phaser";
import type {
  XiuxianGameplayToast,
  XiuxianInteractionContext,
} from "../../types/xiuxian-gameplay";
import { apiClient } from "../services/api-client";
import { getOrCreateXiuxianPlayerId } from "../utils/xiuxian-player";

type XiuxianStatus = {
  enabled: boolean;
  protagonist: { playerId: string; characterId: string } | null;
  cultivation: null | {
    name: string;
    realmId: string;
    cultivation: number;
    hp: number;
    maxHp: number;
    qi: number;
    maxQi: number;
  };
  story: {
    status: "active" | "completed";
    chapter?: { id: string; title: string; summary: string };
    nextAnchor?: { id: string; title: string; description: string } | null;
    ending?: { title: string; summary: string };
  };
  accident: null | {
    instanceId: string;
    title: string;
    description: string;
    choices: Array<{ id: string; label: string }>;
  };
};

type Room = {
  id: string;
  status: string;
  hostPlayerId: string;
  protagonistCharacterId: string;
  maxPlayers: number;
  members: Array<{
    playerId: string;
    characterId: string | null;
    displayName: string;
    role: string;
    online: boolean;
  }>;
};

type RoomSession = { roomId: string; resumeToken: string; clientSequence: number };

export function XiuxianGameHUD({
  eventBus,
  onLeave,
}: {
  eventBus: Phaser.Events.EventEmitter;
  onLeave: () => void;
}) {
  const playerIdRef = useRef(getOrCreateXiuxianPlayerId());
  const playerId = playerIdRef.current;
  const [status, setStatus] = useState<XiuxianStatus | null>(null);
  const [interaction, setInteraction] = useState<XiuxianInteractionContext | null>(null);
  const [toast, setToast] = useState<XiuxianGameplayToast | null>(null);
  const [busy, setBusy] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [session, setSession] = useState<RoomSession | null>(() => loadRoomSession());
  const socketRef = useRef<WebSocket | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [nextStatus, nextRooms] = await Promise.all([
      apiClient.getXiuxianStatus() as Promise<XiuxianStatus>,
      apiClient.getXiuxianRooms() as Promise<Room[]>,
    ]);
    setStatus(nextStatus);
    setRooms(nextRooms);
  }, []);

  const showToast = useCallback((next: XiuxianGameplayToast) => {
    setToast(next);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    refresh().catch((error) => showToast({ tone: "error", message: messageOf(error) }));
    const onRefresh = () => refresh().catch((error) =>
      showToast({ tone: "error", message: messageOf(error) }),
    );
    const onContext = (next: XiuxianInteractionContext | null) => setInteraction(next);
    const onToast = (next: XiuxianGameplayToast) => showToast(next);
    eventBus.on("xiuxian_status_changed", onRefresh);
    eventBus.on("xiuxian_control_ready", onRefresh);
    eventBus.on("xiuxian_interaction_context", onContext);
    eventBus.on("xiuxian_gameplay_toast", onToast);
    return () => {
      eventBus.off("xiuxian_status_changed", onRefresh);
      eventBus.off("xiuxian_control_ready", onRefresh);
      eventBus.off("xiuxian_interaction_context", onContext);
      eventBus.off("xiuxian_gameplay_toast", onToast);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [eventBus, refresh, showToast]);

  useEffect(() => {
    if (!session) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({
      type: "xiuxian_room_auth",
      data: {
        roomId: session.roomId,
        playerId,
        resumeToken: session.resumeToken,
      },
    }));
    socket.onmessage = (raw) => {
      try {
        const message = JSON.parse(raw.data);
        if (message.type === "xiuxian_error") {
          showToast({ tone: "error", message: message.data?.message ?? "共世连接失败" });
        }
        if ([
          "xiuxian_room_authenticated",
          "xiuxian_action_resolved",
          "xiuxian_presence",
          "xiuxian_room_state",
        ].includes(message.type)) {
          refresh().catch(console.warn);
        }
      } catch (error) {
        console.warn("[XiuxianGameHUD] WebSocket message error", error);
      }
    };
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
    };
    return () => socket.close();
  }, [playerId, refresh, session?.roomId, session?.resumeToken, showToast]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await refresh();
      eventBus.emit("xiuxian_status_changed");
    } catch (error) {
      showToast({ tone: "error", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, eventBus, refresh, showToast]);

  const meditate = useCallback(() => run(() =>
    apiClient.submitXiuxianAction({
      playerId,
      type: "meditate",
      payload: { hours: 1 },
    }),
  ), [playerId, run]);

  const breakthrough = useCallback(() => run(() =>
    apiClient.attemptXiuxianBreakthrough({ playerId }),
  ), [playerId, run]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (event.code === "Digit1") void meditate();
      if (event.code === "Digit2") void breakthrough();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [breakthrough, meditate]);

  const cultivation = status?.cultivation;
  const currentRoom = rooms.find((room) => room.id === session?.roomId) ?? null;
  const storyTitle = status?.story.status === "completed"
    ? status.story.ending?.title
    : status?.story.chapter?.title;
  const storyText = status?.story.status === "completed"
    ? status.story.ending?.summary
    : status?.story.nextAnchor?.description ?? status?.story.chapter?.summary;

  return (
    <div style={rootStyle}>
      <section style={questStyle}>
        <div style={eyebrowStyle}>当前道途</div>
        <div style={questTitleStyle}>{storyTitle ?? "正在感应天命……"}</div>
        <div style={questTextStyle}>{storyText ?? "靠近人物或场景物，按 E 与世界互动。"}</div>
      </section>

      <div style={topRightStyle}>
        <button style={ghostButtonStyle} onClick={() => setRoomsOpen((value) => !value)}>
          {currentRoom ? `共世 ${currentRoom.members.length}/${currentRoom.maxPlayers}` : "共世联机"}
        </button>
        <button style={ghostButtonStyle} onClick={onLeave}>退出地图</button>
      </div>

      {roomsOpen && (
        <section style={roomDrawerStyle}>
          <div style={drawerTitleStyle}>共世修行</div>
          {currentRoom ? (
            <>
              <div style={drawerMutedStyle}>房间 {currentRoom.id}</div>
              <div style={memberListStyle}>
                {currentRoom.members.map((member) => (
                  <span key={member.playerId} style={memberStyle}>
                    <i style={{ ...presenceDotStyle, background: member.online ? "#79efc2" : "#68718b" }} />
                    {member.displayName}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <>
              <button
                disabled={busy || !status?.protagonist || status.protagonist.playerId !== playerId}
                style={primaryButtonStyle}
                onClick={() => run(async () => {
                  const result = await apiClient.createXiuxianRoom({
                    playerId,
                    displayName: cultivation?.name ?? "陆尘",
                    maxPlayers: 32,
                  }) as { room: Room; resumeToken: string };
                  useRoomSession(result.room.id, result.resumeToken, setSession);
                })}
              >
                创建共世
              </button>
              {rooms.map((room) => (
                <button
                  key={room.id}
                  disabled={busy || room.members.length >= room.maxPlayers}
                  style={roomButtonStyle}
                  onClick={() => run(async () => {
                    const characters = await apiClient.getCharacters();
                    const character = characters.find((item) =>
                      item.id !== room.protagonistCharacterId &&
                      !room.members.some((member) => member.characterId === item.id)
                    );
                    const result = await apiClient.joinXiuxianRoom(room.id, {
                      playerId,
                      characterId: character?.id,
                      displayName: character?.name ?? "游历修士",
                      role: "companion",
                    }) as { room: Room; resumeToken: string };
                    useRoomSession(result.room.id, result.resumeToken, setSession);
                  })}
                >
                  加入 {room.id} · {room.members.length}/{room.maxPlayers}
                </button>
              ))}
            </>
          )}
        </section>
      )}

      {toast && (
        <div style={{
          ...toastStyle,
          borderColor: toast.tone === "error" ? "rgba(255,111,135,.65)" : "rgba(125,245,205,.55)",
        }}>
          {toast.message}
        </div>
      )}

      <section style={vitalsStyle}>
        <div style={portraitStyle}>尘</div>
        <div style={{ minWidth: 150 }}>
          <div style={vitalsHeaderStyle}>
            <strong>{cultivation?.name ?? "陆尘"}</strong>
            <span>{realmName(cultivation?.realmId)}</span>
          </div>
          <Meter value={cultivation?.hp ?? 0} max={cultivation?.maxHp ?? 1} color="#ef7088" />
          <Meter value={cultivation?.qi ?? 0} max={cultivation?.maxQi ?? 1} color="#65b5ff" />
        </div>
        <div style={dpadStyle}>
          <MoveButton label="▲" onPress={() => eventBus.emit("xiuxian_move_direction", { dx: 0, dy: -1 })} area="up" />
          <MoveButton label="◀" onPress={() => eventBus.emit("xiuxian_move_direction", { dx: -1, dy: 0 })} area="left" />
          <MoveButton label="▼" onPress={() => eventBus.emit("xiuxian_move_direction", { dx: 0, dy: 1 })} area="down" />
          <MoveButton label="▶" onPress={() => eventBus.emit("xiuxian_move_direction", { dx: 1, dy: 0 })} area="right" />
        </div>
      </section>

      <section style={actionBarStyle}>
        <ActionButton hotkey="1" label="吐纳" disabled={busy} onClick={() => void meditate()} />
        <ActionButton hotkey="2" label="突破" disabled={busy} onClick={() => void breakthrough()} />
      </section>

      {interaction && (
        <button
          style={interactionStyle}
          onClick={() => eventBus.emit("xiuxian_interact")}
        >
          <span style={keyStyle}>E</span>
          <span>{interaction.actionLabel}</span>
        </button>
      )}

      {status?.accident && (
        <div style={encounterBackdropStyle}>
          <section style={encounterStyle}>
            <div style={eyebrowStyle}>突发因果</div>
            <h2 style={encounterTitleStyle}>{status.accident.title}</h2>
            <p style={encounterTextStyle}>{status.accident.description}</p>
            <div style={choiceListStyle}>
              {status.accident.choices.map((choice) => (
                <button
                  key={choice.id}
                  disabled={busy}
                  style={choiceButtonStyle}
                  onClick={() => run(() => apiClient.resolveXiuxianAccident({
                    playerId,
                    instanceId: status.accident!.instanceId,
                    choiceId: choice.id,
                  }))}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const percent = Math.max(0, Math.min(100, max > 0 ? value / max * 100 : 0));
  return (
    <div style={meterTrackStyle}>
      <div style={{ ...meterFillStyle, width: `${percent}%`, background: color }} />
      <span style={meterTextStyle}>{value}/{max}</span>
    </div>
  );
}

function ActionButton({
  hotkey,
  label,
  disabled,
  onClick,
}: {
  hotkey: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button disabled={disabled} style={actionButtonStyle} onClick={onClick}>
      <span style={hotkeyStyle}>{hotkey}</span>
      <span>{label}</span>
    </button>
  );
}

function MoveButton({
  label,
  onPress,
  area,
}: {
  label: string;
  onPress: () => void;
  area: string;
}) {
  return (
    <button
      aria-label={area}
      onPointerDown={onPress}
      style={{ ...moveButtonStyle, gridArea: area }}
    >
      {label}
    </button>
  );
}

function useRoomSession(
  roomId: string,
  resumeToken: string,
  setSession: (session: RoomSession) => void,
) {
  const next = { roomId, resumeToken, clientSequence: 0 };
  localStorage.setItem("worldx-xiuxian-room", JSON.stringify(next));
  setSession(next);
}

function loadRoomSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem("worldx-xiuxian-room");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function realmName(id?: string): string {
  return ({
    mortal: "凡人",
    qi_refining: "炼气",
    foundation: "筑基",
    golden_core: "金丹",
    nascent_soul: "元婴",
    spirit_transformation: "化神",
    void_refining: "炼虚",
    tribulation: "渡劫",
    mahayana: "大乘",
  } as Record<string, string>)[id ?? ""] ?? "未入道";
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const rootStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 110,
  pointerEvents: "none",
  color: "#f4f7ff",
  fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif",
};
const glassStyle: CSSProperties = {
  background: "linear-gradient(145deg,rgba(7,15,27,.88),rgba(15,27,42,.8))",
  border: "1px solid rgba(143,231,216,.22)",
  boxShadow: "0 12px 40px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.04)",
  backdropFilter: "blur(12px)",
};
const questStyle: CSSProperties = {
  ...glassStyle,
  position: "absolute",
  left: 18,
  top: 18,
  width: 310,
  padding: "12px 14px",
  borderRadius: 12,
};
const eyebrowStyle: CSSProperties = {
  color: "#83e6c7",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 3,
  textTransform: "uppercase",
};
const questTitleStyle: CSSProperties = { marginTop: 4, fontSize: 16, fontWeight: 900 };
const questTextStyle: CSSProperties = { marginTop: 5, color: "#bdc9d8", fontSize: 11, lineHeight: 1.5 };
const topRightStyle: CSSProperties = {
  position: "absolute",
  right: 18,
  top: 18,
  display: "flex",
  gap: 8,
  pointerEvents: "auto",
};
const ghostButtonStyle: CSSProperties = {
  ...glassStyle,
  padding: "8px 12px",
  borderRadius: 9,
  color: "#dce8f1",
  cursor: "pointer",
};
const roomDrawerStyle: CSSProperties = {
  ...glassStyle,
  position: "absolute",
  right: 18,
  top: 62,
  width: 270,
  padding: 13,
  borderRadius: 12,
  pointerEvents: "auto",
};
const drawerTitleStyle: CSSProperties = { fontWeight: 900, marginBottom: 8 };
const drawerMutedStyle: CSSProperties = { color: "#96a8bb", fontSize: 11, marginBottom: 8 };
const memberListStyle: CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap" };
const memberStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#cbd6e4" };
const presenceDotStyle: CSSProperties = { width: 6, height: 6, borderRadius: "50%" };
const primaryButtonStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: 0,
  borderRadius: 8,
  background: "linear-gradient(135deg,#8af0ce,#74a8ff)",
  color: "#0a1722",
  fontWeight: 900,
  cursor: "pointer",
};
const roomButtonStyle: CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid rgba(137,213,222,.2)",
  background: "rgba(83,125,151,.14)",
  color: "#d8e3ed",
  cursor: "pointer",
  textAlign: "left",
};
const toastStyle: CSSProperties = {
  ...glassStyle,
  position: "absolute",
  top: 20,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "9px 14px",
  borderRadius: 10,
  fontSize: 12,
};
const vitalsStyle: CSSProperties = {
  ...glassStyle,
  position: "absolute",
  left: 18,
  bottom: 18,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  pointerEvents: "auto",
};
const portraitStyle: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 35% 25%,#b7ffe5,#48928c 55%,#182b3b)",
  color: "#07151a",
  fontSize: 20,
  fontWeight: 900,
  boxShadow: "0 0 18px rgba(89,239,205,.25)",
};
const vitalsHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  fontSize: 11,
  marginBottom: 4,
  color: "#c4d2dd",
};
const meterTrackStyle: CSSProperties = {
  position: "relative",
  width: 160,
  height: 8,
  marginTop: 4,
  overflow: "hidden",
  borderRadius: 5,
  background: "rgba(255,255,255,.09)",
};
const meterFillStyle: CSSProperties = { height: "100%", borderRadius: 5 };
const meterTextStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  fontSize: 7,
  color: "#fff",
  textShadow: "0 1px 2px #000",
};
const dpadStyle: CSSProperties = {
  display: "grid",
  gridTemplateAreas: '". up ." "left down right"',
  gridTemplateColumns: "26px 26px 26px",
  gap: 2,
  marginLeft: 4,
};
const moveButtonStyle: CSSProperties = {
  width: 26,
  height: 24,
  padding: 0,
  border: "1px solid rgba(154,225,216,.22)",
  borderRadius: 6,
  background: "rgba(109,178,177,.12)",
  color: "#bcefe3",
  cursor: "pointer",
};
const actionBarStyle: CSSProperties = {
  position: "absolute",
  right: 18,
  bottom: 18,
  display: "flex",
  gap: 8,
  pointerEvents: "auto",
};
const actionButtonStyle: CSSProperties = {
  ...glassStyle,
  width: 62,
  height: 62,
  borderRadius: 14,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  color: "#e7f5ef",
  cursor: "pointer",
  fontWeight: 800,
};
const hotkeyStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  borderRadius: 5,
  background: "rgba(132,237,207,.14)",
  color: "#87eccf",
  fontSize: 10,
};
const interactionStyle: CSSProperties = {
  ...glassStyle,
  position: "absolute",
  left: "50%",
  bottom: 24,
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 15px",
  borderRadius: 999,
  color: "#f3fbf8",
  pointerEvents: "auto",
  cursor: "pointer",
  fontWeight: 800,
};
const keyStyle: CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  borderRadius: 7,
  background: "#84eacf",
  color: "#0b2325",
  fontSize: 12,
  fontWeight: 900,
};
const encounterBackdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle,rgba(10,18,29,.28),rgba(3,6,12,.72))",
  pointerEvents: "auto",
};
const encounterStyle: CSSProperties = {
  ...glassStyle,
  width: "min(430px,calc(100vw - 36px))",
  padding: 22,
  borderRadius: 18,
  borderColor: "rgba(238,202,126,.35)",
};
const encounterTitleStyle: CSSProperties = { margin: "7px 0 8px", fontSize: 22 };
const encounterTextStyle: CSSProperties = { color: "#c8d0da", fontSize: 13, lineHeight: 1.7 };
const choiceListStyle: CSSProperties = { display: "grid", gap: 8, marginTop: 16 };
const choiceButtonStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid rgba(224,193,123,.24)",
  background: "rgba(116,87,44,.16)",
  color: "#f5e4bd",
  cursor: "pointer",
  textAlign: "left",
};
