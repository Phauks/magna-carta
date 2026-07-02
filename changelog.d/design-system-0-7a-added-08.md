---
category: Added
---

**`@magna-carta/design-system` — catalog reorganized into semantic categories** (slice 0·7a Phase D): story titles moved from a flat `Components/*` to `Inputs` / `Compound Inputs` / `Actions` / `Data Display` / `Feedback` / `Layout` / `Foundations` (+ a future `Overlays`). Done while the catalog was small and no VRT baselines were committed (re-titling changes story IDs). The **Input** `type` became a closed `InputType` union with one story per type (each carrying its real validation/input-mode), a `tel`→"Telephone" display-label map, and a `type` dropdown; **FileInput** (styled `type="file"`) was added as its own Tier 1 component; the Card/Skeleton/Label stories' bare-`<Story>`-children double-render was fixed (explicit `{template}` snippet). The Compound-Inputs inventory (Money/Phone/Password/Date/Country/County/Address/Payment/National-ID/ColorPicker) and future families (Slider, DropdownMenu, ContextMenu, AI) are flagged in the package `CLAUDE.md`.
