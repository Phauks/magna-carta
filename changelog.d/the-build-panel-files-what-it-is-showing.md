---
category: Changed
audience: internal
---

**The header's Build Information panel now says what it knows in one grammar, files what it is
showing, links what it names, and reports what a probe cost.** Its paste, the issue reporter's trace
and the panel's four sections were each built by hand; they are now one report model, one section
component and one registry apiece.

**One grammar for every diagnosis in the app.** `$lib/diagnostics/diagnostic-report.ts` owns the
shape — a row is `key: value`, a group indents under its heading — and both the issue reporter's
trace and the panel's paste render through it. They had invented their own formats independently
(`key: value` against `Label: commit · committed …`), so a reader who received both parsed two
documents; and each carried what the other lacked, the trace all the browser facts and none of the
fleet, the paste the reverse. The trace's output is byte-for-byte what it was — its own test pins
every line — and it now shares its environment block with the panel.

**A failed read is in the paste, which is the case the copy control exists for.** The panel's copy
was a single function inside the deployment model, which could not import the database or the
readiness models without a cycle, so both reached it as one pre-joined opaque string — and a section
whose value was `null` vanished silently. Somebody looking at "The version read failed · Error ID
error\_…" copied a report that never mentioned it. The assembly is now a list of contributors over one
state object (`$lib/versions/panel-report.ts`): each owns a section, states its own failure with its
Error ID, and returns null when it has nothing. A fifth section appends one function instead of
gaining a sixth parameter.

**A refused clipboard says so.** The three copy paths each called `navigator.clipboard.writeText`
inside a `catch { return }`, so on an insecure origin or under a managed-browser policy the control
did nothing at all and said nothing at all — and the fallback that works in exactly those cases
already existed in the design system. All three now go through `copyText`, which falls back to the
selection route and reports which happened; a copy that did not happen puts a line on the panel.

**Four hand-written sections became one component.** `version-panel-section.svelte` owns the heading,
the fold, the failure block and the loading region; each section still decides its own name, pills,
skeleton, failure sentence and rows. The wording had already started to drift between the four
copies. The folds are a registry too, keyed by section id — the fourth section had arrived without
the doc comment the other three carried and without the file's own header sentence being updated.

**Rows link to the things they name.** A Worker's name links to its Cloudflare dashboard page through
the account-agnostic `?to=/:account/…` form, so the link embeds no account identifier and works for
every member of the account. A commit links to the commit, on the parts a reader actually reads a
diff for — this build, the API, and the Worker serving this page — and the Update Available block
links to the diff between the running bundle and the one being served. Nothing is linked that cannot
be verified: a placeholder commit or an unresolved repository renders as plain text. The repository is
resolved at build time from the git remote (`resolveRepositoryUrl` in the shared commit-identity
script), so a fork links to itself.

**`GET /api/v1/meta/versions` reports what each probe cost.** The number was being paid for and thrown
away. Every probe is raced against a fixed timeout, so "reported" and "unreachable" are two ends of
one measurement with nothing between them — a Worker answering just inside the timeout read as
perfectly healthy until it flipped. Rows carry their latency and a slow one is marked.

**The panel can file what it is showing.** Report an Issue opens the same dialog every other surface
uses, carrying the panel's whole diagnosis; `POST /api/v1/incidents` accepts it as a bounded,
optional `context.deployment`, redacted by construction like every other field there. Previously the
only route was copy, close, find the profile menu, paste — four steps during an incident, each of
which can lose the paste.

**The panel is reachable from search, and so is the next tool of its shape.** The command palette
renders registries and never hand-lists an item, but every registry it had described a
_destination_ with an href. A surface that opens in place had no registry to join, so
`$lib/developer/diagnostic-actions.ts` is the one for that shape — an id, a label, the words it
should be findable by, whether this build offers it, and the function that runs. The panel's open
state moved out of the component (`build-panel.svelte.ts`) so a registry entry can reach it.

**The chip says which build mode it is, outside production.** Two screenshots of one commit, one from
a preview deploy and one from the real site, were indistinguishable.

**And the panel is finally tested in a browser.** Its component rules are asserted by regex over its
source, because the node pool cannot mount a design-system component — the right trade for what those
rules pin, and unable to tell you the panel opens at all. `e2e/build-panel.spec.ts` drives the real
thing: the sections settle, a fold survives a reload, the palette opens it, and a signed-out panel
issues no authenticated request.

**Merged onto the report extraction, not around it.** `main` split the panel into a shared
`version-report.svelte` rendered by both the chip and the new Settings · Versions page while this
branch was open. Everything above is applied to that component, so the page gets all of it too: the
same paste, the same links, the same latency, the same failure blocks. The chip keeps what is the
chip's — the build environment badge, and the popover state the palette opens. One regression from
that extraction is repaired on the way past: the health row had lost its `badgeVariant` passthrough,
so a readiness check reading "Not applicable" was rendering green rather than neutral.
