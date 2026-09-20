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
// `SHAPE_CAP` (counted as `z.object(` constructions) is what path and query parameters need and a
// body does not. A file over either cap is one whose bodies belong in
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

const ROUTE_SOURCES = import.meta.glob("../src/routes/**/*.ts", {
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

// Every route module over a cap on 2026-09-20, with the value it held. Keyed by the path under
// src/routes/ (domain directory included). Lower an entry when the file shrinks; delete it when the file clears both caps.
export const LEDGER: Readonly<Record<string, Shape>> = {
  "billing/billing.ts": { lines: 3062, shapes: 27 },
  "billing/costs.ts": { lines: 1205, shapes: 5 },
  "billing/reports.ts": { lines: 534, shapes: 19 },
  "calendar/calendar.ts": { lines: 3589, shapes: 16 },
  "communications/communications.ts": { lines: 1035, shapes: 5 },
  "communications/shipping.ts": { lines: 1023, shapes: 14 },
  "custody/custody.ts": { lines: 3148, shapes: 20 },
  "developer/dev-seed.ts": { lines: 516, shapes: 0 },
  "directory/conflicts.ts": { lines: 1843, shapes: 6 },
  "directory/directory.ts": { lines: 3436, shapes: 14 },
  "discovery/discovery-coding.ts": { lines: 1347, shapes: 7 },
  "discovery/discovery-review-reads.ts": { lines: 741, shapes: 4 },
  "discovery/discovery.ts": { lines: 1610, shapes: 9 },
  "documents/document-seal.ts": { lines: 316, shapes: 10 },
  "documents/templates.ts": { lines: 2029, shapes: 9 },
  "email/auto-file-rules.ts": { lines: 1138, shapes: 4 },
  "email/capture-addresses.ts": { lines: 728, shapes: 2 },
  "email/email-add-in.ts": { lines: 607, shapes: 5 },
  "email/email-inspector.ts": { lines: 199, shapes: 8 },
  "email/emails.ts": { lines: 866, shapes: 7 },
  "files/downloads-register.ts": { lines: 578, shapes: 2 },
  "files/downloads.ts": { lines: 542, shapes: 1 },
  "files/file-repair.ts": { lines: 711, shapes: 8 },
  "files/files.ts": { lines: 2144, shapes: 8 },
  "files/folders.ts": { lines: 440, shapes: 5 },
  "files/ocr.ts": { lines: 320, shapes: 6 },
  "files/recovery.ts": { lines: 450, shapes: 5 },
  "files/uploads.ts": { lines: 1008, shapes: 7 },
  "firm/custom-fields.ts": { lines: 1305, shapes: 15 },
  "firm/firm-ai-settings.ts": { lines: 494, shapes: 5 },
  "firm/firm-profile.ts": { lines: 713, shapes: 2 },
  "firm/firm-usage.ts": { lines: 261, shapes: 15 },
  "firm/numbering.ts": { lines: 610, shapes: 10 },
  "magnus/magnus.ts": { lines: 1510, shapes: 8 },
  "matters/intake.ts": { lines: 1174, shapes: 11 },
  "matters/locations.ts": { lines: 1310, shapes: 6 },
  "matters/matter-assets.ts": { lines: 2333, shapes: 17 },
  "matters/matter-plans.ts": { lines: 1006, shapes: 10 },
  "matters/matter-records.ts": { lines: 640, shapes: 4 },
  "matters/matters.ts": { lines: 1679, shapes: 8 },
  "notes-and-tasks/notes.ts": { lines: 688, shapes: 5 },
  "notes-and-tasks/tasks.ts": { lines: 1514, shapes: 11 },
  "notifications/notification-preferences.ts": { lines: 541, shapes: 1 },
  "notifications/notifications.ts": { lines: 630, shapes: 2 },
  "platform/meta-database-health.ts": { lines: 536, shapes: 1 },
  "session/member-administration.ts": { lines: 608, shapes: 2 },
  "session/registrations.ts": { lines: 794, shapes: 0 },
  "timekeeping/fees.ts": { lines: 979, shapes: 4 },
  "timekeeping/rate-cards.ts": { lines: 403, shapes: 5 },
  "timekeeping/time-entries.ts": { lines: 2402, shapes: 5 },
  "timekeeping/timer.ts": { lines: 697, shapes: 2 },
  "tools/safe-browse.ts": { lines: 596, shapes: 2 },
  "trust/trust-firm-funds.ts": { lines: 600, shapes: 1 },
  "trust/trust-reconciliation.ts": { lines: 1316, shapes: 5 },
  "trust/trust-unclaimed-funds.ts": { lines: 763, shapes: 2 },
  "trust/trust.ts": { lines: 1232, shapes: 4 },
};

function routeFileName(modulePath: string): string {
  return modulePath.replace(/^.*\/src\/routes\//, "");
}

export function measure(source: string): Shape {
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  const shapes = (source.match(/\bz\.object\(/g) ?? []).length;
  return { lines, shapes };
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
      "../src/routes/grown.ts": body.repeat(6),
      "../src/routes/cleared.ts": body,
      "../src/routes/unlisted.ts": body.repeat(5),
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
