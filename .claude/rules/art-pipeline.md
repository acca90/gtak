---
paths:
  - "tools/generate-art.lua"
  - "tools/export-art.lua"
  - "tools/art.sh"
  - "art/**"
  - "assets/**"
  - "gallery.html"
  - "src/core.js"
---
# Art pipeline

- Aseprite is the Steam build: `~/.local/share/Steam/steamapps/common/Aseprite/aseprite`
  (not on PATH). `tools/art.sh` finds it; override with `ASEPRITE=...`.
- `tools/art.sh` exports `art/*.aseprite` → `assets/*.png` + `assets/atlas.js`.
  **Never edit `assets/` by hand.**
- `tools/art.sh generate` only creates **missing** `.aseprite` files from `tools/generate-art.lua`.
  `regenerate` overwrites **all** of them and loses hand edits, so only use it when you know
  nothing was hand-edited.
  To change one generated sheet: edit the Lua, delete that `art/<sheet>.aseprite`, then run `tools/art.sh generate`.
- Code looks sprites up **by tag name** (`Assets.frame(sheet, tag, i)`), so renaming or reordering
  tags breaks the game. Frame order inside a tag is part of the contract too (vehicles:
  normal/brake/wreck; walls: the 8-frame facade contract in generate-art.lua).
- Use the palette in `generate-art.lua`, mirrored as `PAL` in `src/core.js` and exported to
  `art/pastel-city.gpl`. A new colour goes into both.
- Keep pixel art crisp: integer positions, no smoothing, no non-integer scaling of sprites.
