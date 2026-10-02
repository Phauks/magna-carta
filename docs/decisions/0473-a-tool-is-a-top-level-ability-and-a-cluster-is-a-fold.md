---
number: 473
slug: a-tool-is-a-top-level-ability-and-a-cluster-is-a-fold
status: Proposed
date: 2026-09-16
area: Navigation & information architecture
summary: "The left rail carries five platform groups plus the member's own — Favorites, My Desk, Workspace, Money, Firm, Tools — where the old Workspace group held fourteen rows spanning a person's morning and the firm's evidence; Home, Notifications, Tasks, Calendar and Magnus move to My Desk because they are about the member rather than about the work. Every tool becomes a TOP-LEVEL ABILITY addressed at /<id> with a rail row of its own, and the /tools area is retired entirely — the two-sided screen, its index, the catalogue projection and the ToolManifest.route escape hatch — because a screen about tools is a stop on the way to work and the only two things the index carried, the descriptors and the search, already belong to the presentation layer and the command palette. The rail grows a SECOND LEVEL to hold nine tool rows: a cluster is a row with a glyph, a name and a chevron whose members tuck beneath it, declared in navigation/clusters.ts and available to any group; it is a fold and never a screen, nothing is reached through one, and a cluster holding a single row is seated as a plain row instead. The catalog's eight subject groups collapse to four named for what a member is doing — Records, Internet, Mailing, Files — and a cluster's tools sort alphabetically by name rather than in catalog order. Two rows change sides: the File Workbench returns to the catalog now that reaching a tool costs no navigation, and Firm Usage leaves it for the Firm group beside Reports, keeping its permission through a new optional Destination.permission, because a tool is a utility a member runs and reading the firm's own records is not one. Finally the visibility layer and the favourite layer stop sharing a mark: Customize's show/hide takes an EYE, and the STAR becomes a real favourite — any address at all, saved from the one header component every screen builds its title from, rendered as the rail's first group."
---

**A tool is a place you go, not a thing you find on a page about tools — and a rail that has grown
past a glance folds, rather than being read as a longer list.**

**Context.** The Tools area had been rebuilt twice in a fortnight and was wrong both times. It began
as a two-sided screen: a navigation column of every tool on the left, the chosen tool on the right.
That column listed things the reader was not doing — a postage rate, a WHOIS record, a county
recorder's site and a bandwidth measurement share a sentence in the catalog and nothing else — and it
cost every tool the width of that column permanently, which the surfaces that will carry the most use
can least afford. The tools were elevated into the global rail and the screen became an index: the
descriptions and the search, where a reader finds out what each tool does.

That index was still a stop on the way to work. A member who wants the WHOIS lookup wants the WHOIS
lookup. And the two things it carried were never its own: the descriptors belong to the presentation
layer, and the search net is `toolSearchKeywords()` — both of which the command palette already
renders, over every destination at once, from one keystroke, with no navigation first.

Meanwhile the rail itself had a different problem of the same shape. Workspace held fourteen rows,
from Home to Custodian, which is a heading with a list under it rather than a group. And nine tool
rows arriving in a group of their own would have made it worse, not better.

**Decision.** Five rules, and the third is what makes the second affordable.

**One. Every tool is a top-level ability.** Its own address at `/<id>`, its own rail row, one press
from wherever the reader is, the whole canvas when it opens. There is no `/tools` — no layout, no
index, no catalogue projection — and therefore no `ToolManifest.route`: an escape hatch from a prefix
that no longer exists is a field that can only be wrong. `toolRoute()` derives `/<id>`, which is also
what stops a renamed tool keeping its old URL.

**Two. The rail is five platform groups, each answering one question.** Favorites (the member's own),
My Desk (what is on MY plate), Workspace (the firm's work), Money, Firm, Tools. Home and Notifications
were the tell: they are about the person, not about the firm's work, and no amount of ordering inside
one group was going to say that.

**Three. A cluster is the rail's second level, and it is a FOLD.** A row with a glyph, a name and a
chevron, whose members tuck beneath it behind an indent and a hairline. It has no address; pressing it
opens the rows. That is the whole difference between this and the sub-page it replaces, which charged
a navigation for the same grouping. Three properties keep it honest: a cluster holding a single row is
seated as a plain row, because a chevron hiding one thing costs a press and saves nothing; the
collapsed icon rail draws every row flat, because a rail with no labels has nothing to fold by; and
the palette reaches every row in a fold, because hiding must never remove capability. The mechanism is
declared once and available to any group, so the next group that outgrows a glance folds the same way.

**Four. The catalog's subjects are named for what a member is doing.** Eight groups over nine tools is
a heading per tool. Records, Internet, Mailing, Files — a member reaching for a WHOIS record thinks
"internet", never "web-domains". Within a cluster the tools sort alphabetically, because somebody
scanning for a tool has its name in mind; catalog order is the order rows were written, which is a
fact about this repository and not about the firm.

**Five. The visibility layer and the favourite layer stop sharing a mark.** Customize decides which of
the rows the platform ships appear in their groups, and says so with an EYE. A FAVOURITE is the
member's own shortcut to any address at all — a matter, a tool, a record, a section deep inside one —
and keeps the STAR, which is what a star means everywhere else. Favourites are not registry data and
could not be: the platform cannot know which of ten thousand matters somebody opens every morning, so
the person standing on it says so. The gesture lives in the one header component every screen builds
its title from, which is what puts it on every page without a single screen opting in.

**Two rows change sides, and both moves follow from the same test — what is this thing FOR.** The File
Workbench had been promoted out of the catalog into a hand-written Firm destination precisely because
the old area charged a navigation to reach a surface whose entry gesture is dropping a file; that
reason is gone, so it is a catalog tool again, the Files cluster's one member. Firm Usage goes the
other way. A tool is a utility a member RUNS — bring it a domain, an address, a file — and Firm Usage
runs nothing: it is the firm reading its own records, which is exactly what Reports beside it does. It
keeps the `tools:firmUsage` key that gates it, carried now by an optional `permission` on a
destination; renaming the key would be a migration across the role seeds for no reader's benefit, and
what mattered was that the gate travelled with the row.

**Consequences.** Five route directories move out of `(app)/tools/`, and any link kept to a
`/tools/<id>` address stops resolving — accepted on a pre-release tree, where the alternative is a
redirect table for addresses nobody outside the firm has. `tool-catalogue.ts` and `SUBJECT_GROUP_LABELS`
are deleted, the latter re-homed in the cluster registry where a subject's name sits beside its glyph
and its group. The shared catalogue framework stays with Reports as its one consumer: one screen using
a shared shape is not a reason to un-share it, and the projection rules are what the next catalogue
will be held to. The stored sidebar preference changes shape — `starredOverrides` becomes
`visibilityOverrides` and the group ids move — so a member's existing arrangement resets to the
defaults once; the read-time validator already drops what it does not recognize, so nothing breaks,
and re-arranging a six-row rail is cheaper than a migration for a preference held per browser.
Favourites are per browser for the same reason, and carrying them across a member's devices waits on
the member-preferences store.
