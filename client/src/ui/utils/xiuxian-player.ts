export const XIUXIAN_WORLD_ID = "world_xiuxian_wanjie";
export const XIUXIAN_DEFAULT_PROTAGONIST_ID = "char_1776587617698";

export function getOrCreateXiuxianPlayerId(): string {
  const key = "worldx-xiuxian-player-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
