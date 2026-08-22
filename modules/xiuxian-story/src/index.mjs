export { loadOutline, validateOutline } from "./outline-loader.mjs";
export { PlotDirector } from "./plot-director.mjs";
export { ProtagonistController } from "./protagonist-controller.mjs";

import { loadOutline } from "./outline-loader.mjs";
import { PlotDirector } from "./plot-director.mjs";
import { ProtagonistController } from "./protagonist-controller.mjs";

export async function createXiuxianStoryModule(options = {}) {
  const outline = options.outline ?? await loadOutline(options.moduleDir);
  const director = new PlotDirector(outline, options.savedState);
  const protagonist = new ProtagonistController();
  if (options.playerId && options.characterId) {
    protagonist.bind({ playerId: options.playerId, characterId: options.characterId });
    director.bindProtagonist(options.characterId);
  }
  return { id: "xiuxian-story", version: "0.1.0", director, protagonist };
}
