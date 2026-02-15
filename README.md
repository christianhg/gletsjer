# gletsjer

A pixel art glacier in a browser tab. 320 × 180 pixels. 40KB of JavaScript. No images, no libraries, no UI. Every pixel is math.

It has a ten-minute light cycle that drifts. The speed wanders — some revolutions take nine minutes, some take eleven. The palette wanders too, on a random walk with no memory of where it started. After an hour the sky is a color it's never been. After two hours it's somewhere else. It doesn't loop. It evolves.

Each day's glacier is seeded from the calendar date. Tuesday's is not Wednesday's. But two people opening the tab on the same Tuesday will see the same starting point — and then watch it diverge.

Touch the screen and you'll hear it. A low drone that pulses at the speed of breathing. Wind. A faint harmonic when the aurora is out. The sound doesn't follow the light — it lags behind it, the way stone holds warmth after the sun moves. The drone trails the visual cycle by eighteen seconds. The wind responds faster. The aurora harmonic responds fastest. You're hearing the glacier's materials, not its mood.

Things happen. Fog rolls in from one side and takes five minutes to cross. Snow surges into a whiteout and then clears gradually, from the edges, the way weather actually clears. A shooting star. Ice calving from the shelf — a jagged block that falls and splashes. And rarely, the whole image inverts for a single frame. One sixtieth of a second. If you blinked, you missed it. These events run on Poisson processes. They aren't scheduled. They're probabilistic. You might watch for an hour and see nothing.

The glacier remembers. Calving leaves scars that take five minutes to fade. The fog thickens near where ice broke. After the aurora peaks, a green tint lingers. The ice surface is not a texture — it's a composition of simplex noise, horizontal striations, crevasse darkening, surface highlights, cyan edge glow, shimmer, color cycling, aurora light, and fog, blended per-pixel, per-layer, per-frame. The crevasses deepen at night. The highlights dim. The shimmer remembers the aurora after it's gone. The ice grain knows what time it is.

When you open the tab, some of this has already happened. There are scars from calving you never saw. Fog already mid-crossing. The glacier was here before you arrived.

During a deep glitch, a small patch of pixels takes its color values from the raw bytes of the JavaScript that renders it. The glacier bleeds its own source code.

Sometimes one of those pixels gets stuck. A dead pixel on your screen for thirty seconds. It renders on top of everything. It's not part of the glacier. It's part of the screen you're watching it through.

It doesn't need you to watch. It runs its own time, makes its own weather, and remembers its own history. Close the tab. Come back tomorrow. It will be somewhere else.

[gletsjer.dk](https://gletsjer.dk)
