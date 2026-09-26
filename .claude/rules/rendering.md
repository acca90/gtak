---
paths:
  - "src/render.js"
  - "src/game.js"
---
# Rendering rules that are easy to break

- Buildings use the oblique projection: the roof is offset by
  `(centre − camera) × PARALLAX × height`, and walls are drawn row by row. Facades are drawn at a
  whole-number squash per storey (`k = floor(visible / floors)`), so windows don't shimmer.
  Keep it that way.
- The ground is baked **lazily** into 512 px chunks (LRU cache of 64). Never bake the whole world.
  Permanent decals go through `Render.paint(...)`, which is also replayed when an evicted chunk
  is re-baked. Ground detail goes through `c.paints` + `Render.paintOp`.
- Drawing uses spatial indexes (`Render.idx.*`, built once in `buildIndexes`). **Never loop over
  all trees, buildings, lamps or sprites per frame.** New world lists need an index.
- The display is low-res, scaled up by a whole-number factor, then smoothed to the window size.
  `G.cam.w/h` is the view size in world pixels, which changes with zoom and window size.
- Time of day: buildings use per-time baked textures (`TIMES`), and the ground/entities get the
  multiply light pass. Emissive pixels are drawn after the light pass.
