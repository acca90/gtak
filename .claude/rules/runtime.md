# Runtime constraints

- `index.html` must keep working when opened directly from `file://`: plain `<script>` tags, no
  ES modules, no `fetch`/XHR, no build step, no npm dependencies.
- All scripts share one global scope, and load order is set in `index.html`. A new file must be
  added there (`tools/check.js` reads the list from it).
- Generated data that the game needs at runtime is shipped as a JS file (`assets/atlas.js`), never
  loaded with `fetch`. Audio/music bundles follow the same pattern.
