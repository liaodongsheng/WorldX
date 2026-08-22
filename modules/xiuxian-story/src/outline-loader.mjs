import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadOutline(moduleDir = DEFAULT_MODULE_DIR) {
  const raw = await readFile(path.join(moduleDir, "story", "outline.json"), "utf8");
  return validateOutline(JSON.parse(raw));
}

export function validateOutline(outline) {
  if (!outline || typeof outline !== "object") throw new TypeError("修仙故事大纲必须是对象");
  if (outline.schemaVersion !== 1) throw new Error(`不支持的大纲版本: ${outline.schemaVersion}`);
  requireText(outline.id, "outline.id");
  requireText(outline.title, "outline.title");
  if (!Array.isArray(outline.chapters) || outline.chapters.length === 0) throw new Error("大纲至少需要一个章节");

  const chapterIds = new Set();
  const anchorIds = new Set();
  for (const [chapterIndex, chapter] of outline.chapters.entries()) {
    requireText(chapter.id, `chapters[${chapterIndex}].id`);
    requireText(chapter.title, `chapters[${chapterIndex}].title`);
    if (chapterIds.has(chapter.id)) throw new Error(`章节 ID 重复: ${chapter.id}`);
    chapterIds.add(chapter.id);
    if (!Array.isArray(chapter.anchors) || chapter.anchors.length === 0) throw new Error(`章节 ${chapter.id} 至少需要一个剧情锚点`);
    for (const [anchorIndex, anchor] of chapter.anchors.entries()) {
      requireText(anchor.id, `chapters[${chapterIndex}].anchors[${anchorIndex}].id`);
      requireText(anchor.title, `chapters[${chapterIndex}].anchors[${anchorIndex}].title`);
      if (anchorIds.has(anchor.id)) throw new Error(`剧情锚点 ID 重复: ${anchor.id}`);
      anchorIds.add(anchor.id);
      const allTags = anchor.match?.allTags ?? [];
      const anyTags = anchor.match?.anyTags ?? [];
      if (allTags.length === 0 && anyTags.length === 0) throw new Error(`剧情锚点 ${anchor.id} 缺少匹配标签`);
    }
  }

  requireText(outline.canonicalEnding?.id, "canonicalEnding.id");
  requireText(outline.canonicalEnding?.title, "canonicalEnding.title");
  if (!anchorIds.has(outline.canonicalEnding.finalAnchorId)) {
    throw new Error(`固定结局引用了不存在的剧情锚点: ${outline.canonicalEnding.finalAnchorId}`);
  }
  return structuredClone(outline);
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} 不能为空`);
}
