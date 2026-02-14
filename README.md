# gletsjer

A procedural pixel art glacier. [gletsjer.dk](https://gletsjer.dk)

Full-screen ambient animation — mesmerizing, glitchy, pixelated. Leave it open on a second monitor.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output in `dist/`. Deploy anywhere that serves static files.

## Technical

- 320×180 virtual resolution, nearest-neighbor upscaled to viewport
- 5-layer procedural terrain via Fractal Brownian Motion
- Ridge noise crevasses, parallax depth with texture drift
- Fjord water reflection with ripple distortion and blue tint
- Snow particle system (pre-allocated pool, zero GC)
- Intermittent glitch effects (RGB split, scanlines, block displacement)
- Vignette edge darkening
- Pauses when tab is hidden (battery friendly)
- Respects `prefers-reduced-motion`
- Zero runtime dependencies
