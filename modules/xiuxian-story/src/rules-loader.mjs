import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadCultivationRules(moduleDir = DEFAULT_MODULE_DIR) {
  const raw = await readFile(path.join(moduleDir, "data", "cultivation-rules.json"), "utf8");
  return validateCultivationRules(JSON.parse(raw));
}

export function validateCultivationRules(rules) {
  if (rules?.schemaVersion !== 1) throw new Error("不支持的修仙规则版本");
  if (!Array.isArray(rules.realms) || rules.realms.length < 2) throw new Error("至少需要两个修炼境界");
  if (!Array.isArray(rules.techniques)) throw new Error("功法列表无效");
  const realmIds = uniqueIds(rules.realms, "境界");
  uniqueIds(rules.techniques, "功法");
  for (const technique of rules.techniques) {
    if (!realmIds.has(technique.requiredRealm)) throw new Error(`功法 ${technique.id} 的境界要求不存在`);
  }
  return structuredClone(rules);
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id) throw new Error(`${label} ID 不能为空`);
    if (ids.has(item.id)) throw new Error(`${label} ID 重复: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}
