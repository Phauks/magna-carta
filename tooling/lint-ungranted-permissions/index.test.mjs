import { describe, expect, it } from "vitest";
import {
  collectCatalogueDemands,
  collectGrants,
  collectRouteDemands,
  runSelfTest,
} from "./index.mjs";
import { ALLOWLIST, SELF_TEST, findUngrantedPermissions } from "./rules.mjs";

// The gate runs SELF_TEST on every invocation; this file drives the same fixtures through the same
// entry point so a rule regression fails the suite as well as the gate, and adds the cases that are
// about the scan's own collection edges rather than about the rule.

describe("the fixtures the gate self-tests against", () => {
  for (const scenario of SELF_TEST) {
    it(scenario.name, () => {
      const found = findUngrantedPermissions(
        scenario.demands,
        new Set(scenario.granted),
        new Map(Object.entries(scenario.allowlist)),
      );
      expect(found.map((problem) => problem.rule).toSorted()).toEqual(
        [...scenario.expect].toSorted(),
      );
    });
  }

  it("the runner's own self-test passes, which is what the gate asserts before it scans", () => {
    expect(runSelfTest()).toEqual([]);
  });
});

describe("what counts as a route demand", () => {
  const document = {
    paths: {
      "/api/v1/documents/{fileId}/edit-session": {
        post: { "x-mc-permission": "documents:edit", "x-mc-surface": "app" },
      },
      "/api/v1/firms": {
        post: { "x-mc-permission": "firm:provision", "x-mc-surface": "public" },
      },
      "/api/v1/documents/{fileId}/view-session": {
        get: { "x-mc-permission": null, "x-mc-surface": "app" },
      },
      "/api/v1/matters": {
        get: { "x-mc-permission": "matters:create", "x-mc-surface": "app" },
        post: { "x-mc-permission": "matters:create", "x-mc-surface": "app" },
        parameters: [],
      },
    },
  };

  it("takes a chokepoint-enforced route and records the operation it came from", () => {
    expect(collectRouteDemands(document)).toContainEqual({
      permission: "documents:edit",
      source: "route",
      where: "POST /api/v1/documents/{fileId}/edit-session",
    });
  });

  it('ignores a surface:"public" route, whose RBAC gate the chokepoint skips', () => {
    // Three of the seven hits the wider form produced were exactly these, and they are false by
    // construction rather than by accident — a role holding firm:provision would gain nothing.
    expect(collectRouteDemands(document).map((demand) => demand.permission)).not.toContain(
      "firm:provision",
    );
  });

  it("ignores a route that names no permission at all", () => {
    expect(collectRouteDemands(document)).toHaveLength(3);
  });

  it("keeps both operations that demand one permission, so the report can name every place", () => {
    const places = collectRouteDemands(document)
      .filter((demand) => demand.permission === "matters:create")
      .map((demand) => demand.where);
    expect(places.toSorted()).toEqual(["GET /api/v1/matters", "POST /api/v1/matters"]);
  });

  it("does not mistake a path-level `parameters` array for an operation", () => {
    // `paths[path].parameters` sits beside the verbs and is an array, not an object with meta.
    expect(collectRouteDemands(document).every((demand) => demand.permission !== undefined)).toBe(
      true,
    );
  });
});

describe("what counts as a Tools catalogue demand", () => {
  it("reads the permission out of each manifest", () => {
    const catalogue = `
      export const CATALOG = [
        { id: "a", permission: assertPermission("tools:whois") },
        { id: "b", permission: assertPermission("tools:attorneyLicense") },
      ];
    `;
    expect(collectCatalogueDemands(catalogue).map((demand) => demand.permission)).toEqual([
      "tools:whois",
      "tools:attorneyLicense",
    ]);
  });

  it("is stateless between calls", () => {
    // A `g` regex carries lastIndex, and a scan that forgot to reset it would silently miss the
    // first manifest on the second call.
    const catalogue = `permission: assertPermission("tools:whois")`;
    expect(collectCatalogueDemands(catalogue)).toHaveLength(1);
    expect(collectCatalogueDemands(catalogue)).toHaveLength(1);
  });
});

describe("what counts as a seed", () => {
  it("reads a role_permission seed in the shape every migration writes", () => {
    const granted = collectGrants(
      new Map([
        [
          "a.sql",
          "INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_a', 'role_b', 'documents:edit');",
        ],
      ]),
    );
    expect([...granted]).toEqual(["documents:edit"]);
  });

  it("reads a direct_grant seed too — a permission somebody can hold is a permission somebody can hold", () => {
    const granted = collectGrants(
      new Map([
        [
          "a.sql",
          "INSERT INTO `direct_grant` (`id`, `member_user_id`, `permission`) VALUES ('grant_a', 'user_b', 'documents:reconcile');",
        ],
      ]),
    );
    expect([...granted]).toEqual(["documents:reconcile"]);
  });

  it("takes the permission by COLUMN NAME, not by position", () => {
    // A future seed written with its columns in another order still counts. Reading position three
    // would silently miss it, and a missed seed is a false alarm on a correct permission.
    const granted = collectGrants(
      new Map([
        [
          "a.sql",
          "INSERT INTO `role_permission` (`permission`, `id`, `role_id`) VALUES ('trust:manage', 'rolePermission_a', 'role_b');",
        ],
      ]),
    );
    expect([...granted]).toEqual(["trust:manage"]);
  });

  it("ignores an INSERT into any other table", () => {
    const granted = collectGrants(
      new Map([
        [
          "a.sql",
          "INSERT INTO `role` (`id`, `name`, `permission`) VALUES ('role_a', 'Owner/Admin', 'not-a-grant');",
        ],
      ]),
    );
    expect([...granted]).toEqual([]);
  });

  it("collects across every migration file, since a seed can land in any of them", () => {
    const granted = collectGrants(
      new Map([
        [
          "a.sql",
          "INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_a', 'role_b', 'documents:edit');",
        ],
        [
          "b.sql",
          "INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_c', 'role_d', 'documents:checkout');\n" +
            "INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_e', 'role_f', 'documents:edit');",
        ],
      ]),
    );
    expect([...granted].toSorted()).toEqual(["documents:checkout", "documents:edit"]);
  });
});

describe("the allowlist", () => {
  it("gives every entry a non-empty reason", () => {
    // The reason IS the review this gate exists to force. An entry without one suppresses a finding
    // and records nothing about why, which is the state the gate was built to make impossible.
    for (const [permission, reason] of ALLOWLIST) {
      expect(reason.trim(), permission).not.toBe("");
    }
  });
});
