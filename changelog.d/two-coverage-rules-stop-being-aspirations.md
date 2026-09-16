---
category: Added
audience: internal
---

**`pnpm run lint:area-notes` and `pnpm run lint:catalog-coverage` — two rules the repository states and nothing held.**

Every code area is supposed to carry its own `CLAUDE.md` for local rules and the invariants that bind there. 55 of 85 workspace packages do. The 30 that do not are now a register that only shrinks, and it includes `packages/data-access` — the home of the firm-scoping golden rule — and `apps/web`. The gate also checks what the existing notes do, and they all pass: each opens with a title naming its own area (so a note copied from next door is caught) and says what the area is before anything else. What it deliberately does not require is the template's full section list: `## Local conventions` appears in 9 notes of 55, so requiring it would mint 46 headings reading "None."

The design system's coverage rule — catalog entry, behaviour test, visual regression — is held at the **component family**, the directory the package's `exports` map names one subpath each, not the file. The per-file version was measured first: 229 of 235 `.svelte` files under `src/lib` are exported, because a compound component exports its parts by design, and only 56 are imported by a story directly. That opens a 173-entry register of parts the family's own story already photographs — a form to fill in rather than a debt to pay. At family level the number is 79 of 83, and the four missing entries are the register: `field-label`, `folder-glyph`, `record-reference`, `service-marks`.

Coverage counts the story an entry is **about**, never a component that merely renders inside someone else's story: rendered-somewhere is enough for a screenshot to move and not enough for a person to find the component, and not finding it is how the second implementation gets built. The behaviour leg is clean from either side (87 of 91 stories carry `storybook/test` assertions). The visual-regression leg is not per-component checkable and is not pretended to be — `catalog.spec.ts` holds no component list at all, deriving its matrix from the built catalog at run time, so the gate asserts that derivation instead and leg three follows from leg one.
