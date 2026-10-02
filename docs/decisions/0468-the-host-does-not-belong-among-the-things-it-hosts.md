---
number: 468
slug: the-host-does-not-belong-among-the-things-it-hosts
status: Proposed
date: 2026-09-14
area: Navigation & information architecture
summary: "The File Workbench leaves the Tools catalogue and becomes a sidebar destination of its own, in the Firm group at /file-workbench, starred by default. The catalogue had it inverted: of its twenty manifests, eleven are the files subject group, and ten of those eleven map one-to-one onto the workbench's own capability tabs, so the listing offered eleven doors into one room with the room filed alphabetically between them. Firm rather than Workspace on a scope test rather than an importance one — Workspace holds the matter-scoped daily surfaces and this one is matter-free by construction. The manifest row stays, because the contextual surfacing path queries the catalogue by context tag and a tool absent from it is a tool nothing can offer, so the manifest gains an optional `route` and `toolRoute()` becomes the single derivation every link-builder goes through. Supersedes the placement in ADR-0101 and the Tools row in the page-archetypes canonical grouping; supersedes the /tools/file-workbench address recorded in the workbench's own pending decision. The ten sibling manifests are deleted rather than left in place: their permissions move to the workbench permission seam, which is what keeps the capability tabs from vanishing, and their search vocabulary moves onto the workbench's synonyms."
---

**A surface that hosts ten others does not belong filed among them, and one whose opening gesture is
dropping a file has to be reachable in one reach.**

**Context:** The tool catalogue (`packages/tools/src/catalog.ts`) carries twenty manifests. Eleven
are the `files` subject group. One of those eleven is the File Workbench; the other ten are its own
capability tabs, one for one, with no exception in either direction: `file-converter` is Convert,
`metadata-scrubber` is Metadata, `file-hash-integrity` is Hash, `file-decryption` is Unlock,
`file-type-verifier` is Type, `ai-text-detection` is AI Text, `file-repair` is Repair, `ocr` is Text
Recognition, `email-inspector` is Email, `malware-scan` is Malware Scan.

So the listing was not showing a tool among its peers. It was showing eleven doors into one room,
with the room itself filed alphabetically between two of its own doors. The workbench's reason for
existing is that nobody arrives asking which of ten tools they need; they arrive holding a file. A
listing that makes them choose among ten tools to find the screen that exists to spare them the
choice is working against its own premise.

The reach compounds it. The entry gesture here is a drop. Getting to it meant the sidebar, then
Tools, then scanning a twenty-row catalogue, while holding the file. And the usual escape hatch was
unavailable: the sidebar's star layer (`sidebar-preferences.svelte.ts`) operates over the
destination registry, and tools are a separate registry, so a member who used the workbench fifteen
times a day had no way to put it in their own sidebar. The command palette did reach it, which helps
a member who already knows the surface exists and does nothing for the drop.

**Decision:** The File Workbench becomes a destination in its own right — the Firm group, at
`/file-workbench`, shipped, `defaultStarred`, leading the group ahead of Tools.

Firm rather than Workspace, and the test is scope rather than importance. Workspace is the
matter-scoped daily surfaces; the workbench is matter-free by construction, since nothing brought to
it is filed, versioned, or remembered. That is the same test that put the transfer registers in the
sidebar's foot rather than in Workspace.

The route moves off `/tools/`, which is not cosmetic: destination currency is a path-prefix match
(`isCurrentDestination`), so a workbench still living at `/tools/file-workbench` would light up the
Tools row and its own row on the same screen.

**The manifest row stays.** The catalogue is not only a listing — contextual surfaces query it by
context tag (`toolsFor("file")`), so a tool absent from it is a tool nothing can offer. The manifest
therefore gains an optional `route`, and `toolRoute()` becomes the one derivation every link-builder
goes through instead of two of them spelling out `/tools/<id>`. Declaring a route is what a tool does
when it has outgrown the area, and it carries one consequence everywhere the area enumerates its
tools: the Tools listing and its navigation column leave the row out, and so does the command
palette's tool provider. The column is the sharpest case — Tools became a two-sided screen, every
row in that column loads BESIDE the column, and a row that replaced the whole screen would be the
one control there that does not behave like the rest. The emptied `files` group falls away with it,
which is correct rather than a gap: the utilities that filled it were the workbench's own tabs, so
the Tools area genuinely has no file tool left to show.

**Consequences:** The workbench's screen header loses its `back="tools"` — a top-level destination
has no way back, the way Discovery and Custodian have none. `FILE_WORKBENCH_BACK` is deleted:
it existed as the spelled-out escape hatch precisely because the workbench was not a destination, and
the recovery job's screen now names the destination id like every other screen.

Two registries in different packages now have to agree on one address, with nothing in the type
system tying them, so `apps/web/test/file-workbench-destination.test.ts` ties them: if either moves,
it fails.

**The ten retire with it.** The manifests for the ten file utilities are deleted. Each was a
capability tab under another name, and keeping them would have kept the catalogue promising ten
screens that do not exist and never will. Two things had to survive them, neither enforced by a type:

- **Their permissions.** Every capability module is gated on the permission its sibling manifest
  declared, and `grantedPermissions()` built its set from `CATALOG`. Deleting the rows would have
  taken all ten keys out of that set and emptied the workbench of every tab, silently. The seam now
  names them, held to the capability registry by a test. The keys themselves, their entries in the
  access-control registry and their `role_permission` seeds are untouched and still used.
- **Their search vocabulary.** A member typing "ocr" or "scrub metadata" reached a row of its own.
  Those words moved onto the workbench's synonyms, so the same search reaches the screen that does
  the work.

What the retirement does NOT do is give each capability a palette row of its own that lands on its
tab. The `?capability=` seam supports it, but deriving those rows means importing the capability
registry into the app shell, and every capability module imports a Lucide icon — ten Svelte
components plus the conversion format graph, in the chunk the shell loads, to serve search. The
established way around that in this codebase is a hand-written list held to the registry by a test
(`tool-permissions.ts` does it twice), so the cost is avoidable rather than fixed.

It is left undone because it is a judgement about how many rows a search should show, made
immediately after a ruling to show fewer, and that is the owner's call rather than a detail of this
one. Three capabilities are served today — File Type, Hash and Unlock — so the value is real and
not hypothetical: someone searching "checksum" or "pdf password" would land on a tab that works.
The remaining seven render the standard pending treatment. Worth putting to the owner as its own
question.
