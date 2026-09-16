# 7KL presentation generator

Reusable Node.js ESM design system for generating and validating premium 7KL PowerPoint presentations with PptxGenJS. It combines editorial A-scenes with decision-room B-scenes and contains native vector diagrams, charts, proof states, price and contact compositions.

## Environment

- Node.js 22+
- Bash
- LibreOffice (`libreoffice`)
- Fontconfig (`fc-match`)
- Poppler utilities (`pdfinfo`, `pdffonts`)

Install dependencies with `npm install`. The bundled Fontconfig file resolves Montserrat from `assets/fonts/`; no system font installation is required.

## Commands

```bash
npm test
npm run build
npm run render
npm run build:smoke
npm run render:smoke
```

`npm run build` creates the 12-slide Russian visual demo at `output/design-system-demo.pptx`. Output remains anchored to this generator even when the script is launched from another current working directory. `npm run render` creates the PDF and fails unless its page count matches the PPTX and Montserrat is embedded.

Convert any generated deck with:

```bash
npm run convert -- /absolute/path/deck.pptx /absolute/path/pdf-output
```

The converter accepts a PPTX path and optional output directory, resolves Montserrat from the bundled font assets, compares PPTX slide count with PDF page count, and validates that the PDF contains embedded Montserrat.

## Public modules

- `src/theme.mjs` — exact 10 × 5.625 inch layout, content grid, typography, palette, evidence and metadata tokens.
- `src/components.mjs` — reusable A+B slide primitives, diagrams, native data visualizations and deterministic text guards.
- `src/design-system-demo.mjs` — 12-slide visual reference with Russian sample copy and varied compositions.
- `scripts/convert-deck.sh` — reusable PPTX-to-PDF quality gate.

The system is intended to scale to the planned 98-slide family through composition. Exact layouts should not repeat more than twice; dense evidence must be distributed across scenes rather than compressed into generic card grids.

## Image trust boundary

The current smoke generator creates SVG geometry internally and rasterizes it to a PNG with Sharp. Only this trusted internal PNG/SVG path is approved. Do not accept or inspect untrusted external ICNS, JXL, HEIF, or other image payloads without adding explicit validation and resource limits.

## Known dependency advisory

`pptxgenjs@4.0.1` installs `image-size@1.2.1`, affected by `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` denial-of-service advisories. The package is not reached by the approved internal PNG smoke path, and no non-breaking patched dependency version is currently available. The temporary decision is to retain the dependency, preserve the trusted-image boundary, avoid `npm audit fix --force`, and reassess before external image ingestion is introduced.
