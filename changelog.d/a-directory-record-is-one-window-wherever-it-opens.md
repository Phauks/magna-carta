---
category: Changed
audience: public
---

**A directory record opens in one window, wherever it is reached, and the tabbed record screen is gone.** `apps/web/src/lib/directory/entity-window.svelte` is the entity window: the action dialog's reading kind at record width, the record's sections as a rail on the left in the New Person screen's arrangement, the chosen section's pane beside it, and on the right what stands about the record — the roles a matter knows it holds there (`apps/web/src/lib/matters/party-standing.ts`) above the record's own facts. The directory list, a matter's parties tab, the client fact on the overview and the conflicts hit window all host it; a related record opened from inside it swaps the subject. `entityRecordHref` now builds `/directory?record=<id>`, the list opens the window from that address and mirrors swaps and closes back into it, and the old `/directory/<id>` route redirects there so earlier links still land. The path that made a screen's way back lead somewhere the reader had not come from is gone, so the registry-named way back stays true on every remaining screen; `lint:back-navigation` carries the redirect route as its one stated exemption.

## Public

**Opening a person or an organization no longer takes you away from what you were doing.** From a matter's parties, from the client on a matter's overview, from a conflicts check or from the Directory itself, the record opens in a window over the page, laid out the way it was when it was recorded, with its sections down the left side. Close it and you are back exactly where you were. Opened from a matter, the window also lists the roles that record holds on the matter. A record's address still works: following one opens the Directory with that record's window already open.
