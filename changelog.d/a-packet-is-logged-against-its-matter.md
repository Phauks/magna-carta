---
category: Changed
audience: public
---

**A custody packet now requires its matter, and the owners on offer are that matter's parties.** The register was built on the premise that a packet's matter link is optional — the case being the will held for a client whose last matter closed years ago. The owner's ruling reverses it: no matter means no client, and the firm does not hold originals for people it has no relationship with. Everything the round changed follows from that.

The form is two columns now: the packet on the left, its contents on the right, added a line at a time before anything is written. The matter leads the left column because the rest depends on it — `owner-picker.svelte` reads `GET /directory/matter-parties?matterId=`, which already existed, instead of searching the whole directory. That search was the real defect the ruling exposed: the directory holds opposing counsel, courts and vendors, and offering all of it as candidate owners invites recording a will as held for the other side's attorney.

The contract holds the rule too, which it did not at first. `matterId` was made required on the form and left optional on `POST /custody/packets`, and a rule one screen holds is not a rule. It is required in the request schema now, and `createCustodyPacket` refuses a blank one at the single place a packet comes into existence — the fixtures and the seeders reach that function directly, and a types-only requirement is a requirement until somebody casts. The create path no longer resolves or mints the per-firm holding matter that stood in for an absent one; the column stays nullable and `resolveCustodyFilingMatter` still answers for packets logged under the old rule, because a register that refused to read its own older rows would be the worse failure. The load profile's `matterlessPacketFraction` knob is gone with the shape it generated.

`GET /api/v1/custody/next-number` is new, reading the counter through the same `readCounterValue` / `renderCustodyNumber` pair the draw uses rather than reimplementing the shape. It allocates nothing, so the response carries `tentative: true` in the body rather than leaving the word to the endpoint's name.

The container field could not be filled at all: a new firm has no custody locations and nothing in the product created one, so the dropdown was empty on exactly the day it mattered. It now describes one inline, nested under whatever is selected.

Three surfaces had grown their own matter-file picker with three different ideas of what a quarantined file should do in a list. `$lib/components/matter-file-picker.svelte` is the one of them; it lists a file that cannot be chosen with the reason beside it rather than hiding it, because hiding is the treatment that leaves a person unable to tell "not there" from "not allowed". The matter picker and the firm-matters store moved from `$lib/time` to `$lib/matters`, which is where a second consumer proved they belonged.

The placeholder-cell wrapping fix from the previous round **never took effect**: `.mc-table-grid-placeholder` is one class against `.mc-table-grid .mc-table-cell`'s two, so `nowrap` kept winning and the empty register kept running off the screen. Now descendant-qualified, and pinned by a story asserting the computed value and the absence of overflow — the only kind of assertion a specificity loss cannot pass.

## Public

**Logging a packet now starts with its matter, and asks for less guesswork after that.**

The form has two sides: the packet on the left, what is inside it on the right, added a line at a time. Choosing the matter first means the people it can be held for are that matter's parties rather than your entire address book — so an original can no longer be recorded as held for opposing counsel by a slip of the keyboard. The documents you can attach are the ones already filed on that matter.

A packet without a matter is now refused by the server as well as by the form, so nothing can record one through another route. Packets logged before this rule still read normally.

**The number is shown before you save**, marked tentative: nothing is reserved by showing it, so if a colleague logs one first yours takes the next. It is there because it is what you are about to write on the label.

**You can describe a container from the form.** Before, a firm that had not set up its storage met an empty dropdown and no way to fill it, which stopped the first packet being logged at all. A container described while another is selected nests inside it.

Two fields are renamed to what a firm calls them: **Trustor** and **Acquisition date**. And **Existing number** is clearer about what it does — it is for property that already carries a number from an earlier register, and setting it means the register keeps that number instead of drawing one.

**The empty register no longer runs off the right of the screen.** It was reported fixed last release and was not.
