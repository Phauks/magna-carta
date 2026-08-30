/*
 * The version overlay's honesty rules, exercised on the pure model: a placeholder identity never
 * claims a skew, every non-answer keeps its own name, a cached observation states its age once it
 * has one, a re-ask that fails never leaves its rows looking current, and a copied identifier line
 * carries only what was actually known.
 *
 * The deployed-unit names are pinned to the things that deploy them rather than to this file's
 * word: the API's service roster and the app Worker's own service bindings are read off disk, and
 * every rostered service must resolve to the script name its binding actually targets. A name
 * invented here, or a service added to the roster and forgotten here, fails.
 *
 * The scope rules are asserted twice over. The decision itself is a pure function and is tested as
 * one; that the component actually obeys it is read off the component's source, because this
 * project's tests run in a plain node pool and rendering a design-system component pulls bits-ui,
 * which a deliberate boundary gate keeps out of every config outside the design system
 * (packages/design-system/test/fitness/boundaries.test.ts). What matters most is negative — that a
 * signed-out panel issues no authenticated request at all — and a source assertion states it for
 * every path into the call rather than only the one a render happened to exercise.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildsDiffer,
  copyLineForPart,
  deployedUnitName,
  describeObservationAge,
  describeRetainedRows,
  formatVersionTimestamp,
  isRealCommit,
  joinDetailSegments,
  readsServiceAggregate,
  serviceStateDescription,
  serviceStateLabel,
  versionChipLabel,
  API_ROW_DESCRIPTION,
  API_WORKER_UNIT_NAME,
  BUILD_SKEW_EXPLANATION,
  READ_IN_FLIGHT_NOTICE,
  SIGNED_OUT_ESTATE_NOTICE,
  WEB_APP_ROW_DESCRIPTION,
  WEB_APP_SHIPS_INSIDE_API_NOTICE,
} from "../src/lib/versions/version-overlay-model.ts";

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

describe("the web-versus-API skew call", () => {
  it("two different real commits are a skew", () => {
    expect(buildsDiffer("f4b6d82", "a1b2c3d")).toBe(true);
  });

  it("the same commit on both sides is not", () => {
    expect(buildsDiffer("f4b6d82", "f4b6d82")).toBe(false);
  });

  it("a placeholder on either side says no identity, never a different identity", () => {
    expect(buildsDiffer("unknown", "a1b2c3d")).toBe(false);
    expect(buildsDiffer("f4b6d82", "dev")).toBe(false);
    expect(buildsDiffer("f4b6d82", null)).toBe(false);
  });

  it("two abbreviations of one commit are the same build, however long each side is", () => {
    // The web app's stamp comes from git; a Worker built where git could not answer takes the
    // build runner's commit variable and abbreviates it itself. Same commit, different lengths,
    // and an equality test would warn about a deployment that is in step.
    expect(buildsDiffer("f4b6d82", "f4b6d8291")).toBe(false);
    expect(buildsDiffer("f4b6d8291", "f4b6d82")).toBe(false);
    expect(buildsDiffer("F4B6D82", "f4b6d8291")).toBe(false);
  });

  it("a prefix too short to identify a commit is not treated as agreement", () => {
    expect(buildsDiffer("f4b6", "f4b6d8291")).toBe(true);
  });

  it("explains the difference as one deployment behind, not two deploys out of step", () => {
    // The SPA is bundled into the API Worker, so there is only one deployable to be out of step
    // WITH. A difference means the page in this tab predates the Worker now answering it.
    expect(BUILD_SKEW_EXPLANATION).toContain(API_WORKER_UNIT_NAME);
    expect(BUILD_SKEW_EXPLANATION).toMatch(/reload/i);
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(BUILD_SKEW_EXPLANATION).not.toContain("—");
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
   * The roster the API actually probes, and the service bindings the app Worker actually declares.
   * Both are read off disk so a name here can only be right by matching the thing that deploys it.
   */
  const rosterSource = repositoryFile("apps/api-worker/src/routes/meta-versions.ts");
  const rosterEntries = [
    ...rosterSource.matchAll(
      /\{ id: "(?<id>\w+)", label: "(?<label>[^"]+)", binding: "(?<binding>\w+)" \}/g,
    ),
  ].map((match) => match.groups as unknown as { id: string; label: string; binding: string });

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

  it("names every service the API reports on", () => {
    for (const entry of rosterEntries) {
      expect(deployedUnitName(entry.id), entry.id).not.toBeNull();
    }
  });

  it("names each bound service exactly as its service binding targets it", () => {
    for (const entry of rosterEntries) {
      const boundName = boundScriptNames.get(entry.binding);
      if (boundName === undefined) continue;
      expect(deployedUnitName(entry.id), entry.id).toBe(boundName);
    }
  });

  it("a service with no binding takes the name the operations runbook gives it", () => {
    // Keyword search has no binding in the app Worker and no connected project, so its row reads
    // "Not deployed". The name still has to come from somewhere real rather than be inferred from
    // the pattern of its siblings.
    const runbook = repositoryFile("docs/conventions/operations.md");
    for (const entry of rosterEntries) {
      if (boundScriptNames.has(entry.binding)) continue;
      const name = deployedUnitName(entry.id) ?? "";
      expect(name, entry.id).not.toBe("");
      expect(runbook, entry.id).toContain(name);
    }
  });

  it("leaves a service it has no name for unnamed rather than guessing one", () => {
    expect(deployedUnitName("a-service-added-after-this-build")).toBeNull();
  });

  it("names the one Worker that carries both the page and the API", () => {
    expect(API_WORKER_UNIT_NAME).toBe("magna-carta");
    expect(wranglerSource).toContain(`"name": "${API_WORKER_UNIT_NAME}"`);
    // The claim the two rows rest on: the SPA build output is this Worker's static assets.
    expect(wranglerSource).toMatch(/"assets":\s*\{[\s\S]*?"directory":\s*"\.\.\/web\/build"/);
  });

  it("says the web app ships inside the API Worker, naming the project that does not serve it", () => {
    expect(WEB_APP_SHIPS_INSIDE_API_NOTICE).toContain("magna-carta deploys");
    expect(WEB_APP_SHIPS_INSIDE_API_NOTICE).toContain("magna-carta-web");
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(WEB_APP_SHIPS_INSIDE_API_NOTICE).not.toContain("—");
  });

  it("the two rows sharing one name are told apart by what each reports on", () => {
    expect(WEB_APP_ROW_DESCRIPTION).not.toBe(API_ROW_DESCRIPTION);
    expect(WEB_APP_ROW_DESCRIPTION).toMatch(/bundle/i);
    expect(API_ROW_DESCRIPTION).toMatch(/API Worker/i);
  });
});

describe("a row's detail line", () => {
  it("joins what is known and drops what is not", () => {
    expect(joinDetailSegments(["Malware Scan", "committed 29 Aug"])).toBe(
      "Malware Scan · committed 29 Aug",
    );
    expect(joinDetailSegments([null, "This deployment is not wired to it."])).toBe(
      "This deployment is not wired to it.",
    );
    expect(joinDetailSegments(["Malware Scan", null])).toBe("Malware Scan");
    expect(joinDetailSegments([null, null])).toBeNull();
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
        label: "magna-carta-scan (Malware Scan)",
        commit: "a1b2c3d",
        commitTime: "2026-08-29T10:00:00Z",
        buildTime: "2026-08-29T10:05:00Z",
      }),
    ).toBe(
      "magna-carta-scan (Malware Scan): a1b2c3d · committed 2026-08-29T10:00:00Z · built 2026-08-29T10:05:00Z",
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
  const chip = stripComments(source("lib/versions/version-chip.svelte"));

  it("reads the aggregate from exactly one place, and that place refuses the public scope", () => {
    const calls = chip.match(/requestJson</g) ?? [];
    expect(calls).toHaveLength(1);
    const refreshBody = /async function refresh\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip);
    expect(refreshBody).not.toBeNull();
    const body = refreshBody?.[1] ?? "";
    expect(body).toContain("if (!readsAggregate) return;");
    // The guard precedes the call, so no path through the function reaches the network first.
    expect(body.indexOf("if (!readsAggregate) return;")).toBeLessThan(body.indexOf("requestJson<"));
  });

  it("never opens the read on a public panel, however the panel was opened", () => {
    expect(chip).toContain("if (!open || !readsAggregate) return;");
  });

  it("shows this build's own identity unconditionally, from the baked-in stamp", () => {
    // The web row comes from the bundle, not the network, so it renders in both scopes and with
    // the API unreachable: it must sit outside every conditional in the panel.
    const webRow = /\{@render partRow\(\{\s*rowKey: "web",[\s\S]*?\}\)\}/.exec(chip);
    expect(webRow).not.toBeNull();
    expect(webRow?.[0]).toContain("BUILD_IDENTITY.committedAt");
    expect(openBlockDepthAt(chip, chip.indexOf('rowKey: "web"'))).toBe(0);
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
  const chip = stripComments(source("lib/versions/version-chip.svelte"));

  it("heads every row with its deployed unit and drops the description beneath it", () => {
    expect(chip).toContain("{@const heading = part.unitName ?? part.description}");
    expect(chip).toContain('<span class="font-mono text-sm text-text-default">{heading}</span>');
    expect(chip).toMatch(
      /joinDetailSegments\(\[\s*part\.unitName === null \? null : part\.description/,
    );
  });

  it("takes each service row's name from the shared map, keyed by the wire's own id", () => {
    expect(chip).toMatch(/unitName: deployedUnitName\(service\.id\)/);
    // No name is written into the component: the map is the one home for them.
    expect(chip).not.toMatch(/"magna-carta-[a-z-]+"/);
  });

  it("names the same Worker on the web row and the API row, and says why", () => {
    expect(chip).toMatch(/rowKey: "web",\s*unitName: API_WORKER_UNIT_NAME/);
    expect(chip).toMatch(/rowKey: "api",\s*unitName: API_WORKER_UNIT_NAME/);
    expect(chip).toContain("{WEB_APP_SHIPS_INSIDE_API_NOTICE}");
    // The line belongs beside the comparison it explains: after both rows, before the services.
    expect(chip.indexOf('rowKey: "api"')).toBeLessThan(
      chip.indexOf("{WEB_APP_SHIPS_INSIDE_API_NOTICE}"),
    );
    expect(chip.indexOf("{WEB_APP_SHIPS_INSIDE_API_NOTICE}")).toBeLessThan(
      chip.indexOf("{#each value.services"),
    );
  });

  it("offers a refresh that re-runs the read and is inert while one is in flight", () => {
    const refreshControl =
      /<Button[^>]*aria-label="Refresh the version read"[\s\S]*?<\/Button>/.exec(chip);
    expect(refreshControl).not.toBeNull();
    const control = refreshControl?.[0] ?? "";
    expect(control).toContain("disabled={loading}");
    expect(control).toContain("aria-busy={loading}");
    expect(control).toContain("onclick={() => refresh()}");
  });

  it("shows the read in flight, and never a stale age line while it is", () => {
    expect(chip).toMatch(
      /\{#if loading\}[\s\S]*READ_IN_FLIGHT_NOTICE[\s\S]*\{:else if observationAge/,
    );
  });

  it("marks the read in flight around the call itself, not around the panel", () => {
    const body =
      /async function refresh\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    expect(body.indexOf("loading = true;")).toBeLessThan(body.indexOf("requestJson<"));
    expect(body.indexOf("requestJson<")).toBeLessThan(body.indexOf("loading = false;"));
  });

  it("keeps the rows a failed refresh could not replace, and says they are the older read's", () => {
    const body =
      /async function refresh\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip)?.[1] ?? "";
    // Blanking the rows would trade a stale answer for no answer; the sentence is what keeps the
    // retained rows from reading as current.
    expect(body).not.toContain("value = null");
    expect(chip).toContain("describeRetainedRows(value.observedAt, nowEpochMilliseconds)");
    expect(chip).toContain("{retainedRows}");
  });

  it("still surfaces the Error ID on a failure, above the rows it could not refresh", () => {
    expect(chip).toContain("Error ID:");
    expect(chip).toContain("failure.problem.errorId");
    expect(chip.indexOf("Error ID:")).toBeLessThan(chip.indexOf('rowKey: "web"'));
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
