export const guard = {
  type: 'guard',
  category: 'bot',
  fallback: {
    parts: [
      {
        geometry: 'capsule',
        args: [0.35, 0.8, 4, 8],
        position: [0, 0.9, 0],
        material: { color: 0x404880 },
      },
      {
        geometry: 'sphere',
        args: [0.3, 8, 6],
        position: [0, 1.8, 0],
        material: { color: 0x6068a0 },
      },
    ],
  },
  speed: 3.4,
  detect: 22,
  flee: 0,
  behavior: 'aggressive',
  attackRange: 1.7,
  attackCooldown: 1.2,
  attackForce: 5,
  damage: 8,
  angryDuration: 4,
  biomes: ['plains'],
  density: 0.1,
  bodyColor: 0x404880,
  headColor: 0x6068a0,
  animations: {
    idle: ['idle'],
    walk: ['walk'],
    angry: ['angry'],
    attack: ['attack'],
  },
};