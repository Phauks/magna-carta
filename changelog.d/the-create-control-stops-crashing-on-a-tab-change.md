---
category: Fixed
audience: public
---

**Moving between a matter's sections threw, because the create control treated an ordinary navigation as a defect.** The header's control checks that the claim behind it answers for the section the reader is standing on — a real guarantee, since the label comes from the address and the behaviour from the page, and a mismatch would mean the label says one thing and the press does another. It enforced that by throwing.

Leaving a section updates the address _before_ the outgoing page's effect cleanup releases its claim, so for one flush every ordinary navigation holds a claim for the section just left. The check fired on that window, inside a `$derived`, which crashed the screen: `The create control is claimed for "files" but the reader is on "parties"`, on every pair of tabs.

The decision moved into `honouredClaim` in `create-action.svelte.ts`, which ignores a claim belonging to another section rather than throwing. The guarantee is unchanged — an unhonoured claim is not pressable — and the control falls back to disabled carrying the line it already shows in the moment before a section claims. A genuine mismatch, a page answering for a section it does not render, now surfaces as a control that never becomes pressable instead of a white screen. Four tests pin the predicate, including the navigation window itself.

The slot's other rule is untouched: a second claimant while a first still holds the control is still refused loudly, because that one really is two parts of a screen believing they own the same action.

## Public

**Switching between the tabs inside a matter no longer breaks the screen.**

Moving from Files to Parties — or between any two sections — could stop the page dead. The New button at the top of a matter checks that it belongs to the section you are actually looking at, and for a fraction of a second during every tab change it belonged to the one you had just left. That moment is normal, and it is now treated as normal: the button simply waits, greyed, until the new section is ready, which is what it already did while a section was loading.
