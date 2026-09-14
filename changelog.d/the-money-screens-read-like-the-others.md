---
category: Changed
audience: public
---

**The firm's Time, Fees, Costs and Billing screens lose their header controls, and their column filters reach the server.** Each carried a period dropdown (worded three different ways), a billing or status dropdown, and a meta line beneath the title that no other main screen has (`docs/conventions/time-tab-rulings.md`, round twelve). The screens now open on their whole record and the table is the only thing that narrows them; the Date, Status, Billable and Timekeeper filters are sent to the listings as `from`/`to`, `status`, `billable` and `timekeeperUserId` (`apps/web/src/lib/money/listing-scope.ts`), so a filter holds across every page rather than over the page in hand, and the same choices ride the address. The three listings take either date bound alone or neither — nothing named is the whole record over the date index, where they used to answer empty — and the fee and cost listings gain a `search`. Fees and Costs carry the live `ScreenSearch`; Time and Billing render it disabled and marked, because their listings' statements (`packages/timekeeping`, `packages/billing`) have no search yet. Billing gains "+ Bill": the draft dialog the matter register already uses grew a matter-first shape, resolves the client from the party record (`client-party.ts`), and goes to the matter's Billing section with the draft open. The messaging screen's four scope tabs are gone for the same reason; the Matter column's filter reaches the server as the listing's scope, and the count waiting to be filed stands in the counts strip.

## Public

**The money screens read like every other screen.** Time, Fees, Costs and Billing open on everything the firm has recorded, newest first, and you narrow them the way you narrow any list: from a column's own heading. Filter Date to a span, Status to drafts, Billable to what the client is charged for, and the filter holds across the whole record rather than only the rows already on screen. The dropdowns above the table and the line of text under the title are gone. Fees and Costs gain a search that reads the whole record; on Time and Billing the search is shown but not yet connected, and says so.

**Billing has New Bill.** Choose the matter, and the draft opens on that matter's own Billing section, where the work it claims lives.

**Messaging has no tabs.** Everything, the queue, what is filed and what was set aside are choices on the Matter column's filter, and the number of calls waiting to be filed stays on the counts strip under the table.
