# Fit — Letter Spacing Lab

A spacing, kerning, tracking and proofing workbench for Latin text fonts, with a
Fontra panel bridge. Fit is a standalone web app (Vite + React + TypeScript)
whose measurement and decision engines live in a UI-independent core, so the
same logic can back a Fontra plugin, a CLI, or a batch script.

The bundled sample is **Fontulja**, a deliberately under-spaced work-in-progress
font, so every feature has something real to work on. A copy of Atkinson
Hyperlegible is included as a fallback.

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The app loads `public/demo-fontra` automatically.
Use **Import** to bring in another font.

```bash
npm test       # 64 tests across the core engines and adapters
npm run check  # TypeScript
npm run build  # production build in dist/
npm run preview
```

## What is included

### Spacing

- **Key-glyph rhythm**: choose lowercase/uppercase stem and round keys; the
  target gap is derived from them.
- **Three engines**:
  - *Stem / cadence* — derives sidebearings from the stem interval and glyph
    class.
  - *Optical* — compares the side profile of each glyph to the key glyph and
    compensates for round/open shapes.
  - *Hybrid* — blends both for a robust first pass.
- **Non-destructive suggestions** with confidence, before/after values and a
  human-readable reason. Apply one, apply "safe" suggestions, or apply all.
- **Direct editing**: drag the blue sidebearing lines on the canvas, or type LSB,
  RSB and advance values. Every edit is undoable.
- **Outlier detection** by glyph category and side-shape class (flat, soft,
  round, open).
- **Auto groups** based on measured side profiles, with review controls.
- **Metrics keys**: link a glyph's left and/or right sidebearing to another
  glyph (`=n`-style). Setting a key applies it immediately; *Apply metrics keys*
  resolves every link in the source. Missing or self-referencing keys are
  reported in QA, never applied blindly.
- Metrics keys survive project JSON, UFO (`lib.plist`) and Fontra (glyph
  `customData`) round-trips.

### Kerning

- Pair list generation (letters × letters plus punctuation/figure combinations),
  filtering and per-pair navigation.
- **Optical pair targets** using sampled scanline gaps, not just sidebearings.
- **Auto-kerning** with threshold, min/max kern, collision gap and confidence.
- Collision detection and overkern detection.
- **Exceptions vs. groups**: explicit pairs override group kerning; redundant
  exceptions can be pruned.
- Separate left (side 1) and right (side 2) groups, with group assignment and
  deletion.
- Batch transforms: round to 5, prune redundant, remove small values, scale.
- Canvas pair editing by clicking or dragging the gap between glyphs.

### Tracking

- Presets (tight, text, loose, airy, custom), per-mille values, and live preview.
- **Caps spacing** (`cpsp`) generation.
- Optical-size tracking ramp as a starting point for text/display sizes.
- Export as OpenType feature code, CSS, JSON and CSV.
- Clear separation between tracking, kerning and spacing.

### Proofing / QA

- Proof mode: size waterfall from 10 px to 80 px.
- Guides (baseline, x-height, cap height, ascender, descender), metrics, kern
  indicators, advance boxes, ghost overlay, flip and blur.
- Measurement line across the x-height.
- QA checks:
  - negative sidebearings and non-positive advances
  - missing outlines
  - spacing outliers
  - ink collisions (capped scan)
  - overkerned pairs
  - redundant exceptions
  - incomplete groups
  - figure width consistency
  - large tracking values
  - kerning coverage
- Health score and severity-filtered issue list; click an issue to jump to the
  glyph or pair.
- QA export as CSV or a self-contained HTML report.

### Assistant

A guided workflow that surfaces the next best action: set rhythm keys, auto-space,
review outliers, build groups, kern exceptions, then proof and ship. It also
explains the methods used and warns when kerning is being used to hide spacing
problems.

### Project features

- Undo/redo with history labels (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`).
- Light/dark themes.
- Mode shortcuts: `1` spacing, `2` kerning, `3` tracking, `4` proof, `5` QA.
- Ghost overlay of the previous state and a loaded reference font.
- **Multi-master support**: a project can hold multiple sources with axis
  locations. A source selector appears in the top bar when there is more than
  one master.
- **Designspace import**: choose a folder containing a `.designspace` and its
  UFO masters; each UFO becomes a source, with the source nearest the axis
  defaults selected first.
- Native `fit-font` JSON project format.
- Import: `.fit.json`, Fontra `.fontra` folder/zip, UFO folder/zip,
  `.designspace` + UFO folder, TTF/OTF/WOFF.
- Export: `.fit.json`, Fontra `.fontra.zip`, UFO `.ufo.zip`, designspace
  `.designspace.zip` (all masters + UFOs), OTF (CFF outlines + legacy `kern`),
  feature code, CSS, tracking JSON/CSV, QA CSV/HTML.

## Fontra plugin

`fontra-plugin/` contains a thin Fontra sidebar panel:

- embeds the Fit lab in an iframe,
- sends the current Fontra glyph selection to Fit,
- sends proof text,
- can open the full lab in a separate tab.

`plugin.json` follows Fontra's plugin descriptor format (`init` + `function`),
and `start.js` uses the same `Panel` API as Fontra's reference-font plugin.

To use it:

1. Run the Fit dev server (`npm run dev`) or host the built `dist/`.
2. Add the `fontra-plugin` folder to Fontra's plugin manager, or copy/symlink it
   into the plugin directory your Fontra build scans.
3. Open the **Fit — Letter Spacing Lab** sidebar panel.
4. Adjust the URL if the app is not at `http://localhost:5173/`.

The bridge uses `postMessage`:

- `fit:ready` — sent by the app when it is ready.
- `fit:select-glyph` — panel → app, selects a glyph by name.
- `fit:set-text` — panel → app, replaces the proof text.

The full app remains usable without Fontra. The panel is an integration layer,
not a dependency.

## How this works in practice

Yes — but it is a **workflow bridge**, not (yet) a live document bridge.

There are two separate layers:

```
Fontra (source of truth)
   │
   ├── file round-trip: UFO / .fontra / .designspace
   │        ↓
   │   Fit import → measurement + spacing/kerning engines → review/apply
   │        ↑
   │   Fit export: UFO / .fontra / .designspace / .fit.json
   │
   └── panel bridge: selected glyph name + proof text (postMessage)
            ↓
        Fit embedded in the Fontra sidebar
```

**1. The file round-trip is the real data bridge.**
Fontra edits outlines, groups, kerning and sources. Fit imports that data as
UFO, `.fontra` or designspace, computes sidebearings/kerning/tracking and
exports the result back in the same formats. Fontra then reopens the exported
UFO/Fontra project. This is the recommended workflow today because both apps
remain the source of truth for their own data.

**2. The sidebar panel is a convenience bridge.**
It embeds Fit inside Fontra and sends the current Fontra glyph name and proof
text over `postMessage`. That means you can select `n` in Fontra and immediately
see `n` in Fit, or send a proof string to Fit. It does **not** silently read or
write Fontra's open document. Any spacing or kerning change you make in Fit is
still saved through Fit's own export.

**3. The engines are format-agnostic.**
`src/core/` knows nothing about React or Fontra. It accepts a normalized glyph
project and returns suggestions, metrics, kerning values, QA issues and export
text. That is why the same engine can power the standalone app, the Fontra
panel, and future CLI or batch tools.

### Recommended real-world workflow

1. Draw and finish the outlines in Fontra first.
2. Export each master as UFO, or use the `.fontra` project folder directly.
3. Import the font/designspace into Fit.
4. Set the rhythm keys (`n`, `o`, `H`, `O` or your own), run auto-spacing, and
   review the suggestions + proof at reading size.
5. Build groups, run auto-kerning, and check the QA issues.
6. Set tracking separately; export feature code/CSS rather than baking tracking
   into glyph advances.
7. Export UFO/designspace/Fontra from Fit and reopen in Fontra.
8. Do the final production build in Fontra/fontmake/Glyphs. Fit's OTF export is
   for proofing and review, not a substitute for the production compiler.

The important expectation to set: **Fit does not currently write directly into
Fontra's live editing session.** It is a spacing lab that can be embedded beside
Fontra, with file round-tripping for actual data exchange. A true live plugin
would need to use Fontra's editor APIs to read and write glyphs/kerning directly;
the core engines are already structured to support that next step.

## Architecture

```
src/
  core/                 UI-independent engines
    types.ts            project, glyph, suggestions, QA, settings
    path.ts             flattening, bounds, scanlines, stems
    geometry.ts         sidebearings, side profiles, classes, metrics keys
    project.ts          sources, groups, kerning resolution, normalization
    spacing.ts          key-glyph / optical / hybrid auto-spacing, outliers
    kerning.ts          pair lists, optical targets, auto-kern, groups, transforms
    solver.ts           iterative joint spacing + kerning projection solver
    tracking.ts         presets, CSS/feature/JSON/CSV export, size ramp
    qa.ts               QA checks and health scoring
    io.ts               project download/upload and report exports
    import/
      fontra.ts         Fontra on-disk format, zip, demo loader, sidecar kerning
      ufo.ts            UFO plists, GLIF outlines, groups, kerning, metrics keys
      designspace.ts    designspace + multi-UFO source import
      opentype.ts       TTF/OTF/WOFF import through opentype.js
    export/opentype.ts  OTF builder with CFF outlines and legacy kern table
  render/layout.ts      text layout, Path2D conversion, tracking/kerning application
  components/           React panels, canvas, proof bar, import/export UI
  App.tsx               application state, history, Fontra bridge
fontra-plugin/          Fontra sidebar panel and descriptor
tests/                  Vitest suites for all core engines and adapters
public/demo-fontra/     bundled Fontulja sample
public/demo.ttf         Atkinson Hyperlegible fallback + OFL license
```

Data model notes:

- Side 1 / side 2 groups are stored separately (`groups.left`, `groups.right`).
- Kerning keys use `\0` as a separator, so glyph names containing `/` or `@`
  remain safe.
- Group kerning values use `@group` names. Resolution order is:
  explicit pair → left group × right group → left group × right glyph →
  left glyph × right group → 0.
- Suggestions include confidence and a reason string; applying them is explicit.

## Demo data

`public/demo-fontra` is the supplied `fontulja1.fontra` project, copied into the
app so it can be loaded over HTTP. It has one source, basic Latin lowercase
glyphs, `bar`, and `space`; `f` exists as an empty placeholder. This makes it a
good stress test for missing-outline warnings and under-spaced rhythm.

The TTF fallback is Atkinson Hyperlegible, licensed under the SIL Open Font
License; see `public/OFL-AtkinsonHyperlegible.txt`.

## Limitations / honest notes

- **OTF export is a proofing export, not a production compiler.** It writes CFF
  outlines and a legacy `kern` table through opentype.js. It does not write GPOS/
  GSUB features, hinting, variable axes or a TTF (`glyf`) build. Use Fontra,
  fontmake or Glyphs for final production compilation.
- **GPOS kerning from binary fonts is not imported.** `opentype.js` exposes a
  legacy `kern` table when present; GPOS-only kerning is skipped with a warning.
  Import a UFO or `.fontra` project for full kerning fidelity.
- **Collision QA is capped** at the first 2,000 pairs and 24 scanlines. It is a
  review prompt, not an exhaustive proof.
- **The Fontra bridge is selection/text deep, not document deep.** It does not
  read or write the open Fontra project directly; use Fit's UFO/Fontra import and
  export for round-tripping.
- **Multi-master is edit-per-source, not live interpolation.** You can import
  designspace masters and switch between them, but the canvas does not preview
  interpolated instances or edit axis mappings. Each source keeps its own
  outlines, kerning and metrics keys. Designspace export writes the masters,
  axes and locations; it does not write instances.
- **Single-source exports:** UFO, Fontra and OTF export write the active source.
  Use `.fit.json` or designspace export to keep every master.
- Automatic spacing and kerning are assistants, not autopilot. Review suggestions
  and proof at reading size.

## Verification

The repository ships with tests for:

- project normalization, groups, kerning precedence and metrics
- sidebearing edits and outline preservation
- metrics keys, idempotent application, broken-key QA and round-trips
- designspace source discovery, axis defaults, multi-UFO import/export
- OTF export and binary re-import including legacy kern pairs
- spacing suggestions, application, outliers and health
- pair sampling, auto-kerning, collisions, groups, transforms and coverage
- joint solver behavior and preview immutability
- tracking presets, feature generation and CSS/JSON/CSV exports
- QA checks and scoring
- native JSON, Fontra folder/zip, UFO folder/zip and TTF import/export round-trips
- text layout with kerning and tracking

Run `npm test`, `npm run check`, and `npm run build` to reproduce.

## License

GPL-3.0. The bundled demo font is under the SIL Open Font License; see the
license file in `public/`.
