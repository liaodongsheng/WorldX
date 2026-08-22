import { useCallback, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { CharacterInfo } from "../../types/api";
import { apiClient } from "../services/api-client";

type XiuxianStatus = {
  enabled: boolean;
  version: string;
  protagonist: { playerId: string; characterId: string } | null;
  cultivation: null | {
    name: string;
    realmId: string;
    cultivation: number;
    hp: number;
    maxHp: number;
    qi: number;
    maxQi: number;
    learnedTechniqueIds: string[];
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
  members: Array<{ playerId: string; characterId: string | null; displayName: string; role: string; online: boolean }>;
};

type RoomSession = { roomId: string; resumeToken: string; clientSequence: number };

export function XiuxianPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<XiuxianStatus | null>(null);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [session, setSession] = useState<RoomSession | null>(() => loadSession());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef(getOrCreatePlayerId());
  const playerId = playerIdRef.current;

  const refresh = useCallback(async () => {
    const [nextStatus, nextCharacters, nextRooms] = await Promise.all([
      apiClient.getXiuxianStatus() as Promise<XiuxianStatus>,
      apiClient.getCharacters(),
      apiClient.getXiuxianRooms() as Promise<Room[]>,
    ]);
    setStatus(nextStatus);
    setCharacters(nextCharacters);
    setRooms(nextRooms);
    if (!selectedCharacterId && nextCharacters[0]) setSelectedCharacterId(nextCharacters[0].id);
  }, [selectedCharacterId]);

  useEffect(() => {
    if (!open) return;
    refresh().catch((cause) => setError(messageOf(cause)));
  }, [open, refresh]);

  useEffect(() => {
    if (!session) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({
      type: "xiuxian_room_auth",
      data: { roomId: session.roomId, playerId, resumeToken: session.resumeToken },
    }));
    socket.onmessage = (raw) => {
      try {
        const message = JSON.parse(raw.data);
        if (message.type === "xiuxian_error") setError(message.data?.message ?? "联机请求失败");
        if (["xiuxian_room_authenticated", "xiuxian_action_resolved", "xiuxian_presence", "xiuxian_room_state"].includes(message.type)) {
          refresh().catch(console.warn);
        }
      } catch (cause) {
        console.warn("[XiuxianPanel] WebSocket message error", cause);
      }
    };
    socket.onclose = () => { if (socketRef.current === socket) socketRef.current = null; };
    return () => socket.close();
  }, [playerId, refresh, session?.roomId, session?.resumeToken]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitIntent = (type: string, payload: Record<string, unknown> = {}) => act(async () => {
    if (session && socketRef.current?.readyState === WebSocket.OPEN) {
      const next = { ...session, clientSequence: session.clientSequence + 1 };
      setSession(next);
      saveSession(next);
      socketRef.current.send(JSON.stringify({ type: "xiuxian_intent", data: { clientSequence: next.clientSequence, intent: { type, payload } } }));
      return;
    }
    await apiClient.submitXiuxianAction({ playerId, type, payload });
  });

  const useRoomSession = (roomId: string, resumeToken: string) => {
    const next = { roomId, resumeToken, clientSequence: 0 };
    setSession(next);
    saveSession(next);
  };

  const isProtagonist = status?.protagonist?.playerId === playerId;
  const currentRoom = rooms.find((room) => room.id === session?.roomId) ?? null;

  return (
    <div style={{ position: "fixed", left: 18, bottom: 18, zIndex: 120, pointerEvents: "auto" }}>
      {!open && (
        <button onClick={() => setOpen(true)} style={launcherStyle} title="进入万劫问仙">
          <span style={{ fontSize: 24 }}>仙</span>
          <span style={{ fontSize: 11, letterSpacing: 2 }}>问道</span>
        </button>
      )}
      {open && (
        <section style={panelStyle}>
          <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#b7f7df,#7c8cff)", color: "#11162c", fontWeight: 900, fontSize: 20 }}>仙</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#f2f5ff", fontWeight: 800, letterSpacing: 2 }}>万劫问仙</div>
              <div style={{ color: "#8f9abb", fontSize: 11 }}>固定终局 · 自由历程 · 联机共世</div>
            </div>
            <button onClick={() => setOpen(false)} style={iconButtonStyle}>×</button>
          </header>

          {error && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,91,115,.13)", color: "#ff9bab", fontSize: 12, marginBottom: 10 }}>{error}</div>}

          {!status && <div style={mutedStyle}>正在读取天机……</div>}

          {status && !status.protagonist && (
            <div style={cardStyle}>
              <Title>选择天命主角</Title>
              <select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)} style={inputStyle}>
                {characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.role}</option>)}
              </select>
              <button disabled={busy || !selectedCharacterId} style={primaryButtonStyle} onClick={() => act(() => apiClient.bindXiuxianProtagonist({ playerId, characterId: selectedCharacterId }))}>以此身入局</button>
            </div>
          )}

          {status?.protagonist && (
            <>
              <div style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Title>{status.story.status === "completed" ? status.story.ending?.title : status.story.chapter?.title}</Title>
                  <span style={{ color: isProtagonist ? "#8ff0cc" : "#aeb7d2", fontSize: 11 }}>{isProtagonist ? "天命主角" : "共世修士"}</span>
                </div>
                <div style={mutedStyle}>{status.story.status === "completed" ? status.story.ending?.summary : status.story.chapter?.summary}</div>
                {status.story.nextAnchor && <div style={{ marginTop: 8, padding: 8, borderLeft: "2px solid #8de5c4", background: "rgba(141,229,196,.07)", color: "#dbe6ff", fontSize: 12 }}>下一命数：{status.story.nextAnchor.title}</div>}
              </div>

              {status.cultivation && (
                <div style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><Title>{realmName(status.cultivation.realmId)}</Title><span style={{ color: "#8f9abb", fontSize: 11 }}>修为 {status.cultivation.cultivation}</span></div>
                  <Meter label="气血" value={status.cultivation.hp} max={status.cultivation.maxHp} color="#ef6f88" />
                  <Meter label="灵力" value={status.cultivation.qi} max={status.cultivation.maxQi} color="#70a7ff" />
                  {isProtagonist && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 10 }}>
                    <Action disabled={busy} onClick={() => submitIntent("meditate", { hours: 1 })}>吐纳一时</Action>
                    <Action disabled={busy} onClick={() => submitIntent("meditate", { hours: 4 })}>闭关四时</Action>
                    <Action disabled={busy} onClick={() => act(() => apiClient.attemptXiuxianBreakthrough({ playerId }))}>冲击境界</Action>
                  </div>}
                </div>
              )}

              {isProtagonist && (
                <div style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Title>天机意外</Title>
                    {!status.accident && <button disabled={busy} style={smallButtonStyle} onClick={() => act(() => apiClient.proposeXiuxianAccident())}>推演一次</button>}
                  </div>
                  {!status.accident && <div style={mutedStyle}>当前没有突发因果。意外不会跳过主线。</div>}
                  {status.accident && <>
                    <div style={{ color: "#f0d99b", fontWeight: 700, fontSize: 13 }}>{status.accident.title}</div>
                    <div style={{ ...mutedStyle, margin: "5px 0 8px" }}>{status.accident.description}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {status.accident.choices.map((choice) => <Action key={choice.id} disabled={busy} onClick={() => act(() => apiClient.resolveXiuxianAccident({ playerId, instanceId: status.accident!.instanceId, choiceId: choice.id }))}>{choice.label}</Action>)}
                    </div>
                  </>}
                </div>
              )}

              <div style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><Title>共世联机</Title><span style={{ color: currentRoom?.status === "active" ? "#8ff0cc" : "#8f9abb", fontSize: 11 }}>{currentRoom ? `${currentRoom.members.length}/${currentRoom.maxPlayers}` : "未入房"}</span></div>
                {currentRoom ? <div style={mutedStyle}>房间 {currentRoom.id} · {currentRoom.status === "active" ? "世界同步中" : "等待主角恢复"}</div> : <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {isProtagonist && <button disabled={busy} style={primaryButtonStyle} onClick={() => act(async () => {
                    const result = await apiClient.createXiuxianRoom({ playerId, displayName: status.cultivation?.name ?? "主角", maxPlayers: 32 }) as { room: Room; resumeToken: string };
                    useRoomSession(result.room.id, result.resumeToken);
                  })}>创建 32 人世界</button>}
                  {rooms.map((room) => <button key={room.id} disabled={busy || room.members.length >= room.maxPlayers} style={smallButtonStyle} onClick={() => act(async () => {
                    const character = characters.find((item) => item.id === selectedCharacterId) ?? characters.find((item) => item.id !== room.protagonistCharacterId);
                    const result = await apiClient.joinXiuxianRoom(room.id, { playerId, characterId: character?.id, displayName: character?.name ?? "游历修士", role: "companion" }) as { room: Room; resumeToken: string };
                    useRoomSession(result.room.id, result.resumeToken);
                  })}>加入 {room.id}</button>)}
                </div>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Title({ children }: { children: ReactNode }) { return <div style={{ color: "#eef2ff", fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{children}</div>; }
function Action({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} style={smallButtonStyle}>{children}</button>; }
function Meter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  return <div style={{ marginTop: 6 }}><div style={{ display: "flex", justifyContent: "space-between", color: "#9aa5c5", fontSize: 10 }}><span>{label}</span><span>{value}/{max}</span></div><div style={{ height: 5, background: "rgba(255,255,255,.08)", borderRadius: 5, overflow: "hidden", marginTop: 3 }}><div style={{ width: `${percent}%`, height: "100%", background: color }} /></div></div>;
}

function getOrCreatePlayerId() {
  const key = "worldx-xiuxian-player-id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
function loadSession(): RoomSession | null { try { const raw = localStorage.getItem("worldx-xiuxian-room"); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveSession(session: RoomSession) { localStorage.setItem("worldx-xiuxian-room", JSON.stringify(session)); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
function realmName(id: string) { return ({ mortal: "凡人", qi_refining: "炼气", foundation: "筑基", golden_core: "金丹", nascent_soul: "元婴", spirit_transformation: "化神", void_refining: "炼虚", tribulation: "渡劫", mahayana: "大乘" } as Record<string, string>)[id] ?? id; }

const panelStyle: CSSProperties = { width: 372, maxHeight: "calc(100vh - 90px)", overflowY: "auto", padding: 14, borderRadius: 18, background: "linear-gradient(160deg,rgba(12,19,38,.97),rgba(24,19,45,.96))", border: "1px solid rgba(156,210,255,.22)", boxShadow: "0 24px 80px rgba(0,0,0,.55), inset 0 1px rgba(255,255,255,.05)", backdropFilter: "blur(18px)" };
const launcherStyle: CSSProperties = { width: 64, height: 70, border: "1px solid rgba(155,236,209,.55)", borderRadius: 22, background: "radial-gradient(circle at 30% 20%,#b7f7df,#6676db 58%,#1b2044)", color: "#10172b", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 12px 34px rgba(50,65,160,.5)" };
const cardStyle: CSSProperties = { padding: 11, marginBottom: 9, borderRadius: 12, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.075)" };
const mutedStyle: CSSProperties = { color: "#99a4c3", fontSize: 11, lineHeight: 1.55 };
const inputStyle: CSSProperties = { width: "100%", padding: "9px 10px", marginBottom: 8, color: "#eaf0ff", background: "#151b32", border: "1px solid rgba(255,255,255,.13)", borderRadius: 8 };
const primaryButtonStyle: CSSProperties = { padding: "8px 11px", color: "#11182d", background: "linear-gradient(135deg,#9ce7cf,#8ca6ff)", border: 0, borderRadius: 8, cursor: "pointer", fontWeight: 800, fontSize: 11 };
const smallButtonStyle: CSSProperties = { padding: "6px 9px", color: "#dce5ff", background: "rgba(126,149,223,.15)", border: "1px solid rgba(148,174,255,.22)", borderRadius: 7, cursor: "pointer", fontSize: 11 };
const iconButtonStyle: CSSProperties = { width: 28, height: 28, borderRadius: 9, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.05)", color: "#bdc5dc", cursor: "pointer", fontSize: 18 };
