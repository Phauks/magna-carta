import io

p = "docs/specs/2026-07-09-network-speed-test-implementation-plan.md"
s = io.open(p, encoding="utf-8").read()
anchor = "### Task 6: Documentation (definition of done)"
assert anchor in s, "anchor missing"
assert "### Task 24" not in s, "Task 24 already present"

EM = "—"

task = """### Task 24: One marker for absence, in one place, easy to change

Owner: the page shows `N/A` in some places and "Not measured yet." in others. Use one. `N/A` may not have been the right choice — a plain hyphen `-` (never an em dash) is probably better — and it must be easy to change again later.

**What went wrong.** I split absence into two vocabularies — a marker for value slots, a sentence for prose — and called it a principle. It is not: it is two ways to say one thing, and `quality-scores.svelte` renders **both, stacked** (`N/A` above "Not measured yet."). The page should say a measurement is missing exactly one way.

**The design that makes the next change a one-line edit.**

1. Absence gets **its own module**, not a corner of the number formatter. `speed-test-format.ts` formats numbers; whether a thing was measured is not a number format.
2. **One visible marker**, exported once. Changing `-` to `N/A` or anything else is editing one line.
3. **One accessible description**, separate and deliberately different. A screen reader must hear a word, not a hyphen: `aria-label="Download: not measured"` is right, `aria-label="Download: -"` is useless. That is the same fact in another medium, not a second vocabulary, and it appears only inside `aria-*` attributes.
4. **A fitness test forbids the literals**, so nobody can hand-write `N/A`, `Not measured yet.`, or an em dash again.

**What must not regress:** a measured zero is a result. `formatRatio(0)` is `0%`; `formatRatio(undefined)` is the marker. Every value's line box must survive — the marker has content, so that is free — but do not remove the guards protecting rows that can still be genuinely empty (the progress panel's counter row).

**Files:**
- Create: `apps/web/src/lib/tools/speed-test/absence.ts`
- Create: `apps/web/test/absence.test.ts`
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts` (consume the marker; delete `ABSENT` and `NOT_MEASURED_YET`)
- Modify: `quality-scores.svelte`, `server-panel.svelte`, `bandwidth-chart.svelte`, `latency-chart.svelte`, `metric-tile.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

**Depends on Task 22.** Do it after.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/absence.test.ts`. It asserts the marker and its spoken form, and then **sweeps the tool directory** for any other way of saying a measurement is missing.

The sweep must prove it actually read files — a sweep that silently matches nothing is worse than no test. Assert that it found a non-zero number of files before asserting there are no offenders. Resolve the directory from `import.meta.dirname` rather than assuming the process working directory.

Banned literals, anywhere under `src/lib/tools/speed-test/` except `absence.ts`: `N/A`, `Not measured yet`, and the em-dash character.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test absence`
Expected: FAIL — `absence.ts` does not exist; and once it does, the sweep still finds the old literals across the tool.

- [ ] **Step 3: Give absence a home**

Create `apps/web/src/lib/tools/speed-test/absence.ts`:

```ts
/*
 * How this tool says a measurement was not taken.
 *
 * ONE marker, in ONE place. It has been an em dash (which said nothing twice, once the page also had
 * a sentence for absence), then nothing (which read as broken), then "N/A", and now a plain hyphen.
 * Every one of those changes should have been a single edit. Now it is.
 *
 * The spoken form is separate on purpose. A screen reader announcing "Download: hyphen" tells a
 * person nothing; it must hear a word. That is the same fact in a different medium, not a second
 * vocabulary, and it belongs only in `aria-*` attributes, never on screen.
 *
 * Nothing here may ever become "0". A measured zero is a result: packet loss of exactly 0% is the
 * best possible reading, and must never be confused with a measurement that did not happen.
 */

/** Shown wherever a measurement is missing. Change this line, change the page. */
export const ABSENT_MARKER = "-";

/** Announced wherever a measurement is missing. Only ever used inside `aria-*`. */
export const ABSENT_DESCRIPTION = "not measured";
```

- [ ] **Step 4: Make every site consume it**

- `speed-test-format.ts`: import `ABSENT_MARKER` and return it from `formatBandwidth`, `formatMilliseconds`, and `formatRatio`. **Delete `ABSENT` and `NOT_MEASURED_YET`.** Update the module comment: it formats numbers; absence lives elsewhere now.
- `quality-scores.svelte`: the placeholder renders the marker **once**, as the rating. The points line beneath renders a non-breaking space so the row keeps its height — it does not repeat the marker, and it carries no sentence.
- `server-panel.svelte`: when `probe === null`, render the same labelled round-trip row that the reachable branch renders, with the marker as its value — not a standalone sentence. **Leave the `unauthenticated`, `forbidden`, and `unreachable` branches exactly as they are.** Those say *why not*, which is actionable, and they are not absence.
- `bandwidth-chart.svelte` and `latency-chart.svelte`: the empty state renders the marker where the marks would be. Their `aria-label` uses `ABSENT_DESCRIPTION`.
- `metric-tile.svelte`: a `note` with nothing to say renders a non-breaking space, so a tile's height never depends on whether it has a note.
- The page: the packet-loss tile's idle branch passes no note text — the marker in the value slot already says it — while the `forbidden`, `unauthenticated`, and `not-configured` branches keep their specific notes.

- [ ] **Step 5: Run the tests**

Run: `vp test absence speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS, and the sweep finds no offenders.

- [ ] **Step 6: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Then confirm the old names are gone everywhere:

```bash
grep -rn "NOT_MEASURED_YET" apps/web/src
grep -rn "ABSENT" apps/web/src | grep -v absence.ts
```

Both must return nothing. Report the output.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/lib/tools/speed-test apps/web/test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): one marker for absence, in one place"
```

---

"""

s = s.replace(anchor, task + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("Task 24 added; em-dash char used nowhere in the task body:", EM not in task)
