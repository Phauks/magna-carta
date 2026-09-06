---
category: Changed
audience: public
---

**The five money sections render inside one surface, `MoneySurface` (`apps/web/src/lib/money/`), wearing the file manager's frame.** Time, Fees, Costs, Billing and Trust each hand the surface their grid, cells, figures, acts and details panel; the surface draws the toolbar flush under the section strip (a coins glyph, the five sub-parts as quiet links with the current one marked, Clear Filters while a filter is on, a ledger's own acts, the density and layout switches), the notices band, the list, an optional line above the footer (where Time and Costs now keep Load more), and the counts strip with the pane toggle last. Two reader preferences are shared by every money section under one key each: the layout (`flush`, the default, or `framed`, the previous rounded-card look) and the row density. Four copies of the frame, the Clear Filters control and the pane toggle became one.

**Trust takes its first surface.** `apps/web/src/lib/trust/` holds the client (`readMatterTrustLedger` over the matter ledger read), the column set, the figures (Balance, Held, Available), the gap register and the ledger, built whole against the trust movement record. The one dependency is named where the fee ledger names its own: the matter ledger is read against a trust account, and no route lists the firm's trust accounts yet, so the list stands empty with the Soon line and the header's New Deposit is disabled with that reason. The trust activity contribution moved out of `awaiting/` and beside the surface it belongs to.

**An empty table no longer lights up under the pointer.** The shared grid's row hover and pointer cursor (`packages/design-system/src/lib/components/data-table/data-table.css`) now exclude the placeholder row, which the standing ruling on placeholder rows already required and which the flush layout made visible: with the grid's own frame gone, a tinted placeholder read as a band of a different surface.

## Public

**Time, Fees, Costs, Billing and Trust now look and work the same.** Each opens as one surface that runs to the edges of the screen, the way Files does: a row at the top names the money section you are on and lets you step to the other four in one click, the table starts directly under it, and the counts and totals sit on the bottom edge. Clearing filters, choosing comfortable or compact rows, and switching between the edge-to-edge and the framed table are on that top row, and the choice you make applies to every money section at once.

**Trust has a screen.** A matter's Trust section shows the ledger it will hold: every deposit, disbursement and transfer between the client's matters, with the balance, the amount under hold and what is available. It is empty for now and says why: the firm's trust accounts cannot be listed yet, so nothing can be read into it or recorded from it.
