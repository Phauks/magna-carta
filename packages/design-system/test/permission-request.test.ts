import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALLOW_LABEL,
  ALLOWING_LABEL,
  askedByLine,
} from "../src/lib/components/permission-request/permission-request-model.ts";

/*
 * PermissionRequest's package-local contract.
 *
 * What is rendered belongs to the story. What is pinned here is the ruling the component exists to
 * hold: a request states what it grants and stops. That is a claim about what the component has NO
 * place for, so it is asserted against the source — a rendered panel that happens to carry no
 * "will not" list today says nothing about whether a caller could add one tomorrow.
 */

const componentSource = readFileSync(
  fileURLToPath(
    new URL("../src/lib/components/permission-request/permission-request.svelte", import.meta.url),
  ),
  "utf8",
);

const typesSource = readFileSync(
  fileURLToPath(new URL("../src/lib/components/permission-request/types.ts", import.meta.url)),
  "utf8",
);

describe("the words every request shares", () => {
  it("allows with one verb, whatever is being asked for", () => {
    expect(ALLOW_LABEL).toBe("Allow");
    expect(ALLOWING_LABEL).toBe("Allowing");
  });

  it("names who is asking in one line", () => {
    expect(askedByLine("Calendar Sync")).toBe("Asked by Calendar Sync");
  });
});

describe("a request states only what it grants", () => {
  it("takes a heading, who is asking and the grants, and no other content", () => {
    const fields = [...typesSource.matchAll(/^\s+readonly (\w+):/gmu)].map((match) => match[1]);
    expect(fields).toEqual(["heading", "askedBy", "grants"]);
  });

  it("requires at least one grant, by type", () => {
    expect(typesSource).toContain("readonly grants: readonly [string, ...string[]]");
  });

  it("gives a caller no body, class or commit-label prop to say more with", () => {
    const destructured = /let \{([^}]*)\}/u.exec(componentSource)?.[1] ?? "";
    const names = destructured
      .split(",")
      .map((entry) => entry.trim().split(/[\s=]/u)[0])
      .filter((name) => name !== undefined && name !== "");
    expect(names).toEqual([
      "open",
      "heading",
      "askedBy",
      "grants",
      "onAllow",
      "onDismiss",
      "notice",
    ]);
  });

  it("is a question on the one acting panel, not a panel of its own", () => {
    expect(componentSource).toContain('kind="confirm"');
    expect(componentSource).not.toMatch(/Dialog\.Content|AlertDialog\./u);
  });
});
