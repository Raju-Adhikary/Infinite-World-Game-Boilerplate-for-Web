# Infinite World Game Boilerplate

A modular JavaScript starter for building infinite-world games with Three.js, Rapier physics, procedural terrain, AI bots, and a lightweight UI layer.

## Project Structure

```
glm-4.6_test/
├── index.html                 # Main entry point (minimal, imports modules)
├── infinit-world.html         # Original monolithic file (kept for reference)
└── src/
    ├── game.js               # Main Game orchestrator class
    ├── config/
    │   └── config.js         # Centralized configuration and constants
    ├── core/                 # Core utilities and low-level systems
    │   ├── utils.js          # Helper functions, seeded random, coordinate hash
    │   ├── noise.js          # Perlin noise implementation
    │   ├── audio.js          # Audio manager
    │   ├── glb-cache.js      # GLB model loader and cache
    │   └── physics.js        # Physics world wrapper (Rapier)
    ├── world/                # World generation systems
    │   ├── biome-system.js   # Biome determination logic
    │   ├── terrain-height.js # Terrain height: continents, oceans, mountains
    │   ├── chunk-manager.js  # Chunk loading/unloading and terrain generation
    │   ├── water-system.js   # Global water surface with depth-aware waves
    │   ├── water-effects.js  # Shader ripple rings and splash droplets
    │   └── sky-system.js     # Day-night cycle: sun, moon, stars, clouds
    ├── player/               # Player-specific systems
    │   └── player-controller.js  # Player movement, camera, physics
    ├── entities/             # Entity and AI systems
    │   ├── entity-manager.js # Entity tracking and management
    │   ├── bot-mesh.js       # Procedural bot model factory
    │   └── bot-ai.js         # Bot AI behavior system
    ├── ui/                   # User interface
    │   ├── input-manager.js  # Keyboard, mouse, touch input handling
    │   └── ui-manager.js     # UI screens and menu management
    └── styles/
        └── main.css          # All styling (extracted from inline CSS)
```

## Module Descriptions

### Core Systems (`src/core/`)
- **utils.js**: Common utilities like `_uid()`, `_clamp()`, `_lerp()`, seeded random
- **noise.js**: Perlin noise for procedural generation
- **audio.js**: Audio loading, caching, and playback with Web Audio API
- **glb-cache.js**: GLB model loading with procedural fallbacks
- **physics.js**: Rapier physics engine wrapper

### World Systems (`src/world/`)
- **biome-system.js**: Determines biome types based on temperature/moisture noise
- **terrain-height.js**: Generates terrain heights using FBM noise
- **chunk-manager.js**: Procedurally generates and manages terrain chunks, spawns objects and bots

### Player Systems (`src/player/`)
- **player-controller.js**: Handles movement, jumping, camera control, ground detection

### Entity Systems (`src/entities/`)
- **entity-manager.js**: Tracks all game entities by ID and type
- **bot-mesh.js**: Procedural mesh generation for bots
- **bot-ai.js**: AI state machine (idle, wander, follow, flee)

### UI Systems (`src/ui/`)
- **input-manager.js**: Handles keyboard, mouse (pointer lock), and touch input
- **ui-manager.js**: Menu screens, settings, debug panel

### Configuration (`src/config/`)
- **config.js**: All game constants, biome definitions, spawn configs, bot configs

## Usage

### Running the Game
1. Open `index.html` in a modern browser with ES6 module support
2. The game will automatically boot and show the main menu

### Seeds and World Coordinates

World generation is fully deterministic: terrain, biomes, and every prop and
bot placement derive from `CFG.world.seed` through a coordinate hash
(`hashChunk(seed, chunkX, chunkZ)`), so the same seed always rebuilds the
exact same world.

- **URL parameters** pin the world for a session and override everything:
  - `?seed=1234` - generate the world of seed 1234
  - `?x=100&z=-50` - spawn near those world coordinates (the game spirals
    outward to dry land if the point is in water)
  - combine them: `?seed=1234&x=100&z=-50`
- **Persistence**: the last seed is remembered in `localStorage` (`ge_seed`),
  so reloading the page keeps the same world
- **Sharing**: the active seed is shown on the start menu footer and in the
  debug panel (F3) - share it together with the URL params

Water surfaces react to the player with shader-based ripple rings and splash
droplets on hard entries and on leaping out. The world also carries large
ocean basins, taller mountain ranges with rock slopes and snow caps.

### Development Workflow

**To add a new system:**
1. Create a new file in the appropriate `src/` subdirectory
2. Import dependencies from other modules
3. Export your class/function
4. Import in `src/game.js` and integrate

**To modify configuration:**
- Edit `src/config/config.js`
- No need to modify other files (configuration is centralized)

**To add new biomes:**
- Edit `CFG.biomes` in `src/config/config.js`
- Optionally add spawn rules to `CFG.spawns`

**To add new entities/bots:**
- Define spawn config in `CFG.spawns` or `CFG.bots`
- `density` can be a single number or a biome map like `{ forest: 0.03, plains: 0.02, default: 0.025 }`
- Bot profiles now live in separate files under `src/entities/profiles/bots/`
- Add mesh generation in `src/core/glb-cache.js` if using procedural fallback
- No changes needed to core systems

## Dependency Graph

```
index.html
  └── src/game.js (Game class)
        ├── src/config/config.js
        ├── src/ui/input-manager.js
        ├── src/ui/ui-manager.js
        │   └── src/config/config.js
        ├── src/core/audio.js
        │   └── src/core/utils.js
        ├── src/core/glb-cache.js
        ├── src/core/physics.js
        │   └── src/core/utils.js
        ├── src/entities/entity-manager.js
        │   └── src/core/utils.js
        ├── src/world/terrain-height.js
        │   ├── src/core/noise.js
        │   └── src/config/config.js
        ├── src/world/biome-system.js
        │   ├── src/core/noise.js
        │   └── src/config/config.js
        ├── src/world/chunk-manager.js
        │   ├── src/config/config.js
        │   ├── src/core/utils.js
        │   ├── src/core/noise.js
        │   └── src/entities/bot-mesh.js
        ├── src/player/player-controller.js
        │   ├── src/config/config.js
        │   └── src/core/utils.js
        └── src/entities/bot-ai.js
```

## Performance Considerations

- **Chunk system**: Loads/unloads chunks based on player distance
- **Entity pooling**: Entities are reused when chunks unload
- **Procedural generation**: Uses seeded noise for deterministic results
- **Physics**: Only active entities have physics bodies
- **Rendering**: THREE.js built-in culling and LOD

## Future Enhancements

- [ ] Particle systems (move to `src/particles/`)
- [ ] Animation system (move to `src/animation/`)
- [ ] Networking (move to `src/network/`)
- [ ] Save/load system (move to `src/persistence/`)
- [ ] Advanced rendering (shaders, post-processing)
- [ ] Mobile optimizations
- [ ] Asset pipeline (model/texture conversion)

## Testing Recommendations

1. **Unit tests**: Test each module's core functions
2. **Integration tests**: Test module interactions
3. **E2E tests**: Test full game flow (start → play → pause → quit)
4. **Performance tests**: Compare chunk loading, entity updates
5. **Browser tests**: Test on Chrome, Firefox, Safari, Edge

## Next Steps for Further Improvement

1. Add TypeScript for type safety
2. Implement proper unit testing framework
3. Create build pipeline (webpack/rollup)
4. Add asset pipeline for model/texture conversion
5. Implement logging system
6. Create plugin system for easy extensibility
7. Add state management for game state
8. Implement save/load system

## Browser Support

- Modern browsers with ES6 module support
- WebGL 2.0 for rendering
- Web Audio API for sound
- Pointer Lock API for mouse control
- Touch events for mobile

## Dependencies

- Three.js (loaded via CDN)
- Rapier physics (loaded via CDN)
- GLTFLoader (via Three.js addons)

All dependencies are loaded at runtime from CDN.
