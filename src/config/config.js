/**
 * Game Configuration
 * Central place for all game settings and constants
 */
import { BOT_PROFILES } from '../entities/profiles/bots/index.js';
import { SPAWN_PROFILES } from '../entities/profiles/spawns/index.js';

export const CFG = {
  world: {
    chunkSize: 64,
    chunkSegments: 28,
    heightScale: 18,
    heightFreq: 0.008,
    heightOctaves: 5,
    loadRadius: 3,
    unloadRadius: 5,
    chunksPerFrame: 2,
    seed: 42,
    fogNear: 80,
    fogFar: 280,
    fogColor: '#8aacb8',
    skyColor: '#8aacb8',
    ambientColor: '#8090a0',
    ambientIntensity: 0.5,
    sunColor: '#fff4e0',
    sunIntensity: 1.4,
    sunDir: [0.6, 0.8, 0.4],
    shadowMapSize: 2048,
    // Day-night cycle
    dayLength: 240,   // real seconds for one full day+night cycle
    dayStart: 0.3,    // time of day the game starts at (0.25 = sunrise, 0.5 = noon)
    // Lakes fill every basin below this height (~13% of the seed-42 world;
    // terrain spans 2.7..15.0 with an average of 9.0)
    waterLevel: 7.0,
    // Bots never spawn inside this radius around the world origin (player spawn)
    safeSpawnRadius: 14,
  },
  player: {
    height: 1.8,
    radius: 0.4,
    moveSpeed: 5.5,
    jumpForce: 7,
    cameraDist: 7,
    cameraHeight: 2.2,
    // Symmetric pitch limits: the old clamp (-0.3..1.2) barely allowed looking
    // down while letting the camera dive under the terrain when looking up.
    cameraMinPitch: -1.2,
    cameraMaxPitch: 1.2,
    spawnY: 30,
    // Vertical speed while paddling up in water (see player-controller)
    swimUp: 2.6,
    // Vitality: regen kicks in after regenDelay seconds without damage
    maxHealth: 100,
    regenDelay: 5,
    regenRate: 4,
    hurtInvuln: 0.6,   // seconds of immunity after taking a hit
    respawnDelay: 2.0, // how long the death overlay stays up
  },
  biomes: {
    snow: { temp: [0, 0.22], moist: [0, 1], ground: 0xd8dce8, name: 'Snow' },
    tundra: { temp: [0.22, 0.35], moist: [0, 0.35], ground: 0x8a9a80, name: 'Tundra' },
    desert: { temp: [0.72, 1], moist: [0, 0.28], ground: 0xc8a860, name: 'Desert' },
    savanna: { temp: [0.55, 0.72], moist: [0.2, 0.4], ground: 0xa0a050, name: 'Savanna' },
    plains: { temp: [0.35, 0.6], moist: [0.2, 0.5], ground: 0x5a9838, name: 'Plains' },
    forest: { temp: [0.35, 0.6], moist: [0.5, 0.8], ground: 0x2a6828, name: 'Forest' },
    swamp: { temp: [0.5, 0.75], moist: [0.8, 1], ground: 0x384828, name: 'Swamp' },
    jungle: { temp: [0.6, 0.85], moist: [0.6, 1], ground: 0x1a5018, name: 'Jungle' },
  },
  spawns: SPAWN_PROFILES,
  bots: BOT_PROFILES,
  glbModels: {
    tree_pine: null, tree_oak: null, tree_palm: null, tree_jungle: null,
    cactus: null, rock: null, bush: null, mushroom: null,
    house: null, dead_tree: null, flower: null,
    villager: null, guard: null, animal: null, monster: null,
  },
  sounds: {
    footstep: null, jump: null, land: null,
    ambient_forest: null, ambient_desert: null,
  },
  settings: {
    renderDist: 3, fov: 70, shadows: true, showFps: false,
    masterVol: 80, sfxVol: 70, musicVol: 50,
    sensitivity: 8, invertY: false,
    cameraMode: 'third-person',
  }
};
