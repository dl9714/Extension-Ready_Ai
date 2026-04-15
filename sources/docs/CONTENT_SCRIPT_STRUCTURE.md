# Content Script Structure

The extension loads content scripts from `sources/manifest.json`.

Load order:

1. `src/sites.js`
2. `src/content/part-01.js` through `src/content/part-12.js`

`sources/src/content.js` was removed to avoid maintaining two copies of the same content script. If content logic changes, update the split files that are listed in `sources/manifest.json` and in `CONTENT_SCRIPT_FILES` inside `sources/src/background.js`.
