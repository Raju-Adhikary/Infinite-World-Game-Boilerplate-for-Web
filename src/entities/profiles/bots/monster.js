export const monster = {
  type: 'monster',
  category: 'bot',
  fallback: {
    parts: [
      {
        geometry: 'capsule',
        args: [0.35, 0.8, 4, 8],
        position: [0, 0.9, 0],
        material: { color: 0x403020 },
      },
      {
        geometry: 'sphere',
        args: [0.3, 8, 6],
        position: [0, 1.8, 0],
        material: { color: 0xa02020 },
      },
    ],
  },
  speed: 4.2,
  detect: 20,
  // Close-range hearing (scent/footsteps): works with no line of sight, so
  // jungle leaves and swamp shrubs can no longer blind a zombie standing
  // right next to the player. Sight still does the far detection.
  hearing: 9,
  flee: 0,
  behavior: 'aggressive',
  attackRange: 1.8,
  attackCooldown: 1.5,
  attackForce: 6,
  damage: 12,
  angryDuration: 6,
  biomes: ['swamp', 'jungle'],
  density: { swamp: 0.22, jungle: 0.28 },
  bodyColor: 0x403020,
  headColor: 0xa02020,
  animations: {
    idle: ['idle'],
    walk: ['walk'],
    angry: ['angry'],
    attack: ['attack'],
  },
};