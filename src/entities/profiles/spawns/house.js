export const house = {
  biomes: ['plains', 'forest'],
  density: 0.015,
  minDist: 20,
  scale: [0.9, 1.1],
  /**
   * Placement rules (handled by ChunkManager). Houses declare the ground pad
   * they need: sites are rejected when any footprint corner would dip under
   * water, when the pad drops more than maxDrop (cliff corners), or when the
   * site sits above the green belt (alpine peaks keep no houses). On gentler
   * uneven ground the house is seated on its highest corner and a stone
   * plinth fills the gap, so slopes get a terraced foundation instead of a
   * half-buried hut.
   */
  placement: {
    footprint: [2.8, 2.3],        // half-extents of the pad sampled under the house
    plinthFootprint: [2.75, 2.25], // stone foundation size (hugs the walls)
    maxDrop: 2.0,                 // max height difference across the pad (meters)
    plinthFrom: 0.12,             // lift above center that starts a visible plinth
    maxAltitude: 34,              // above the rock line the green belt ends
    spawnClear: 10,               // keep this radius around the spawn point empty
  },
  fallback: {
    parts: [
      {
        geometry: 'box',
        args: [5, 3.5, 4],
        position: [0, 1.75, 0],
        material: { color: 0xc0a878 },
      },
      {
        geometry: 'cone',
        args: [4, 2, 4],
        position: [0, 4.5, 0],
        rotation: [0, Math.PI / 4, 0],
        material: { color: 0x8b3020 },
      },
    ],
  },
  physics: {
    type: 'cuboid',
    halfExtents: [2.55, 2.2, 2.05],
    offset: [0, 2.2, 0],
  },
};