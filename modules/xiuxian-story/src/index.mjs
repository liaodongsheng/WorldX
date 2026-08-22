export { loadOutline, validateOutline } from "./outline-loader.mjs";
export { PlotDirector } from "./plot-director.mjs";
export { ProtagonistController } from "./protagonist-controller.mjs";
export { loadCultivationRules, loadAccidentRules, validateCultivationRules } from "./rules-loader.mjs";
export { CultivationEngine } from "./cultivation-engine.mjs";
export { CombatEngine } from "./combat-engine.mjs";
export { AccidentEngine, validateAccidentConfig } from "./accident-engine.mjs";
export { CausalityGuard } from "./causality-guard.mjs";

import { loadOutline } from "./outline-loader.mjs";
import { PlotDirector } from "./plot-director.mjs";
import { ProtagonistController } from "./protagonist-controller.mjs";
import { loadCultivationRules, loadAccidentRules } from "./rules-loader.mjs";
import { CultivationEngine } from "./cultivation-engine.mjs";
import { CombatEngine } from "./combat-engine.mjs";
import { AccidentEngine } from "./accident-engine.mjs";
import { CausalityGuard } from "./causality-guard.mjs";

export async function createXiuxianStoryModule(options = {}) {
  const outline = options.outline ?? await loadOutline(options.moduleDir);
  const cultivationRules = options.cultivationRules ?? await loadCultivationRules(options.moduleDir);
  const accidentRules = options.accidentRules ?? await loadAccidentRules(options.moduleDir);
  const director = new PlotDirector(outline, options.savedState);
  const protagonist = new ProtagonistController();
  const cultivation = new CultivationEngine(cultivationRules);
  const combat = new CombatEngine(cultivationRules);
  const accidents = new AccidentEngine(accidentRules, options.accidentState);
  const causality = new CausalityGuard(accidentRules.causalityCorrections, options.causalityState);
  if (options.playerId && options.characterId) {
    protagonist.bind({ playerId: options.playerId, characterId: options.characterId });
    director.bindProtagonist(options.characterId);
  }
  return { id: "xiuxian-story", version: "0.3.0", director, protagonist, cultivation, combat, accidents, causality };
}
