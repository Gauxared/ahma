# StroyIntellekt Presentation PDFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce three premium, designer-quality, editable 16:9 presentations and final PDFs for a universal developer/builder audience using the complete commercial/technical source material, product-truth constraints, and 7 КРАСНЫХ ЛИНИЙ visual system.

**Architecture:** A local Node.js presentation generator will use PptxGenJS, a shared theme, reusable components, and deck-specific slide modules. The build will output PPTX files, convert them to PDF through LibreOffice with Montserrat installed locally, render PDF pages to PNG, and generate contact sheets for visual QA.

**Tech Stack:** Node.js 22, PptxGenJS, SVG/native PowerPoint shapes, LibreOffice headless conversion, Poppler (`pdfinfo`, `pdftoppm`), Montserrat variable font.

---

## File Structure

- Create: `product/opencode-gpt56/presentations/generator/package.json` — build and QA commands.
- Create: `product/opencode-gpt56/presentations/generator/package-lock.json` — deterministic dependency lock.
- Create: `product/opencode-gpt56/presentations/generator/assets/fonts/Montserrat[wght].ttf` — official Montserrat font.
- Create: `product/opencode-gpt56/presentations/generator/assets/fonts/OFL.txt` — font license.
- Create: `product/opencode-gpt56/presentations/generator/src/theme.mjs` — 7KL tokens, grid, typography, colors, metadata.
- Create: `product/opencode-gpt56/presentations/generator/src/components.mjs` — shared slide chrome, typography, cards, rails, diagrams, evidence badges, charts and footer.
- Create: `product/opencode-gpt56/presentations/generator/src/decks/commercial.mjs` — 32-slide universal client commercial deck.
- Create: `product/opencode-gpt56/presentations/generator/src/decks/cases.mjs` — 30-slide anonymized proof/case deck.
- Create: `product/opencode-gpt56/presentations/generator/src/decks/sales.mjs` — 36-slide internal sales playbook.
- Create: `product/opencode-gpt56/presentations/generator/src/build.mjs` — deck assembly and PPTX export.
- Create: `product/opencode-gpt56/presentations/generator/scripts/render.sh` — PPTX→PDF→PNG rendering and contact-sheet generation.
- Create: `product/opencode-gpt56/presentations/generated/*.pptx` — editable presentation sources.
- Create: `product/opencode-gpt56/presentations/generated/*.pdf` — final deliverables.
- Create: `product/opencode-gpt56/presentations/generated/qa/*.png` — rendered pages and contact sheets.

### Task 1: Bootstrap the presentation generator

- [ ] Create the generator directory structure and package manifest with `pptxgenjs` and `sharp`.
- [ ] Download Montserrat and its OFL license from the official Google Fonts repository.
- [ ] Install dependencies and verify `node`, LibreOffice, Poppler and Montserrat availability.
- [ ] Add a smoke deck with one Cyrillic slide and export it to PPTX/PDF.

### Task 2: Build the shared 7KL design system

- [ ] Encode the 10×5.625 inch 16:9 canvas and strict content grid.
- [ ] Encode white/black/red/gray tokens and Montserrat typography.
- [ ] Implement brand rail, footer, page numbering and one-line `7 КРАСНЫХ ЛИНИЙ` wordmark.
- [ ] Implement reusable editorial, decision-room, process, comparison, evidence, price, chart, CTA and contact components.
- [ ] Implement overflow guards and helper checks for slide titles and text density.

### Task 3: Produce the 32-slide commercial presentation

- [ ] Expand the approved commercial Markdown into 32 visually distinct scenes without dropping any key capability, commercial condition, implementation boundary or acceptance principle from the original commercial proposal and technical specification.
- [ ] Preserve target-state wording, proof separation, separate paid diagnostic/pilot scopes and base deployment `от 20 млн ₽`.
- [ ] Cover category, executive promise, current decision failures, role-specific value, nine functional competencies, full module map, document/data inputs, comparison of contractor offers, independent estimate methodology, deterministic calculations, object economics, financing, contracts, work outputs, user workflow, interface contour, knowledge base, data contours, security, integrations, implementation stages, customer responsibilities, acceptance metrics, proof strategy, offer ladder, price/TCO, rights/support, boundaries and CTA.
- [ ] Add diagrams for fragmented decision inputs, capability contours, offer comparison, decision package, evidence ladder, implementation, acceptance, commercial ladder and total-cost structure.
- [ ] Add a strong final CTA for selecting one real object and agreeing the next working session.

### Task 4: Produce the 30-slide proof/case presentation

- [ ] Expand the approved anonymized evidence into 30 scenes: proof policy, methodology, artifact map, five core case chapters, recurring patterns, traceability, maturity boundary, proof dossier and evidence-pilot design.
- [ ] Give each core case 3–4 slides: decision context, source package, analytical route, outputs/business meaning and limitations.
- [ ] Use `input → analysis → output → business meaning` as the repeated semantic system while changing exact compositions and visual metaphors.
- [ ] Mark all results as methodological/model evidence rather than realized savings.
- [ ] Add proof-level, traceability, evidence-pilot and publication-gate scenes.

### Task 5: Produce the 36-slide internal sales playbook

- [ ] Expand the approved playbook into 36 main slides with editorial pauses every 4–5 dense slides.
- [ ] Visualize ICP, buying committee, qualification gates, discovery map, offer ladder, pilot, funnel, objections, lead magnets, CRM handoff, claims ladder, ROI/TCO and weekly growth loop.
- [ ] Add product strategy, market-entry logic, role-specific messages, trigger events, fit/no-fit scorecard, meeting scripts, demo choreography, proof selection, commercial guardrails, security gate, nurture mechanics, channel strategy, content system and manager checklist.
- [ ] Keep commercial rights, licensing, TCO, data-contour and effect-attribution constraints visible.
- [ ] End with manager action standards, pitch and closing scripts.

### Task 6: Render and verify all deliverables

- [ ] Generate all PPTX files and verify slide counts are exactly 32, 30 and 36.
- [ ] Convert every PPTX to PDF with LibreOffice and verify PDF page counts match.
- [ ] Render every PDF page to PNG at review resolution.
- [ ] Generate contact sheets for each deck.
- [ ] Inspect contact sheets and selected full-resolution slides for clipping, typography, spacing, rhythm, claims and visual consistency.
- [ ] Fix defects and rerun the complete build and render process.
- [ ] Run `git diff --check` and report all created deliverables without committing.

## Acceptance Criteria

- Three editable PPTX files and three final PDF files exist.
- PDF page counts are 32, 30 and 36.
- All slides use Montserrat in final rendered PDFs.
- Client decks are understandable when sent without a presenter.
- No placeholders, leaked case identities, unsupported savings claims or target-state/current-state confusion remain.
- Visual rhythm follows the approved A+B direction, not repetitive card grids.
- The 98-slide system feels dense and premium without becoming a text document placed on slides; information is distributed across purposeful scenes with native diagrams, comparisons and charts.
- The commercial deck clearly states `от 20 млн ₽` for base implementation and separates diagnostic and evidence pilot pricing.
- Every deck ends with a concrete decision or action.
