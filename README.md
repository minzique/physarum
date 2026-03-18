# Physarum

Emergent speciation simulator. 262,144 GPU-accelerated agents evolve across four independent traits, compete for dynamic food sources, and self-organize into species that were never programmed.

**[Live](https://physarum-alpha.vercel.app)**

## What it does

Each agent follows three rules: sense the trail ahead, turn toward the strongest signal, move forward and deposit a trace. From this, complex biological dynamics emerge — species formation, territorial competition, predator-prey relationships, and boom-bust resource cycles.

No species are coded. They crystallize from selection pressure on a continuous genome.

### Traits

Every agent carries four evolving values:

- **Species hue** — identity marker; agents prefer trails from similar hues
- **Food preference** — which nutrient types the agent metabolizes efficiently
- **Aggression** — tendency to follow conflict edges vs. flee from them
- **Sociality** — tendency to reinforce shared lanes with nearby kin

### Ecology

- **Kin-recognition**: agents sense the average genome in nearby trails and are attracted to similar, repelled by alien
- **Mutation**: struggling agents (low energy, no food) mutate faster; thriving agents are stable
- **Overcrowding**: dense colonies destabilize — frequency-dependent selection prevents monoculture
- **Food**: gaussian nutrient patches that deplete under colonies and slowly regrow, creating boom-bust cycles
- **Predation/avoidance**: aggressive lineages follow conflict boundaries; cautious ones flee them
- **Symbiosis**: social agents reinforce shared infrastructure with kin

### Presets

| Key | Name | Style |
|-----|------|-------|
| `1` | Ribbon Drift | Dark, long-range networks |
| `2` | Petri Dish | Light agar background, colony growth |
| `3` | Microscope | Bright-field, visible agents, eyepiece vignette |
| `4` | Petri Bloom | Light, soft pastels, visible dots |

### Controls

| Input | Effect |
|-------|--------|
| `1`–`4` | Switch preset |
| `↑` / `↓` | Adjust simulation speed |
| `Space` | Toggle turbo (64x) |
| `R` | Reset |
| Mouse | Deposit trail into environment |

## Architecture

Static site. No build step. ES modules served directly.

```
index.html              shell + UI
src/
  main.js               input handling, preset switching, render loop
  config/presets.js      simulation parameters and color palettes
  gl/shader-factory.js   GLSL generation from preset parameters
  sim/simulation.js      WebGL2 GPGPU engine, texture management
docs/
  EVOLUTION_NOTES.md     design log
```

### GPU pipeline (per step)

1. **Agent step** — fullscreen fragment shader reads agent state + traits + trail + food, writes new state + traits (MRT)
2. **Trail diffuse** — 3x3 blur + decay + trail cap + mouse deposit
3. **Trail deposit** — 262k GL_POINTS with additive blending into trail FBO
4. **Food update** — consumption proportional to trail density, slow regrowth toward original
5. **Display** — color mapping from trail + food, mode-specific rendering (dark/dish/scope)
6. **Agent render** — optional semi-transparent dots for microscope/bloom modes

### Data layout

| Texture | Format | Channels |
|---------|--------|----------|
| Agent state (×2) | RGBA32F | x, y, angle, energy |
| Agent traits (×2) | RGBA32F | hue, food preference, aggression, sociality |
| Trail (×2) | RGBA16F | intensity, hue-weighted, sociality, aggression |
| Food (×2) | RGBA32F | amount, type, unused, unused |
| Food original | RGBA32F | reference for regrowth |

## Run locally

Serve the directory over HTTP. ES modules require it.

```
python3 -m http.server 8000
# or
npx serve .
```

## Deploy

```
vercel --prod
```

## License

MIT
