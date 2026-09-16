---
category: Changed
audience: public
---

**Every tool is a row in the left sidebar, and a tool opens onto the whole canvas.**

The Tools area was a two-sided screen: a navigation column of every tool on the left, the chosen tool beside it. The owner's direction of 2026-09-16 ends it for two reasons, and the second decided it. The tools are not a family — a postage rate, a WHOIS record, a county recorder's site and a bandwidth measurement share a sentence in the catalog and nothing else, so a column listing the other eight beside the one you opened is a column of things you are not doing. And it cost every tool the width of that column permanently, which the surfaces that will carry the most use — mailing and postage first, where a label, a rate table and an address want to sit side by side — can least afford.

`navigation/tool-sidebar.ts` projects the tool catalog into sidebar rows, so nothing about a tool is restated: the catalog still owns identity, subject group and the permission that gates it, the presentation layer the descriptor, stage and glyph, and `toolRoute()` the address. The registry gains a `tools` group headed by the index row (now "All Tools", and `exact` so it no longer lights up under every tool beneath it); `/tools/<id>` is unchanged, because that address is the catalog's and breaking saved links to shorten a URL is not a trade. `/tools/+layout.svelte` is a passthrough. A tool's rail row is `pinned`: what a member sees there is what they are permitted to run, and a star beside it would be a second, inert answer to a question access control has settled — which is also why Customize mode leaves the group out.

Sidebar groups fold, in the same pass: Workspace, Money, Firm and Tools each carry `Sidebar.GroupTrigger` — the heading itself, with a chevron and the full width as its target — and the fold is remembered per browser. The collapsed icon rail never folds, because a rail with no visible heading has nothing to fold by and nothing to press to bring the rows back. Folding is the sidebar's alone: every destination in a folded group is still one Ctrl+K away.

## Public

**The tools are in the sidebar now.** Shipping and postage, the WHOIS lookup, the safe website viewer, the speed test and the rest each have their own row, so a tool is one click from wherever you are — and it opens across the full screen instead of sharing it with a list of the tools you are not using. "All Tools" is still there for browsing what each one does. The sidebar's Workspace, Money, Firm and Tools headings can be folded away to shorten the list, and it remembers which ones you folded.
