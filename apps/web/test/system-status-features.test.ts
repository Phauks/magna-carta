// @node-runtime
/*
 * The System Status page's words for features, errors and flags, held against the things they
 * describe: every feature the API rosters has a name here, every deploy-queue section a feature
 * links to exists under exactly that heading, and the anchors are the ones GitHub generates.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FEATURE_WORDS,
  countFeatures,
  deployQueueUrl,
  featureSectionPills,
  githubHeadingAnchor,
  groupFeatures,
  describeSecretSources,
  missingRequirements,
  sortFeatures,
} from "../src/lib/versions/features-model.ts";
import {
  describeBackgroundState,
  describeRecentErrorsState,
  recentErrorsTile,
} from "../src/lib/versions/recent-errors-model.ts";
import {
  featureFlagRows,
  flagDiffersFromDefault,
  flagValueLabel,
} from "../src/lib/versions/feature-flags-model.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(join(REPOSITORY_ROOT, path), "utf8");

describe("feature words", () => {
  const rosterSource = read("apps/api-worker/src/system-status/feature-roster.ts");
  const rosterIds = [...rosterSource.matchAll(/\bid: "(?<id>\w+)"/g)].map(
    (match) => match.groups?.id ?? "",
  );

  it("reads the API roster rather than trusting this file", () => {
    expect(rosterIds.length).toBeGreaterThan(20);
  });

  it("names every feature the API rosters, and nothing it does not", () => {
    expect(Object.keys(FEATURE_WORDS).toSorted()).toEqual(rosterIds.toSorted());
  });

  it("gives every feature steps that turn it on", () => {
    for (const [id, words] of Object.entries(FEATURE_WORDS)) {
      expect(words.steps.length, id).toBeGreaterThan(0);
    }
  });

  it("links only to deploy-queue sections that exist under exactly that heading", () => {
    const headings = new Set(
      [...read("docs/deploy-queue.md").matchAll(/^## (?<heading>.+)$/gm)].map(
        (match) => match.groups?.heading ?? "",
      ),
    );
    for (const [id, words] of Object.entries(FEATURE_WORDS)) {
      if (words.deployQueueHeading !== null) {
        expect(headings.has(words.deployQueueHeading), id).toBe(true);
      }
    }
  });
});

describe("githubHeadingAnchor", () => {
  it("drops punctuation, keeps the spaces an em dash leaves, and hyphenates them", () => {
    expect(
      githubHeadingAnchor(
        "Outlook calendar connection activation — register one Microsoft application, then two secrets (2026-11-10)",
      ),
    ).toBe(
      "outlook-calendar-connection-activation--register-one-microsoft-application-then-two-secrets-2026-11-10",
    );
    expect(githubHeadingAnchor("`magna-carta-edit` — deployed 2026-08-21")).toBe(
      "magna-carta-edit--deployed-2026-08-21",
    );
  });

  it("builds the link against the repository, and none without one", () => {
    expect(deployQueueUrl("https://github.com/owner/repository", "meetings")).toMatch(
      /^https:\/\/github\.com\/owner\/repository\/blob\/main\/docs\/deploy-queue\.md#meetings--/,
    );
    expect(deployQueueUrl(null, "meetings")).toBeNull();
    expect(deployQueueUrl("https://github.com/owner/repository", "callerLookup")).toBeNull();
  });
});

describe("feature states", () => {
  const features = [
    { id: "meetings", state: "working" as const },
    { id: "malwareScanning", state: "fault" as const },
    { id: "outlookCalendarSync", state: "not-set-up" as const },
  ];

  it("counts and orders broken first, then off, then working", () => {
    expect(countFeatures(features)).toEqual({ total: 3, working: 1, notSetUp: 1, fault: 1 });
    expect(sortFeatures(features).map((feature) => feature.state)).toEqual([
      "fault",
      "not-set-up",
      "working",
    ]);
  });

  it("a heading counts its features and names what is not working", () => {
    expect(featureSectionPills(features).map((pill) => pill.label)).toEqual([
      "3 features",
      "1 not working",
      "1 not set up",
    ]);
  });

  it("groups features in the fixed group order and drops empty groups", () => {
    expect(groupFeatures(features).map((group) => group.id)).toEqual([
      "meetings",
      "calendarAndEmail",
      "files",
    ]);
  });

  it("says what is missing from the alternative closest to done", () => {
    expect(
      missingRequirements({
        id: "addressSuggestions",
        alternatives: [
          [{ name: "ADDRESS_SERVICE", present: false }],
          [
            { name: "SMARTY_AUTH_ID", present: true },
            { name: "SMARTY_AUTH_TOKEN", present: false },
          ],
        ],
      }),
    ).toEqual(["ADDRESS_SERVICE"]);
    expect(missingRequirements(undefined)).toEqual([]);
  });

  it("says where a set-up feature's secrets come from, from the alternative it runs on", () => {
    expect(
      describeSecretSources({
        id: "meetings",
        alternatives: [
          [
            { name: "REALTIME_SFU_APP_ID", present: true, source: "worker" },
            { name: "REALTIME_SFU_APP_SECRET", present: true, source: "secrets-store" },
          ],
        ],
      }),
    ).toBe("From the Secrets Store: REALTIME_SFU_APP_SECRET · On the Worker: REALTIME_SFU_APP_ID");
    expect(
      describeSecretSources({
        id: "addressSuggestions",
        alternatives: [
          [
            { name: "SMARTY_AUTH_ID", present: true, source: "worker" },
            { name: "SMARTY_AUTH_TOKEN", present: false, source: null },
          ],
          [{ name: "ADDRESS_SERVICE", present: true, source: null }],
        ],
      }),
    ).toBeNull();
    expect(describeSecretSources(undefined)).toBeNull();
  });
});

describe("recent errors words", () => {
  it("says why there are no rows, and nothing when the read worked", () => {
    expect(describeRecentErrorsState("read")).toBeNull();
    expect(describeRecentErrorsState("unreachable")).toContain("could not be read");
    expect(describeBackgroundState("read")).toBeNull();
    expect(describeBackgroundState("not-configured")).toContain("read-only token");
  });

  it("the tile counts errors and marks a truncated read", () => {
    expect(recentErrorsTile(null).figure).toBe("—");
    expect(
      recentErrorsTile({
        state: "read",
        backgroundState: "read",
        windowStart: null,
        windowEnd: null,
        total: 500,
        truncated: true,
        groups: [],
      }).figure,
    ).toBe("500+");
  });
});

describe("feature flags", () => {
  it("lists every catalog flag with what this session resolved it to", () => {
    const rows = featureFlagRows({ "release-channels.smoke": true });
    const smoke = rows.find((row) => row.key === "release-channels.smoke");
    expect(smoke?.value).toBe(true);
    expect(smoke !== undefined && flagDiffersFromDefault(smoke)).toBe(true);
  });

  it("keeps a flag the session carries that the catalog does not list", () => {
    expect(featureFlagRows({ "unlisted.flag": false }).map((row) => row.key)).toContain(
      "unlisted.flag",
    );
  });

  it("says when the session has not resolved a flag", () => {
    expect(flagValueLabel(null)).toBe("Not resolved");
  });
});
