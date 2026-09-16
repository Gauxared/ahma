# Universal Commercial Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. No worktree and no commits are permitted for this delivery.

**Goal:** Produce one editable 32-slide Russian commercial proposal as PPTX, PDF, rendered PNG pages, and a contact sheet, with deterministic validation.

**Architecture:** Extend the existing PptxGenJS A+B design system with a focused commercial deck module. Keep content and slide-source metadata in `src/decks/commercial.mjs`, deck writing in `src/build-commercial.mjs`, and rendering/verification in `scripts/render-commercial.sh` plus a Sharp contact-sheet utility.

**Tech Stack:** Node.js ESM, PptxGenJS, Sharp, LibreOffice, Fontconfig, Poppler utilities, Node test runner.

---

### Task 1: Lock commercial contract tests

**Files:**
- Create: `test/commercial.test.mjs`
- Modify: `test/theme.test.mjs`

- [ ] Add tests asserting canonical colors, Montserrat, 10 × 5.625 layout, exactly 32 slide definitions, exact generated output anchoring, required price and paid-offer claims, maturity separation, data-contour restriction, estimate-method constraints, and individualized rights/support terms.
- [ ] Run `node --test test/commercial.test.mjs`; expect failure because the commercial module does not exist.

### Task 2: Build the 32-slide content and source map

**Files:**
- Create: `src/decks/commercial.mjs`
- Modify: `src/theme.mjs`
- Modify: `src/components.mjs`

- [ ] Define 32 ordered slide records matching the approved narrative one-for-one.
- [ ] Include concise Russian copy, proof status, internal source/evidence notes, and a distinct composition key per scene.
- [ ] Add reusable primitives for document stacks, normalization trace, offer comparison, estimate range, calculation trace, grouped competency map, mode/status queue, output documents, maturity split, interface prototype, provenance chain, data contours, security layers, integrations, governance, acceptance gauges, and commercial/TCO boundaries.
- [ ] Run `node --test test/commercial.test.mjs`; expect all content-contract tests to pass.

### Task 3: Generate the anchored PPTX

**Files:**
- Create: `src/build-commercial.mjs`
- Modify: `package.json`

- [ ] Configure PptxGenJS with the canonical theme and metadata.
- [ ] Render all 32 scenes using native vectors and add internal source notes/slide notes where supported.
- [ ] Write only to `../generated/01-stroyintellekt-commercial-universal.pptx`, resolved from the generator module location.
- [ ] Add `build:commercial` and make `build` target the commercial deck.
- [ ] Run `npm test`; expect all tests to pass.
- [ ] Run `npm run build:commercial`; expect the exact PPTX path to exist and be non-empty.

### Task 4: Render and verify PDF/PNG/contact sheet

**Files:**
- Create: `scripts/create-contact-sheet.mjs`
- Create: `scripts/render-commercial.sh`
- Modify: `package.json`

- [ ] Resolve Montserrat only from bundled local assets and use an isolated LibreOffice profile.
- [ ] Convert the PPTX to the exact PDF path and require 32 pages.
- [ ] Require embedded Montserrat via `pdffonts`.
- [ ] Render all pages to PNG with `pdftoppm` under `../generated/qa/commercial/pages/`.
- [ ] Build a legible Sharp contact sheet under `../generated/qa/commercial/contact-sheet.png`.
- [ ] Extract PDF text and fail on placeholders, forbidden overclaims, missing price language, or missing paid diagnostic/pilot separation.
- [ ] Add `render:commercial` and make `render` target the commercial pipeline.

### Task 5: Visual and technical QA

**Files:**
- Modify as defects require: `src/decks/commercial.mjs`, `src/components.mjs`

- [ ] Run `npm test`, `npm run build:commercial`, and `npm run render:commercial`.
- [ ] Run `pdfinfo`, `pdffonts`, and `pdftotext` checks independently.
- [ ] Inspect the contact sheet and selected full-size pages for clipping, repeated layouts, weak hierarchy, wordmark wrapping, and unreadable text.
- [ ] Fix visible defects and repeat build/render/verification until clean.
