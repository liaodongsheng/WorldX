import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(moduleDir, "../..");
const worldDir = path.join(repoDir, "library/worlds/world_xiuxian_wanjie");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(worldDir, relativePath), "utf8"));
}

function readJpegSize(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8);
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions not found");
}

test("bundles a playable Phaser visual world", () => {
  const config = readJson("config/world.json");
  const tilemap = readJson("map/06-final.tmj");
  const characters = readJson("characters/characters.json");
  const background = fs.readFileSync(path.join(worldDir, "map/06-background.jpg"));

  assert.equal(config.worldName, "万劫问仙·青云坊市");
  assert.equal(config.assetFallbackWorldId, "world_2026-04-19T08-31-24");
  assert.deepEqual(config.locations.map((location) => location.id), ["main_area", "pill_pavilion"]);
  assert.equal(tilemap.width, 344);
  assert.equal(tilemap.height, 192);
  assert.equal(tilemap.tilewidth, 8);
  assert.equal(tilemap.layers.find((layer) => layer.name === "collision").data.length, 344 * 192);
  assert.equal(characters.length, 6);
  assert.equal(characters.some((character) => character.name === "陆尘"), true);
  const collision = tilemap.layers.find((layer) => layer.name === "collision").data;
  for (const character of characters) {
    const characterConfig = readJson(`config/characters/${character.id}.json`);
    const { tileX, tileY } = characterConfig.startPosition;
    assert.equal(collision[tileY * tilemap.width + tileX], 0, `${character.name} must spawn on a walkable tile`);

    const fallbackSprite = path.join(
      repoDir,
      "library/worlds",
      config.assetFallbackWorldId,
      "characters",
      character.id,
      "spritesheet.png",
    );
    assert.equal(fs.existsSync(fallbackSprite), true, `${character.name} must have a fallback animation sheet`);
  }

  assert.deepEqual(readJpegSize(background), { width: 2752, height: 1536 });
});
