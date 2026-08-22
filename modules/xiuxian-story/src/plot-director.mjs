import { validateOutline } from "./outline-loader.mjs";

export class PlotDirector {
  #outline;
  #state;

  constructor(outline, savedState) {
    this.#outline = validateOutline(outline);
    this.#state = restoreState(savedState, this.#outline);
  }

  get outline() { return structuredClone(this.#outline); }
  get state() { return structuredClone(this.#state); }
  get currentChapter() {
    if (this.#state.status === "completed") return null;
    return structuredClone(this.#outline.chapters[this.#state.chapterIndex]);
  }

  ingestEvent(event) {
    const normalized = normalizeEvent(event);
    if (this.#state.status === "completed") return this.#result([], false);

    const chapter = this.#outline.chapters[this.#state.chapterIndex];
    const matched = chapter.anchors.filter((anchor) =>
      !this.#state.completedAnchorIds.includes(anchor.id) &&
      matchesAnchor(normalized, anchor, this.#state.protagonistCharacterId),
    );
    for (const anchor of matched) {
      this.#state.completedAnchorIds.push(anchor.id);
      this.#state.history.push({
        kind: "anchor_completed",
        anchorId: anchor.id,
        chapterId: chapter.id,
        eventId: normalized.id,
        at: normalized.at,
      });
    }
    const advanced = this.#advanceIfReady();
    return this.#result(matched.map((anchor) => anchor.id), advanced);
  }

  bindProtagonist(characterId) {
    if (typeof characterId !== "string" || characterId.trim() === "") throw new Error("主角角色 ID 不能为空");
    if (this.#state.protagonistCharacterId && this.#state.protagonistCharacterId !== characterId) {
      throw new Error("本时间线已经绑定其他主角");
    }
    this.#state.protagonistCharacterId = characterId;
    return this.state;
  }

  guidance() {
    if (this.#state.status === "completed") {
      return { status: "completed", ending: structuredClone(this.#outline.canonicalEnding) };
    }
    const chapter = this.#outline.chapters[this.#state.chapterIndex];
    const pending = chapter.anchors.filter((anchor) => !this.#state.completedAnchorIds.includes(anchor.id));
    return {
      status: "active",
      chapter: { id: chapter.id, title: chapter.title, summary: chapter.summary },
      nextAnchor: pending[0] ? structuredClone(pending[0]) : null,
      completedAnchorIds: [...this.#state.completedAnchorIds],
    };
  }

  #advanceIfReady() {
    const chapter = this.#outline.chapters[this.#state.chapterIndex];
    if (!chapter.anchors.every((anchor) => this.#state.completedAnchorIds.includes(anchor.id))) return false;
    this.#state.completedChapterIds.push(chapter.id);
    this.#state.history.push({ kind: "chapter_completed", chapterId: chapter.id, at: new Date().toISOString() });
    if (this.#state.chapterIndex === this.#outline.chapters.length - 1) {
      this.#state.status = "completed";
      this.#state.endingId = this.#outline.canonicalEnding.id;
    } else {
      this.#state.chapterIndex += 1;
    }
    return true;
  }

  #result(matchedAnchorIds, advanced) {
    return {
      matchedAnchorIds,
      advanced,
      status: this.#state.status,
      chapterId: this.currentChapter?.id ?? null,
      endingId: this.#state.endingId,
      guidance: this.guidance(),
    };
  }
}

function restoreState(savedState, outline) {
  const initial = {
    version: 1,
    outlineId: outline.id,
    status: "active",
    chapterIndex: 0,
    protagonistCharacterId: null,
    completedAnchorIds: [],
    completedChapterIds: [],
    endingId: null,
    history: [],
  };
  if (!savedState) return initial;
  if (savedState.version !== 1 || savedState.outlineId !== outline.id) throw new Error("剧情存档与当前大纲不兼容");
  if (!Number.isInteger(savedState.chapterIndex) || savedState.chapterIndex < 0 || savedState.chapterIndex >= outline.chapters.length) {
    throw new Error("剧情存档的章节位置无效");
  }
  return {
    ...initial,
    ...structuredClone(savedState),
    completedAnchorIds: [...(savedState.completedAnchorIds ?? [])],
    completedChapterIds: [...(savedState.completedChapterIds ?? [])],
    history: [...(savedState.history ?? [])],
  };
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") throw new TypeError("世界事件必须是对象");
  const tags = Array.isArray(event.tags) ? event.tags.filter((tag) => typeof tag === "string") : [];
  return {
    id: event.id || `event-${Date.now()}`,
    actorId: event.actorId ?? null,
    tags: new Set(tags),
    at: event.at || new Date().toISOString(),
  };
}

function matchesAnchor(event, anchor, protagonistId) {
  if (anchor.match?.actor === "protagonist" && event.actorId !== protagonistId) return false;
  const allTags = anchor.match?.allTags ?? [];
  const anyTags = anchor.match?.anyTags ?? [];
  return allTags.every((tag) => event.tags.has(tag)) &&
    (anyTags.length === 0 || anyTags.some((tag) => event.tags.has(tag)));
}
