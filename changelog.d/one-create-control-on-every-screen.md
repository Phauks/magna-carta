---
category: Changed
audience: public
---

**One create control, at one width, on every screen — and on a matter it sits beside the search.** Every matter section carried its own create button in its own action row, a different distance down the screen on every tab and a different width on every one of them: "New Fee", "Record a Cost", "Log Time", "Write Note", a bare "New". The owner's ruling on 2026-09-03 moves the affordance up into the matter header beside the search, as ONE control that reflects the section it is on without ever changing size.

`CreateControl` is a design-system component: a primary Button held at a token width (`size.create-control`), reading "New" and one noun, pressing straight through or opening a menu in the same footprint, and rendering disabled with its reason rather than leaving the row. The noun grammar (`create-label.ts`) refuses a phrase or a noun the width cannot hold, so the truncation the recipe carries is theoretical.

On a matter the control is answered from two places. `sections.ts` gains a required `createNoun` — a noun, or `null` with a `createWaitingOn` line — so the label is settled by the address before the section has mounted and never flickers between tabs. The section's page claims the behaviour through `claimMatterCreate` (`create-action.svelte.ts`) while it is mounted: a ledger exports `openNew()` and the page hands it over; Files hands over a three-item menu; Calendar states the refusal it used to draw as two disabled buttons. The slot refuses a second claimant, and a mount test pins the assumption that refusal rests on — a page swap releases the leaving claim before the arriving one lands.

The docket, the directory and the firm's custody register render the same component in their mastheads, and the custody register gains the register search beside it, so the pair reads the same way everywhere. Empty states no longer carry a second create button; each names the control at the top instead.

`pnpm run lint:matter-create-control` is the gate: every section answers, every noun fits, and no `<Button>` or menu trigger wearing the plus glyph — or reading as a create verb — survives on a screen that carries the control.

## Public

**Making something new is now the same gesture on every screen.**

On a matter, the **New** button sits at the top right beside the search and says what it will make on the section you are on: **New Fee** on Fees, **New Cost** on Costs, **New File** on Files, **New Note** on Notes, **New Packet** on Custodian. It is the same size on every section, so the search beside it never moves, and it stays on the screen even when nothing can be made right now: it is greyed out with the reason as its tooltip, rather than disappearing.

Where a section offers more than one thing to make, the button opens a short menu: on Files, a new document, a new folder, or an upload. Where a section does not make anything yet, the button says what it is waiting on.

The Matters list, the Directory and the Custodian register use the same button in the same place, and the Custodian register gains a search beside it, so the pair reads the same way wherever you are. The create buttons that used to sit lower down each screen, and inside empty lists, are gone; the one at the top is the one.
