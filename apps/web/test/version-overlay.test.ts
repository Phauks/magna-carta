/*
 * The version overlay's honesty rules, exercised on the pure model: every non-answer keeps its
 * own name, a cached observation states its age once it
 * has one, a re-ask that fails never leaves its rows looking current, and a copied identifier line
 * carries only what was actually known.
 *
 * The deployed-unit names are pinned to the things that deploy them rather than to this file's
 * word: the API's service roster, the app Worker's own service bindings, and the fleet itself
 * (every wrangler.jsonc under apps/) are read off disk. A rostered name that does not match what
 * its binding targets, or a fleet worker the roster forgot, fails.
 *
 * The scope rules are asserted twice over. The decision itself is a pure function and is tested as
 * one; that the component actually obeys it is read off the component's source, because this
 * project's tests run in a plain node pool and rendering a design-system component pulls bits-ui,
 * which a deliberate boundary gate keeps out of every config outside the design system
 * (packages/design-system/test/fitness/boundaries.test.ts). What matters most is negative — that a
 * signed-out panel issues no authenticated request at all — and a source assertion states it for
 * every path into the call rather than only the one a render happened to exercise.
 *
 * The source read is version-report.svelte: the body the chip's popover and the Versions settings
 * page both render. The chip itself keeps only the trigger, and the one assertion about the
 * trigger reads the chip.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiWebSyncState,
  copyLineForPart,
  countPill,
  deploymentSectionPills,
  workersSectionPills,
  describeObservationAge,
  describeRetainedRows,
  findWebWorkerRow,
  formatVersionTimestamp,
  isRealCommit,
  partitionDeploymentRows,
  readsServiceAggregate,
  serviceStateDescription,
  serviceStateLabel,
  showsPageBuildRow,
  syncStateBadgeVariant,
  syncStateLabel,
  versionChipLabel,
  API_WORKER_UNIT_NAME,
  FLEET_SECTION_LABEL,
  PAGE_BUILD_ROW_NAME,
  READ_IN_FLIGHT_NOTICE,
  RELOAD_ACTION_LABEL,
  SIGNED_OUT_ESTATE_NOTICE,
  UPDATE_AVAILABLE_EXPLANATION,
  WEB_WORKER_ROW_ID,
  type ServiceVersionRow,
  type ServiceVersionState,
} from "../src/lib/versions/version-overlay-model.ts";

/** A service row with everything but the fields a case is actually about held constant. */
function serviceRow(
  id: string,
  state: ServiceVersionState = "reported",
  commit: string | null = "a1b2c3d",
): ServiceVersionRow {
  return {
    id,
    service: `magna-carta-${id}`,
    state,
    commit: state === "reported" ? commit : null,
    commitTime: null,
    buildTime: null,
    latencyMilliseconds: null,
  };
}

const SOURCE_ROOT = join(import.meta.dirname, "../src");
const REPOSITORY_ROOT = join(import.meta.dirname, "../../..");

function source(relativePath: string): string {
  return readFileSync(join(SOURCE_ROOT, relativePath), "utf8");
}

function repositoryFile(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), "utf8");
}

/** Strip comment prose so a sweep reads only what the component does, never what it explains. */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/**
 * How many `{#if}`/`{#each}` blocks are still open at a point in a template. Zero means the markup
 * there renders unconditionally, which is the only way to assert "this row is not inside a branch"
 * without pinning the exact shape of the branches around it.
 */
function openBlockDepthAt(template: string, index: number): number {
  const before = template.slice(0, index);
  const opened = (before.match(/\{#(?:if|each)\b/g) ?? []).length;
  const closed = (before.match(/\{\/(?:if|each)\}/g) ?? []).length;
  return opened - closed;
}

describe("what counts as a real commit", () => {
  it("accepts a short hash and rejects every honest placeholder", () => {
    expect(isRealCommit("f4b6d82")).toBe(true);
    expect(isRealCommit("dev")).toBe(false);
    expect(isRealCommit("unknown")).toBe(false);
    expect(isRealCommit("")).toBe(false);
    expect(isRealCommit(null)).toBe(false);
  });

  it("the chip shows the commit, or dev when the build has no identity", () => {
    expect(versionChipLabel("f4b6d82")).toBe("f4b6d82");
    expect(versionChipLabel("unknown")).toBe("dev");
    expect(versionChipLabel("dev")).toBe("dev");
  });
});

describe("the API-versus-web sync badge", () => {
  it("the panel raises no fixed alarm sentence about the pair differing", () => {
    // A fixed "Different Builds" sentence read every difference as one alarm, which is wrong: the
    // two Workers deploy separately, so differing is a normal state most of the time. The colour
    // (syncStateBadgeVariant) carries that judgement now, not a standing sentence.
    const chip = stripComments(source("lib/versions/version-report.svelte"));
    const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
    expect(chip).not.toContain("Different Builds");
    expect(chip).not.toContain("buildsDiffer");
  });

  it("reads in-sync only when the commits actually match", () => {
    const api = { commit: "a1b2c3d", commitTime: "2026-08-29T10:00:00Z" };
    expect(apiWebSyncState(api, serviceRow(WEB_WORKER_ROW_ID, "reported", "a1b2c3d"))).toBe(
      "in-sync",
    );
  });

  it("calls it web-behind only when the web commit time is provably earlier", () => {
    const api = { commit: "a1b2c3d", commitTime: "2026-08-29T12:00:00Z" };
    const webRow = serviceRow(WEB_WORKER_ROW_ID, "reported", "9f9f9f9");
    expect(apiWebSyncState(api, { ...webRow, commitTime: "2026-08-29T10:00:00Z" })).toBe(
      "web-behind",
    );
  });

  it("falls back to the calmer mismatch bucket when direction cannot be proven", () => {
    const api = { commit: "a1b2c3d", commitTime: "2026-08-29T10:00:00Z" };
    // No timestamp on either side to compare.
    expect(apiWebSyncState(api, serviceRow(WEB_WORKER_ROW_ID, "reported", "9f9f9f9"))).toBe(
      "mismatch",
    );
    // The web build is the newer one, not the one behind.
    const webRow = serviceRow(WEB_WORKER_ROW_ID, "reported", "9f9f9f9");
    expect(apiWebSyncState(api, { ...webRow, commitTime: "2026-08-29T14:00:00Z" })).toBe(
      "mismatch",
    );
  });

  it("shows no badge at all when either side has nothing real to compare", () => {
    const devApi = { commit: "dev", commitTime: null };
    const realApi = { commit: "a1b2c3d", commitTime: null };
    expect(apiWebSyncState(devApi, serviceRow(WEB_WORKER_ROW_ID))).toBeNull();
    expect(apiWebSyncState(realApi, null)).toBeNull();
    expect(apiWebSyncState(realApi, serviceRow(WEB_WORKER_ROW_ID, "unreachable"))).toBeNull();
  });

  it("keeps the colour calm except for the one actionable state", () => {
    expect(syncStateBadgeVariant("in-sync")).toBe("success");
    expect(syncStateBadgeVariant("web-behind")).toBe("warning");
    expect(syncStateBadgeVariant("mismatch")).toBe("neutral");
  });

  it("labels every state in words, none of them an alarm", () => {
    expect(syncStateLabel("in-sync")).toBe("In sync");
    expect(syncStateLabel("web-behind")).toBe("Web behind");
    expect(syncStateLabel("mismatch")).toBe("Different builds");
    for (const state of ["in-sync", "web-behind", "mismatch"] as const) {
      expect(syncStateLabel(state)).not.toMatch(/fail|error|alarm/i);
    }
  });
});

describe("the honest non-answers", () => {
  it("each state keeps its own name and a reported row carries none", () => {
    expect(serviceStateLabel("reported")).toBeNull();
    expect(serviceStateLabel("unbound")).toBe("Not deployed");
    expect(serviceStateLabel("unreachable")).toBe("Unreachable");
    expect(serviceStateLabel("unreported")).toBe("Not reporting");
  });

  it("each non-answer says which fact it is, so the three do not read as one outage", () => {
    expect(serviceStateDescription("reported")).toBeNull();
    const descriptions = (["unbound", "unreachable", "unreported"] as const).map((state) =>
      serviceStateDescription(state),
    );
    for (const description of descriptions) {
      expect(description).not.toBeNull();
      // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
      expect(description).not.toContain("—");
    }
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("a service this deployment never had is not described as a failure", () => {
    expect(serviceStateDescription("unbound")).not.toMatch(/fail|error|unreachable|down/i);
  });

  it("a service too old to answer is described as answering, not as absent", () => {
    const description = serviceStateDescription("unreported") ?? "";
    expect(description).toMatch(/answer/i);
    expect(description).toMatch(/build/i);
  });
});

describe("the deployed unit a row names", () => {
  /*
   * The roster the API actually probes, the service bindings the app Worker actually declares, and
   * the fleet on disk. All three are read here so a name can only be right by matching the thing
   * that deploys it — and so a worker added under apps/ cannot silently stay off the overlay.
   */
  const rosterSource = repositoryFile("apps/api-worker/src/http/routes/platform/meta-versions.ts");
  const rosterEntries = [
    ...rosterSource.matchAll(
      /\{ id: "(?<id>\w+)", service: "(?<service>[\w-]+)", binding: "(?<binding>\w+)" \}/g,
    ),
  ].map((match) => match.groups as unknown as { id: string; service: string; binding: string });

  const wranglerSource = repositoryFile("apps/api-worker/wrangler.jsonc");
  const boundScriptNames = new Map(
    [
      ...wranglerSource.matchAll(
        /\{ "binding": "(?<binding>\w+)", "service": "(?<service>[\w-]+)" \}/g,
      ),
    ].map((match) => [match.groups?.binding ?? "", match.groups?.service ?? ""]),
  );

  it("reads a roster and a binding table rather than trusting this file", () => {
    expect(rosterEntries.length).toBeGreaterThan(0);
    expect(boundScriptNames.size).toBeGreaterThan(0);
  });

  it("rosters the whole fleet: every deployed worker name under apps/, and nothing else", () => {
    // The overlay's promise is "every magna-carta worker is on this list" — a worker missing from
    // it reads as "everything is listed and healthy". So the roster is pinned to the fleet on
    // disk: each apps/*/wrangler.jsonc names its worker, and every one except the app Worker
    // itself (the prober, whose identity is the aggregate's own `api` object) must be rostered.
    const appsDirectory = join(REPOSITORY_ROOT, "apps");
    const fleet = readdirSync(appsDirectory)
      .map((entry) => {
        try {
          return readFileSync(join(appsDirectory, entry, "wrangler.jsonc"), "utf8");
        } catch {
          return null;
        }
      })
      .filter((config): config is string => config !== null)
      .map((config) => /"name":\s*"(?<name>[\w-]+)"/.exec(config)?.groups?.name ?? "")
      .filter((name) => name !== "" && name !== API_WORKER_UNIT_NAME)
      .toSorted();
    expect(fleet.length).toBeGreaterThan(0);
    expect(rosterEntries.map((entry) => entry.service).toSorted()).toEqual(fleet);
  });

  it("names each bound service exactly as its service binding targets it", () => {
    for (const entry of rosterEntries) {
      const boundName = boundScriptNames.get(entry.binding);
      if (boundName === undefined) continue;
      expect(entry.service, entry.id).toBe(boundName);
    }
  });

  it("names the API Worker, which still carries the SPA copy that backs dev and rollback", () => {
    expect(API_WORKER_UNIT_NAME).toBe("magna-carta");
    expect(wranglerSource).toContain(`"name": "${API_WORKER_UNIT_NAME}"`);
    // The assets block deliberately SURVIVES the cutover to magna-carta-web: `wrangler dev` and
    // the e2e suite serve the whole app from it, and it is the one-gesture rollback (repoint the
    // /* route back here). If it is ever removed, this test is the reminder that both of those
    // need a replacement first.
    expect(wranglerSource).toMatch(/"assets":\s*\{[\s\S]*?"directory":\s*"\.\.\/web\/build"/);
  });

  it("the build line is named for the bundle in this tab, never for the Worker that served it", () => {
    expect(PAGE_BUILD_ROW_NAME).toBe("This page");
    expect(PAGE_BUILD_ROW_NAME).not.toContain("magna-carta");
  });
});

describe("the observation's age", () => {
  const observedAt = "2026-08-29T12:00:00.000Z";

  it("stays silent while fresh", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 4000)).toBeNull();
  });

  it("speaks in seconds once the cache could be showing", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 40_000)).toBe(
      "checked 40 seconds ago",
    );
  });

  it("rolls over to minutes for an old observation", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 120_000)).toBe(
      "checked 2 minutes ago",
    );
  });

  it("says nothing about a timestamp it cannot parse", () => {
    expect(describeObservationAge("not a timestamp", Date.now())).toBeNull();
  });
});

describe("rows a failed re-ask left behind", () => {
  const observedAt = "2026-08-29T12:00:00.000Z";

  it("states their age even inside the window where the header line stays quiet", () => {
    // This is the whole point: a refresh that fails two seconds after a good read must not leave
    // rows reading as current just because the age line considers them fresh.
    expect(describeRetainedRows(observedAt, Date.parse(observedAt) + 2000)).toBe(
      "The rows below are from the last read that answered, a moment ago.",
    );
  });

  it("ages in seconds and then in minutes, like the header line", () => {
    expect(describeRetainedRows(observedAt, Date.parse(observedAt) + 40_000)).toContain(
      "40 seconds ago",
    );
    expect(describeRetainedRows(observedAt, Date.parse(observedAt) + 120_000)).toContain(
      "2 minutes ago",
    );
  });

  it("still says the rows are the older read's when it cannot date them", () => {
    const sentence = describeRetainedRows("not a timestamp", Date.now());
    expect(sentence).toMatch(/last read that answered/);
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(sentence).not.toContain("—");
  });
});

describe("the copied identifier line", () => {
  it("carries the part, the commit, and both timestamps when known", () => {
    expect(
      copyLineForPart({
        label: "magna-carta-scan",
        commit: "a1b2c3d",
        commitTime: "2026-08-29T10:00:00Z",
        buildTime: "2026-08-29T10:05:00Z",
      }),
    ).toBe(
      "magna-carta-scan: a1b2c3d · committed 2026-08-29T10:00:00Z · built 2026-08-29T10:05:00Z",
    );
  });

  it("omits what was not known instead of inventing it", () => {
    expect(
      copyLineForPart({ label: "magna-carta", commit: "dev", commitTime: null, buildTime: null }),
    ).toBe("magna-carta: dev");
  });
});

describe("what each scope is allowed to read", () => {
  it("only a session may read the aggregate", () => {
    expect(readsServiceAggregate("app")).toBe(true);
    expect(readsServiceAggregate("public")).toBe(false);
  });

  it("the signed-out line names the boundary rather than implying a fault", () => {
    expect(SIGNED_OUT_ESTATE_NOTICE).toContain("signed in");
    expect(SIGNED_OUT_ESTATE_NOTICE).not.toMatch(/fail|error|unavailable|unreachable/i);
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(SIGNED_OUT_ESTATE_NOTICE).not.toContain("—");
  });
});

describe("the chip in its public scope", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));

  it("reads each authenticated aggregate from exactly one place, and refuses the public scope", () => {
    // Two reads now — the version aggregate and the database health — and each has ONE call site
    // that guards on the scope before it touches the network. A second call site for either is how
    // a signed-out panel starts making authenticated requests nobody remembered to guard.
    const calls = chip.match(/requestJson</g) ?? [];
    expect(calls).toHaveLength(2);
    for (const name of ["refresh", "refreshHealth"]) {
      const body =
        new RegExp(`async function ${name}\\([^)]*\\): Promise<void> \\{([\\s\\S]*?)\\n  \\}`).exec(
          chip,
        )?.[1] ?? "";
      expect(body).toContain("if (!readsAggregate) return;");
      // The guard precedes the call, so no path through the function reaches the network first.
      expect(body.indexOf("if (!readsAggregate) return;")).toBeLessThan(
        body.indexOf("requestJson<"),
      );
      expect(body.match(/requestJson</g) ?? []).toHaveLength(1);
    }
  });

  it("never opens the read on a public panel, however the panel was opened", () => {
    // The report reads only while its host says it is on screen. The chip's popover state moved out
    // of the chip (build-panel.svelte.ts) so the command palette can open it, and arrives here as
    // the `open` prop; the guard reads the same thing it always did.
    expect(chip).toContain("if (!open || !readsAggregate) return;");
  });

  it("shows this build's own identity from the baked-in stamp, never from the network", () => {
    const pageRow = /\{@render partRow\(\{\s*rowKey: "page",[\s\S]*?\}\)\}/.exec(chip);
    expect(pageRow).not.toBeNull();
    expect(pageRow?.[0]).toContain("BUILD_IDENTITY.committedAt");
    expect(pageRow?.[0]).toContain("BUILD_IDENTITY.builtAt");
  });

  it("keeps the build line on the signed-out panel, where nothing else can state it", () => {
    // The aggregate is not readable here, so this row is the only version the panel has.
    expect(showsPageBuildRow({ readsAggregate: false, read: "pending", webRow: null })).toBe(true);
    expect(showsPageBuildRow({ readsAggregate: false, read: "failed", webRow: null })).toBe(true);
    expect(
      showsPageBuildRow({
        readsAggregate: false,
        read: "answered",
        webRow: serviceRow(WEB_WORKER_ROW_ID),
      }),
    ).toBe(true);
  });

  it("keeps the aggregate's own rows inside the scope that may read them", () => {
    expect(openBlockDepthAt(chip, chip.indexOf('rowKey: "api"'))).toBeGreaterThan(0);
    expect(chip).toMatch(/\{#if readsAggregate\}[\s\S]*rowKey: "api"/);
  });

  it("explains a non-answering row instead of leaving a bare badge", () => {
    // The badge alone cannot separate "no such service here" from "not answering" from
    // "answering, but older than the question", and the owner read all three as an outage. Naming
    // the Worker is additional to that sentence, never a replacement for it.
    expect(chip).toContain("serviceStateDescription(part.state)");
    expect(chip).toContain("serviceStateLabel(part.state)");
  });

  it("says out loud what the public panel is not showing", () => {
    expect(chip).toMatch(/\{:else\}[\s\S]*SIGNED_OUT_ESTATE_NOTICE[\s\S]*\{\/if\}/);
  });
});

describe("the chip's row identities and refresh", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));

  it("heads every row with one name and nothing else, monospaced only when it is a Worker's", () => {
    expect(chip).toContain("{part.name}</span");
    // Monospace is the identifier signal: a Worker's name carries it, the build line does not.
    expect(chip).toMatch(/part\.isWorkerName\s*\? "font-mono text-sm text-text-default"/);
    // No second line of invented naming: the detail under a name is its timestamps or its state
    // sentence, never a description of what the worker is for.
    expect(chip).not.toContain("part.description");
  });

  it("takes each deployment row's name from the wire itself", () => {
    expect(chip).toMatch(/name: service\.service/);
    // No sibling's name is written into the component: the API's roster is the one home for them.
    expect(chip).not.toMatch(/"magna-carta-[a-z-]+"/);
  });

  it("leads with the pair that serves the app's address, then the fleet below a separator", () => {
    expect(chip).toMatch(/rowKey: "page",\s*name: PAGE_BUILD_ROW_NAME/);
    expect(chip).toMatch(/rowKey: "api",\s*name: API_WORKER_UNIT_NAME/);
    expect(chip).toContain("partitionDeploymentRows(value.services)");
    expect(chip).toContain("syncStateLabel(syncState)");
    // Order: magna-carta, then magna-carta-web (the front partition), then the sync badge that
    // reads the pair, then the separator, then the rest of the fleet.
    // Read the MARKUP alone: the script derives the same split for the headings' counts, and a
    // whole-file search finds that declaration long before the rows it is asserting the order of.
    const markup = chip.slice(chip.indexOf("</script>"));
    expect(markup.indexOf('rowKey: "api"')).toBeLessThan(markup.indexOf("deploymentRows.front"));
    expect(markup.indexOf("deploymentRows.front")).toBeLessThan(
      markup.indexOf("syncStateLabel(syncState)"),
    );
    expect(markup.indexOf("syncStateLabel(syncState)")).toBeLessThan(
      markup.indexOf("deploymentRows.rest"),
    );
  });

  it("shows the sync badge only when there is a real commit on both sides to compare", () => {
    expect(chip).toMatch(/\{#if syncState !== null\}[\s\S]*syncStateLabel\(syncState\)/);
  });

  it("splits the deployment rows so the interface Worker leads and nothing is dropped", () => {
    const { front, rest } = partitionDeploymentRows([
      serviceRow("bundle"),
      serviceRow(WEB_WORKER_ROW_ID),
      serviceRow("scan"),
    ]);
    expect(front.map((row) => row.id)).toEqual([WEB_WORKER_ROW_ID]);
    expect(rest.map((row) => row.id)).toEqual(["bundle", "scan"]);
  });

  it("confirms a copy by filling the control, not by growing a glyph inside it", () => {
    // Owner rulings 2026-08-31: no copy glyph on the control, and no check appearing on a
    // successful copy either. A glyph arriving beside the commit widened the button every time
    // it was pressed, and the width change read as the identifier itself changing; the control
    // takes the selected fill for a moment instead, which moves nothing. The aria-label keeps
    // stating the action for a screen reader.
    // Read off the ROW's control rather than the whole file. The panel-wide Copy at the top is an
    // icon-only button and always has been — it has nothing but a glyph — so a file-wide ban on the
    // copy glyph was only ever true by accident of which Lucide name that control happened to
    // import, and it fired the day that control took the conventional two-sheets glyph.
    const rowCopyControl =
      /<Button[^>]*aria-label="Copy the \{part\.name\} version"[\s\S]*?<\/Button>/.exec(
        chip,
      )?.[0] ?? "";
    expect(rowCopyControl, "the row's copy control should be one Button").not.toBe("");
    expect(rowCopyControl).not.toMatch(/<(?:Copy|ClipboardCopy|Check)\b/);
    expect(chip).not.toContain("icons/check");
    // A step beyond ghost's own hover fill: whoever just clicked the control is hovering it, so a
    // confirmation painted in the hover colour would be invisible exactly when it is needed.
    expect(chip).toMatch(/copiedNow\(part\.rowKey\)[\s\S]*bg-action-secondary-hover/);
    // "for a second" — the fill clears on its own, and only for the control that was pressed.
    expect(chip).toMatch(/copyOutcome\?\.key === key && copyOutcome\.result === "copied"/);
    expect(chip).toMatch(/result === "copied" \? 1000 : 6000/);
  });

  it("offers one refresh that re-runs both reads and is inert while either is in flight", () => {
    // One control for one panel: a reader pressing Refresh asked the panel to say what is true
    // now, not to re-ask whichever half they happened to be looking at.
    const refreshControl = /<Button[^>]*aria-label="Refresh the panel"[\s\S]*?<\/Button>/.exec(
      chip,
    );
    expect(refreshControl).not.toBeNull();
    const control = refreshControl?.[0] ?? "";
    expect(control).toContain("disabled={loading || healthLoading || readinessLoading}");
    expect(control).toContain("onclick={refreshEverything}");
    // Inert is said by `disabled` alone. This once also demanded a hand-written aria-busy, which
    // the later ruling that every loading state runs through one region forbids outright
    // (tooling/lint-one-ui) — a region announces the read, a control does not announce itself. The
    // two rules contradicted each other and this test was the older one.
    expect(control).not.toContain("aria-busy");
    // The three reads are one named gesture rather than three inline calls, because the panel now
    // runs the same gesture from more than one place; that it is still ALL THREE is asserted on the
    // function itself.
    const everything =
      /function refreshEverything\(\): void \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    expect(everything).toContain("refresh({ fresh: true })");
    expect(everything).toContain("refreshHealth()");
    expect(everything).toContain("refreshReadiness()");
  });

  it("the explicit gestures probe fresh; the automatic on-open read takes the cached path", () => {
    // Refresh and Retry both answer a member who asked what is running NOW, so both skip the
    // API's brief cache — otherwise the age line keeps climbing and the button reads as broken.
    // The on-open read is the one the cache exists for, and it stays plain.
    // Every gesture a PERSON makes probes fresh; the only plain re-ask is the automatic on-open
    // read in the script. Counting the gestures instead pinned the panel's control layout — adding
    // a section with a Retry of its own broke this while every gesture still obeyed the rule.
    const markup = chip.slice(chip.indexOf("</script>"));
    const gestures = markup.match(/refresh\((?:\{ fresh: true \})?\)/g) ?? [];
    expect(gestures.length).toBeGreaterThan(0);
    expect(gestures.every((gesture) => gesture === "refresh({ fresh: true })")).toBe(true);
    expect(chip.slice(0, chip.indexOf("</script>"))).toContain("void refresh();");
    expect(chip).toContain("?fresh=true");
  });

  it("shows the read in flight, and never a stale age line while it is", () => {
    // The in-flight word says a read is happening; it is not a second failure message.
    expect(READ_IN_FLIGHT_NOTICE).toMatch(/check/i);
    expect(READ_IN_FLIGHT_NOTICE).not.toMatch(/fail|error|unavailable/i);
    expect(chip).toMatch(
      /\{#if loading\}[\s\S]*READ_IN_FLIGHT_NOTICE[\s\S]*\{:else if observationAge/,
    );
  });

  it("marks the read in flight around the call itself, not around the panel", () => {
    const body =
      /async function refresh\([^)]*\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    expect(body.indexOf("loading = true;")).toBeLessThan(body.indexOf("requestJson<"));
    expect(body.indexOf("requestJson<")).toBeLessThan(body.indexOf("loading = false;"));
  });

  it("keeps the rows a failed refresh could not replace, and says they are the older read's", () => {
    const body =
      /async function refresh\([^)]*\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    // Blanking the rows would trade a stale answer for no answer; the sentence is what keeps the
    // retained rows from reading as current.
    expect(body).not.toContain("value = null");
    expect(chip).toContain("describeRetainedRows(value.observedAt, nowEpochMilliseconds)");
    expect(chip).toContain("{retainedRows}");
  });

  it("still surfaces the Error ID on a failure, above the rows it could not refresh", () => {
    expect(chip).toContain("Error ID:");
    expect(chip).toContain("failure.problem.errorId");
    expect(chip.indexOf("Error ID:")).toBeLessThan(chip.indexOf('rowKey: "page"'));
  });
});

describe("the retired duplicate of magna-carta-web", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));

  it("drops the build line once the Worker that serves this page reports", () => {
    /*
     * Owner ruling 2026-08-31: the standing "This page / committed … · built …" row duplicated
     * magna-carta-web. That Worker serves the interface, so its commit and timestamps ARE this
     * page's, said once under a name someone can act on.
     */
    expect(
      showsPageBuildRow({
        readsAggregate: true,
        read: "answered",
        webRow: serviceRow(WEB_WORKER_ROW_ID),
      }),
    ).toBe(false);
  });

  it("brings it back whenever nothing else can state this build", () => {
    // A silent web row is a row with no commit on it, so dropping the build line as well would
    // leave the panel reporting no version at all.
    for (const state of ["unbound", "unreachable", "unreported"] as const) {
      expect(
        showsPageBuildRow({
          readsAggregate: true,
          read: "answered",
          webRow: serviceRow(WEB_WORKER_ROW_ID, state),
        }),
        state,
      ).toBe(true);
    }
    // A read that failed, and a roster with no web row in it at all.
    expect(showsPageBuildRow({ readsAggregate: true, read: "failed", webRow: null })).toBe(true);
    expect(showsPageBuildRow({ readsAggregate: true, read: "answered", webRow: null })).toBe(true);
  });

  it("stays away while the first read is still in flight", () => {
    // The skeletons hold that space; a row that appears for a moment and then vanishes when the
    // answer lands reads as a glitch rather than as an answer.
    expect(showsPageBuildRow({ readsAggregate: true, read: "pending", webRow: null })).toBe(false);
  });

  it("finds the web row by the wire's own id, so a rename cannot hide the duplication", () => {
    expect(findWebWorkerRow([serviceRow("scan"), serviceRow(WEB_WORKER_ROW_ID)])?.id).toBe(
      WEB_WORKER_ROW_ID,
    );
    expect(findWebWorkerRow([serviceRow("scan")])).toBeNull();
  });

  it("the component asks the rule rather than rendering the row outright", () => {
    expect(chip).toContain(
      "showsPageBuildRow({ readsAggregate, read: readPhase, webRow: webWorkerRow })",
    );
    expect(chip).toMatch(/\{#if showsOwnBuild\}[\s\S]*rowKey: "page"/);
    // A retained answer still counts as answered: its web row goes on speaking for this build.
    expect(chip).toContain('value !== null ? "answered" : failure !== null ? "failed" : "pending"');
  });
});

describe("the panel header", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
  const header = /<div class="flex flex-col gap-4">([\s\S]*?)\n  <\/div>/.exec(chip)?.[1] ?? "";

  it("puts the services line under the header instead of beside the controls", () => {
    // Owner ruling 2026-08-31. The age line grows and shrinks as the clock ticks, and on the
    // header row that motion pushed the two controls around.
    expect(header).not.toBe("");
    expect(header.indexOf("Build Versions")).toBeLessThan(
      header.indexOf("Services {observationAge}"),
    );
    expect(header.indexOf('aria-label="Refresh the panel"')).toBeLessThan(
      header.indexOf("Services {observationAge}"),
    );
  });

  it("mounts the services line unconditionally, so the panel never resizes as it fills in", () => {
    // Owner ruling 2026-08-31: swapping between "no line", "Checking services", and "Services
    // checked N ago" resized the popover under the reader as the clock crossed the fresh window.
    // The <p> is always mounted for a session that can read the aggregate, and an empty read gets
    // a non-breaking space rather than being left unmounted, so its height never changes.
    expect(header).toMatch(/\{#if readsAggregate\}\s*<p class="text-xs text-text-muted">/);
    expect(header).toMatch(/\{:else\}\s*&nbsp;\s*\{\/if\}\s*<\/p>/);
  });

  it("seats the reload control beside refresh, as a symbol, only when an update is live", () => {
    const reload = /<Button[^>]*aria-label=\{RELOAD_ACTION_LABEL\}[\s\S]*?<\/Button>/.exec(header);
    expect(reload).not.toBeNull();
    expect(reload?.[0]).toContain('size="icon"');
    expect(reload?.[0]).toContain("location.reload()");
    expect(reload?.[0]).toContain("RotateCw");
    // Its own icon, not the refresh glyph: two controls that look identical read as one repeated.
    expect(reload?.[0]).not.toContain("RefreshCw");
    expect(header).toMatch(/\{#if updateAvailable\}[\s\S]*aria-label=\{RELOAD_ACTION_LABEL\}/);
    // Beside refresh, in that order, inside the one controls cluster.
    expect(header.indexOf("aria-label={RELOAD_ACTION_LABEL}")).toBeLessThan(
      header.indexOf('aria-label="Refresh the panel"'),
    );
  });

  it("carries the reload gesture once, so the update callout is words only", () => {
    expect(chip.match(/location\.reload\(\)/g) ?? []).toHaveLength(1);
  });

  it("offers reload in every scope and refresh only where there is an aggregate to re-read", () => {
    // The update poll reads a public asset of this bundle, so a signed-out tab gets stale too.
    expect(header).toMatch(/\{#if readsAggregate\}[\s\S]*aria-label="Refresh the panel"/);
    expect(header.indexOf("aria-label={RELOAD_ACTION_LABEL}")).toBeLessThan(
      header.indexOf("{#if readsAggregate}"),
    );
  });
});

describe("the fleet fold", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
  const panelSection = stripComments(source("lib/versions/version-panel-section.svelte"));
  const preferences = source("lib/versions/version-panel-preferences.svelte.ts");

  it("folds only the Workers beneath the pair that serves the app's address", () => {
    // The fold is the section component's now (version-panel-section.svelte), so what this file
    // decides is WHICH fold each section is handed. Workers takes the fleet's.
    expect(chip).toMatch(
      /label=\{FLEET_SECTION_LABEL\}\s*preference=\{PANEL_SECTION_FOLDS\.fleet\}[\s\S]*deploymentRows\.rest/,
    );
    // The leading pair and its sync badge sit in the section above, which has a fold of its own.
    expect(chip.indexOf("syncStateLabel(syncState)")).toBeLessThan(
      chip.indexOf("PANEL_SECTION_FOLDS.fleet"),
    );
  });

  it("is a disclosure: its own label names it and aria-expanded carries the state", () => {
    // The mechanics live on the one heading COMPONENT every fold in the panel renders through, so a
    // second fold cannot arrive with a different idea of what a disclosure is. It was a snippet
    // inside the panel before, which kept the markup in one place but let each caller invent its own
    // badge — the three had drifted into saying different kinds of thing.
    expect(heading).toContain("aria-expanded={!collapsed}");
    expect(heading).toContain("onclick={toggle}");
    expect(heading).toContain("{label}");
    // Every section hands the heading its fold through the ONE section component, which is what
    // stops a later section from inventing a different idea of what a disclosure is.
    expect(panelSection).toContain("collapsed={preference.collapsed}");
    expect(panelSection).toContain("toggle={() => preference.toggle()}");
    expect(chip).toMatch(
      /label=\{FLEET_SECTION_LABEL\}\s*preference=\{PANEL_SECTION_FOLDS\.fleet\}/,
    );
    expect(FLEET_SECTION_LABEL).toBe("Workers");
  });

  it("turns its caret rather than swapping the glyph, and holds still under reduced motion", () => {
    expect(heading).toContain("icons/chevron-right");
    expect(heading).toMatch(/collapsed\s*\?\s*''\s*:\s*'rotate-90'/);
    expect(heading).toContain("motion-reduce:transition-none");
  });

  it("says the same KIND of thing on all three shut headings: a count, then a status", () => {
    // The three sections each computed their own badge and had drifted. Deployment carried a
    // warning count and dropped the sync read entirely, so folding it hid whether the two Workers
    // serving the app agree. Workers carried that same warning with no sense of how many Workers
    // were behind the fold. Database carried a mood with no count, so one bad row out of four read
    // exactly like four. Every heading leads with a count now.
    expect(countPill(1, "Worker").label).toBe("1 Worker");
    expect(countPill(13, "Worker").label).toBe("13 Workers");

    const healthy = workersSectionPills([serviceRow("scan"), serviceRow("bundle")]);
    expect(healthy.map((pill) => pill.label)).toEqual(["2 Workers"]);
    const silent = workersSectionPills([serviceRow("scan"), serviceRow("bundle", "unreachable")]);
    expect(silent.map((pill) => pill.label)).toEqual(["2 Workers", "1 not reporting"]);
    expect(silent[1]?.variant).toBe("warning");
  });

  it("keeps the sync read on a shut Deployment heading, where folding used to lose it", () => {
    // The sync badge lived only inside the open section, so folding Deployment took the one fact a
    // reader opens it for off the screen entirely.
    const pills = deploymentSectionPills({ partCount: 3, syncState: "in-sync" });
    expect(pills.map((pill) => pill.label)).toEqual(["3 parts", "In sync"]);
    expect(pills[1]?.variant).toBe("success");
    expect(deploymentSectionPills({ partCount: 3, syncState: "web-behind" })[1]?.variant).toBe(
      "warning",
    );
    // Nothing real to compare is not a status, so the heading carries the count alone.
    expect(deploymentSectionPills({ partCount: 3, syncState: null })).toHaveLength(1);
  });

  it("shows that count on the heading exactly while the fold is shut", () => {
    // Shut, the heading wears what the fold hides; open, the rows say it themselves and a badge
    // repeating them is the same fact twice.
    expect(heading).toMatch(/\{#if collapsed\}[\s\S]*\{pill\.label\}/);
    // Each heading counts only the Workers ITS OWN fold hides. Workers is its own section now
    // rather than a drawer inside Deployment, so one count over the whole read would have both
    // headings claiming the same silent Worker.
    expect(chip).toContain("pills={workersPills}");
    expect(chip).toMatch(/workersPills = \$derived\([\s\S]*?deploymentRows\.rest/);
    expect(chip).toContain("pills={deploymentPills}");
    expect(chip).toMatch(/deploymentPills = \$derived\([\s\S]*?deploymentRows\.front/);
  });

  it("remembers the fold per browser, and arrives open", () => {
    // Arriving folded would hide an unreachable Worker from someone who opened the panel to find
    // one, so the fold is a choice this remembers, never the state it starts in.
    expect(preferences).toContain('"expanded"');
    expect(preferences).toMatch(/\["expanded", "collapsed"\],\s*"expanded",/);
    // On the shared primitive: storage hazards swallowed there, and two open tabs kept in step.
    expect(preferences).toContain("createPersistedPreference");
    expect(preferences).toContain("stringUnionPreference");
    expect(preferences).toContain("followAcrossTabs()");
  });
});

describe("the upstream-update notice", () => {
  const chip = stripComments(source("lib/versions/version-report.svelte"));
  const heading = stripComments(source("lib/versions/version-section-heading.svelte"));
  const svelteConfig = repositoryFile("apps/web/svelte.config.js");

  it("names each build by its commit and polls for a newer one", () => {
    // The poll compares version names, so the name has to change exactly when the bytes do: the
    // commit, from the same shared resolution every Worker stamp uses.
    expect(svelteConfig).toContain("resolveCommitIdentity");
    expect(svelteConfig).toContain("pollInterval");
  });

  it("watches the poll and answers it with the one gesture", () => {
    expect(chip).toContain("updated.current");
    expect(chip).toContain("UPDATE_AVAILABLE_EXPLANATION");
    expect(chip).toContain("location.reload()");
    expect(chip).toContain("{RELOAD_ACTION_LABEL}");
  });

  it("the notice states a direction and ends in the one gesture", () => {
    expect(UPDATE_AVAILABLE_EXPLANATION).toMatch(/newer/i);
    expect(UPDATE_AVAILABLE_EXPLANATION).toMatch(/reload/i);
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(UPDATE_AVAILABLE_EXPLANATION).not.toContain("—");
    expect(RELOAD_ACTION_LABEL).toBe("Reload");
  });

  it("a manual refresh re-checks for the update before the scope guard, so every scope gets it", () => {
    const body =
      /async function refresh\([^)]*\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    expect(body).toContain("updated.check()");
    expect(body.indexOf("updated.check()")).toBeLessThan(
      body.indexOf("if (!readsAggregate) return;"),
    );
  });

  it("signals on the always-visible chip, not only inside the panel", () => {
    // The trigger is the chip's own; the report it opens is the file every other assertion reads.
    const chipTrigger = stripComments(source("lib/versions/version-chip.svelte"));
    const trigger = /<Popover\.Trigger[\s\S]*?<\/Popover\.Trigger>/.exec(chipTrigger)?.[0] ?? "";
    expect(trigger).toContain("{#if updateAvailable}");
  });
});

describe("where the public chip is mounted", () => {
  const frame = source("lib/auth/auth-frame.svelte");

  it("rides the shared signed-out frame, in its chrome corner, in the public scope", () => {
    // One mount covers every surface the frame wraps: sign in, password reset, and the joining
    // screens. Pasting the chip into each screen would let them drift apart.
    expect(frame).toContain('<VersionChip scope="public" />');
    expect(stripComments(frame)).toMatch(
      /<TopBar\.Actions>[\s\S]*<VersionChip[\s\S]*<\/TopBar\.Actions>/,
    );
  });

  it("leads the actions cluster on BOTH surfaces, so it does not move on sign-in", () => {
    /*
     * Owner correction, 2026-08-29: "put build versions to the left of those buttons." The chip is
     * the FIRST thing in the trailing cluster on the signed-out frame and on the app shell alike —
     * the buttons beside it differ (ecosystem links there, bell/timer/profile here) but its seat
     * does not. Asserted on both files together because the defect this prevents is the two
     * drifting apart, which no single-file check would see.
     */
    for (const path of ["lib/auth/auth-frame.svelte", "lib/components/app-shell.svelte"]) {
      const actions = /<TopBar\.Actions>([\s\S]*?)<\/TopBar\.Actions>/.exec(
        stripComments(source(path)),
      );
      expect(actions, path).not.toBeNull();
      const firstElement = /<([A-Za-z][\w.]*)/.exec(actions?.[1] ?? "");
      expect(firstElement?.[1], path).toBe("VersionChip");
    }
  });

  it("is the frame every signed-out surface is cut from", () => {
    const surfaces = [
      "routes/login/+page.svelte",
      "routes/login/reset-password/+page.svelte",
      "routes/register/+page.svelte",
      "routes/register/firm/+page.svelte",
      "routes/register/invitation/+page.svelte",
      "routes/register/confirm/+page.svelte",
      "lib/auth/auth-placeholder.svelte",
    ];
    for (const surface of surfaces) {
      expect(source(surface), surface).toContain("auth-frame.svelte");
    }
  });
});

describe("timestamp rendering", () => {
  it("passes null through and refuses garbage", () => {
    expect(formatVersionTimestamp(null)).toBeNull();
    expect(formatVersionTimestamp("not a date")).toBeNull();
  });

  it("renders a parseable instant", () => {
    expect(formatVersionTimestamp("2026-08-29T10:00:00Z")).not.toBeNull();
  });
});
