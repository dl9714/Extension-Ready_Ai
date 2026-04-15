# Content Script Structure

The extension loads content scripts from `manifest.json`.

Load order:

1. `src/sites.js`
2. `src/content/part-01.js` through `src/content/part-12.js`

`src/content.js` was removed to avoid maintaining two copies of the same content script. If content logic changes, update the split files that are listed in `manifest.json` and in `CONTENT_SCRIPT_FILES` inside `src/background.js`.
