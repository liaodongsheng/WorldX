export class AccidentEngine {
  #config;
  #state;

  constructor(config, savedState) {
    this.#config = validateAccidentConfig(config);
    this.#state = restoreState(savedState);
  }

  get state() { return structuredClone(this.#state); }

  propose({ chapterIndex, worldTick, random = Math.random }) {
    requireNonNegativeInteger(chapterIndex, "chapterIndex");
    requireNonNegativeInteger(worldTick, "worldTick");
    if (this.#state.active) return structuredClone(this.#state.active);
    const eligible = this.#config.templates.filter((template) =>
      template.minimumChapter <= chapterIndex &&
      worldTick >= (this.#state.nextAvailableTickByTemplate[template.id] ?? 0),
    );
    if (eligible.length === 0) return null;
    const selected = weightedPick(eligible, random);
    const active = {
      instanceId: `accident-${worldTick}-${this.#state.sequence + 1}`,
      templateId: selected.id,
      title: selected.title,
      description: selected.description,
      impact: selected.impact,
      choices: structuredClone(selected.choices),
      proposedAtTick: worldTick,
    };
    this.#state.sequence += 1;
    this.#state.active = active;
    return structuredClone(active);
  }

  resolve({ instanceId, choiceId, actorId, worldTick }) {
    const active = this.#state.active;
    if (!active || active.instanceId !== instanceId) throw new Error("意外事件不存在或已经结束");
    const template = this.#config.templates.find((item) => item.id === active.templateId);
    const choice = template.choices.find((item) => item.id === choiceId);
    if (!choice) throw new Error("无效的意外事件选择");
    const event = {
      id: `${instanceId}-${choiceId}`,
      type: "xiuxian_accident",
      actorId,
      tags: ["xiuxian", "accident_resolved", template.id, ...choice.tags],
      data: {
        templateId: template.id,
        choiceId,
        impact: template.impact,
        consequences: structuredClone(choice.consequences ?? {}),
      },
    };
    this.#state.nextAvailableTickByTemplate[template.id] = worldTick + template.cooldownTicks;
    this.#state.history.push({ instanceId, templateId: template.id, choiceId, worldTick });
    this.#state.active = null;
    return { event, state: this.state };
  }
}

export function validateAccidentConfig(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.templates)) throw new Error("意外事件配置无效");
  const ids = new Set();
  for (const template of config.templates) {
    if (!template.id || ids.has(template.id)) throw new Error(`意外事件 ID 无效或重复: ${template.id}`);
    ids.add(template.id);
    if (!(template.weight > 0) || !Array.isArray(template.choices) || template.choices.length === 0) {
      throw new Error(`意外事件 ${template.id} 缺少权重或选择`);
    }
  }
  return structuredClone(config);
}

function weightedPick(items, random) {
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("随机数必须在 [0, 1) 范围内");
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = roll * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return items.at(-1);
}

function restoreState(saved) {
  if (!saved) return { version: 1, sequence: 0, active: null, nextAvailableTickByTemplate: {}, history: [] };
  if (saved.version !== 1) throw new Error("意外事件存档版本不兼容");
  return {
    version: 1,
    sequence: saved.sequence ?? 0,
    active: saved.active ? structuredClone(saved.active) : null,
    nextAvailableTickByTemplate: { ...(saved.nextAvailableTickByTemplate ?? {}) },
    history: [...(saved.history ?? [])],
  };
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} 必须是非负整数`);
}
