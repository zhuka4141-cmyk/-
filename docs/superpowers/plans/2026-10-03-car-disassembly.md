# Car Disassembly Implementation Plan

**Goal:** Replace the default car with huh.step and add five reversible part controls without losing surface painting.

**Architecture:** Static HTML/CSS with ES modules. model.js owns CAD mesh construction/classification/transforms; paint.js owns part-local decals, history and serialization; app.js owns loading, UI, camera and storage.

**Tech Stack:** Three.js 0.160.0, occt-import-js 0.0.23, Node built-in test runner. No framework or bundler.

## Constraints

Preserve actual CAD geometry, include all 20 meshes. Exact-model mapping must be gated by SHA-256. Unknown names remain body. No CDN required at runtime. Paint records must match model and part.

## Tasks

- [x] Add tests/model.test.js using the actual STEP parser: verify 20 meshes and five named groups, opposite wheel directions, exact assembly restoration, retained child decal transforms, and independent group selection. Run `npm test` before implementation to confirm missing behavior.
- [x] Add package.json and scripts/vendor.mjs; install pinned existing dependencies; copy runtime files plus licenses into vendor. Copy huh.step, remove the old default asset.
- [x] Implement model.js: `buildModel(result, {knownModel})`, `setExploded(model, ids, amount)`, `updateExplosion(model, dt, reducedMotion)`, `disposeModel(model)`.
- [x] Add paint.js and tests/paint.test.js: `createDecal(part, point, normal, color, size, texture)`, `validateDrawing(data, modelKey, parts)`. Verify parent-local coordinates and invalid/cross-model data rejection.
- [x] Extract style.css and implement index.html/app.js. Bind native buttons/sliders to model state, per-part raycasting and painting, model-specific auto-save, import/export, fit view, error recovery, and responsive panel.
- [x] Run tests, JS syntax checks, and git diff --check. Record verification and usage in README.md. Independent code review identified and confirmed a fix for cache restoration/unload race.
- [ ] Browser desktop/mobile visual and interaction checks: blocked by automatic approval review service HTTP 404. Page modules, STEP, Worker and WASM returned HTTP 200. This remains unverified, not passed.
- [x] Package project and changes as user-facing outputs. Keep remote main unchanged unless publishing is requested.
