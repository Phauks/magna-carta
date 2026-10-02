// @repo-wide-fitness — measures every route module's size and inline shape count against a ledger
// that only shrinks; a route added from any branch is what moves the numbers.
import { describe, expect, it } from "vitest";

// Fitness function (the ratchet pattern): a route module is glue — it declares its routes over
// shapes the domain package owns and hands the request to that package. Two numbers say whether a
// file has stopped being glue: its length, and how many request or response bodies it builds
// inline. Both are capped, and the files over the cap today are named in the ledger below with the
// value they hold, so the shape can only move one way.
//
// THE CAPS. `LINE_CAP` is the size a module holding its routes and their parameter schemas reaches;
// `SHAPE_CAP` counts `z.object(` constructions that are not a parameter or query declaration — the
// bodies and responses — so a module that keeps its addressing and moves its shapes clears it. A file over either cap is one whose bodies belong in
// packages/<domain>/src/contract.ts (docs/conventions/api.md, _Where a contract shape lives_).
//
// THE LEDGER IS A CEILING, AND IT ONLY GOES DOWN. A file may not exceed its recorded value; a file
// that has come down under a cap must have its entry removed; a file not in the ledger must be under
// both caps. Raising an entry is a reviewed act — the diff shows the number and the pull request says
// why — never a default.
//
// The worker's tests run inside the workerd pool, whose node:fs cannot read the host source tree, so
// the sources are pulled in as raw text at build time. import.meta.glob is a Vite build-time macro: it
// inlines the matched files and MUST be referenced by its full literal name, so it cannot be aliased.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const ROUTE_SOURCES = import.meta.glob("../src/http/routes/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const LINE_CAP = 500;
export const SHAPE_CAP = 4;

interface Shape {
  readonly lines: number;
  readonly shapes: number;
}

// Every route module over a cap on 2026-09-24, with the value it held. Keyed by the path under
// src/http/routes/ (domain directory included). Lower an entry when the file shrinks; delete it when the file clears both caps.
export const LEDGER: Readonly<Record<string, Shape>> = {
  "billing/billing.ts": { lines: 3059, shapes: 14 },
  "billing/costs.ts": { lines: 1202, shapes: 3 },
  "billing/reports.ts": { lines: 534, shapes: 18 },
  "calendar/calendar.ts": { lines: 3581, shapes: 1 },
  "communications/communications.ts": { lines: 1032, shapes: 2 },
  "communications/meeting-chat.ts": { lines: 634, shapes: 0 },
  "communications/meeting-hosting.ts": { lines: 598, shapes: 2 },
  "communications/meeting-inspect.ts": { lines: 243, shapes: 5 },
  "communications/meeting-lobby.ts": { lines: 564, shapes: 3 },
  "communications/meeting-polls.ts": { lines: 886, shapes: 0 },
  "communications/meeting-questions.ts": { lines: 816, shapes: 0 },
  "communications/meetings-guest.ts": { lines: 1419, shapes: 2 },
  "communications/meetings.ts": { lines: 1295, shapes: 1 },
  "communications/shipping.ts": { lines: 1364, shapes: 16 },
  "custody/custody.ts": { lines: 3145, shapes: 14 },
  "developer/dev-seed.ts": { lines: 516, shapes: 0 },
  "directory/conflicts.ts": { lines: 1840, shapes: 2 },
  "directory/directory.ts": { lines: 2558, shapes: 5 },
  "discovery/discovery-coding.ts": { lines: 1347, shapes: 6 },
  "discovery/discovery-review-reads.ts": { lines: 742, shapes: 2 },
  "discovery/discovery.ts": { lines: 1607, shapes: 5 },
  "documents/document-seal.ts": { lines: 316, shapes: 10 },
  "documents/templates.ts": { lines: 2029, shapes: 6 },
  "email/auto-file-rules.ts": { lines: 1135, shapes: 2 },
  "email/capture-addresses.ts": { lines: 728, shapes: 0 },
  "email/email-add-in.ts": { lines: 607, shapes: 5 },
  "email/email-inspector.ts": { lines: 199, shapes: 8 },
  "email/emails.ts": { lines: 866, shapes: 5 },
  "files/downloads-register.ts": { lines: 578, shapes: 2 },
  "files/downloads.ts": { lines: 591, shapes: 1 },
  "files/file-repair.ts": { lines: 711, shapes: 8 },
  "files/files.ts": { lines: 2161, shapes: 6 },
  "files/ocr.ts": { lines: 320, shapes: 6 },
  "files/recovery.ts": { lines: 450, shapes: 5 },
  "files/uploads.ts": { lines: 1005, shapes: 6 },
  "firm/custom-fields.ts": { lines: 1302, shapes: 11 },
  "firm/firm-ai-settings.ts": { lines: 494, shapes: 5 },
  "firm/firm-profile.ts": { lines: 713, shapes: 1 },
  "firm/firm-usage.ts": { lines: 261, shapes: 15 },
  "firm/numbering.ts": { lines: 610, shapes: 10 },
  "magnus/magnus.ts": { lines: 1507, shapes: 5 },
  "matters/intake.ts": { lines: 1171, shapes: 7 },
  "matters/locations.ts": { lines: 1307, shapes: 3 },
  "matters/matter-assets.ts": { lines: 2330, shapes: 12 },
  "matters/matter-plans.ts": { lines: 1003, shapes: 6 },
  "matters/matter-records.ts": { lines: 637, shapes: 3 },
  "matters/matters.ts": { lines: 1676, shapes: 7 },
  "notes-and-tasks/notes.ts": { lines: 685, shapes: 2 },
  "notes-and-tasks/tasks.ts": { lines: 1511, shapes: 7 },
  "notifications/notification-preferences.ts": { lines: 541, shapes: 1 },
  "notifications/notifications.ts": { lines: 630, shapes: 1 },
  "platform/meta-database-health.ts": { lines: 536, shapes: 1 },
  "session/member-administration.ts": { lines: 605, shapes: 1 },
  "session/registrations.ts": { lines: 794, shapes: 0 },
  "timekeeping/fees.ts": { lines: 976, shapes: 2 },
  "timekeeping/time-entries.ts": { lines: 2399, shapes: 3 },
  "timekeeping/timer.ts": { lines: 698, shapes: 2 },
  "tools/safe-browse.ts": { lines: 596, shapes: 2 },
  "trust/trust-firm-funds.ts": { lines: 601, shapes: 0 },
  "trust/trust-reconciliation.ts": { lines: 1393, shapes: 1 },
  "trust/trust-unclaimed-funds.ts": { lines: 760, shapes: 0 },
  "trust/trust.ts": { lines: 1509, shapes: 0 },
};

function routeFileName(modulePath: string): string {
  return modulePath.replace(/^.*\/src\/http\/routes\//, "");
}

// A body or response shape is a `z.object(` that is not a parameter or query declaration. The
// convention that tells them apart is the name: a path-parameter or query object is a camelCase
// const (`matterIdParam`, `resourcesQuery`), a body or response a PascalCase one or an inline
// schema in a route. Addressing stays with the route by design, so it does not count.
const ADDRESSING_DECLARATION = /^const [a-z][A-Za-z0-9]*(?:Param|Params|Query) = z\.object\(/gm;

export function measure(source: string): Shape {
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  const all = (source.match(/\bz\.object\(/g) ?? []).length;
  const addressing = (source.match(ADDRESSING_DECLARATION) ?? []).length;
  return { lines, shapes: all - addressing };
}

export function ratchetFindings(
  sources: Record<string, string>,
  ledger: Readonly<Record<string, Shape>>,
): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const [modulePath, source] of Object.entries(sources)) {
    const file = routeFileName(modulePath);
    seen.add(file);
    const actual = measure(source);
    const recorded = ledger[file];
    const overCap = actual.lines > LINE_CAP || actual.shapes > SHAPE_CAP;
    if (recorded === undefined) {
      if (actual.lines > LINE_CAP) {
        findings.push(
          `${file} is ${actual.lines} lines, over the ${LINE_CAP}-line cap — split it, or move its body shapes to the domain package's contract module`,
        );
      }
      if (actual.shapes > SHAPE_CAP) {
        findings.push(
          `${file} builds ${actual.shapes} inline shapes, over the cap of ${SHAPE_CAP} — a body shape belongs in packages/<domain>/src/contract.ts`,
        );
      }
      continue;
    }
    if (!overCap) {
      findings.push(
        `${file} is under both caps (${actual.lines} lines, ${actual.shapes} shapes) — remove its ledger entry`,
      );
      continue;
    }
    if (actual.lines > recorded.lines) {
      findings.push(
        `${file} grew from ${recorded.lines} to ${actual.lines} lines — the ledger only goes down; move a body shape out rather than raising it`,
      );
    }
    if (actual.shapes > recorded.shapes) {
      findings.push(
        `${file} builds ${actual.shapes} inline shapes, up from ${recorded.shapes} — the new one belongs in packages/<domain>/src/contract.ts`,
      );
    }
  }
  for (const file of Object.keys(ledger)) {
    if (!seen.has(file))
      findings.push(`${file} is in the ledger but no longer exists — remove its entry`);
  }
  return findings;
}

describe("route module shape ratchet (src/routes)", () => {
  it("no route module is over a cap without a ledger entry, and no entry has been exceeded", () => {
    expect(ratchetFindings(ROUTE_SOURCES, LEDGER)).toEqual([]);
  });

  it("is not vacuous — it measures the real route surface", () => {
    expect(Object.keys(ROUTE_SOURCES).length).toBeGreaterThan(90);
  });

  it("catches growth, a stale entry, a missing entry and a vanished file in a fixture", () => {
    const body = "const A = z.object({});\n";
    const fixtures = {
      "../src/http/routes/grown.ts": body.repeat(6),
      "../src/http/routes/cleared.ts": body,
      "../src/http/routes/unlisted.ts": body.repeat(5),
    };
    const ledger = {
      "grown.ts": { lines: 5, shapes: 5 },
      "cleared.ts": { lines: 600, shapes: 1 },
      "vanished.ts": { lines: 600, shapes: 1 },
    };
    const findings = ratchetFindings(fixtures, ledger);
    expect(findings.some((f) => f.startsWith("grown.ts grew"))).toBe(true);
    expect(findings.some((f) => f.startsWith("grown.ts builds 6"))).toBe(true);
    expect(findings.some((f) => f.startsWith("cleared.ts is under both caps"))).toBe(true);
    expect(findings.some((f) => f.startsWith("unlisted.ts builds 5"))).toBe(true);
    expect(findings.some((f) => f.startsWith("vanished.ts is in the ledger"))).toBe(true);
    expect(findings).toHaveLength(5);
  });
});
