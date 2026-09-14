/*
 * Settings · Conflicts — the registry facts the screen depends on, and the words it puts on the
 * controls a firm cannot switch off.
 *
 * These are cheap assertions guarding an expensive mistake. The conflicts destination spent a long
 * time shipped-but-unreachable because a registry flag disagreed with the routes beside it and
 * nothing failed on the disagreement; the settings registry works the same way, so the section being
 * registered and shipped is worth pinning rather than assuming.
 *
 * The name-role vocabulary is here for a different reason. It is the only place the surface says what
 * comparing a maiden name buys a firm, and the screen is an administrator deciding which conflicts
 * their firm will find. A role that reached the screen with no meaning beside it would be a policy
 * control with nothing to read.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "../src/lib/settings/settings-sections.ts";
import {
  NAME_ROLES,
  NAME_ROLE_VOCABULARY,
  SOURCE_VOCABULARY,
  nameRoleVocabulary,
} from "../src/lib/conflicts/conflicts-vocabulary.ts";

describe("the conflicts settings section", () => {
  const section = SETTINGS_SECTIONS.find((each) => each.id === "conflicts");

  it("is registered, shipped, and on the firm band", () => {
    expect(section).toBeDefined();
    expect(section?.href).toBe("/settings/conflicts");
    // Unshipped sections do not render in the settings nav at all, which is the same
    // built-but-unreachable failure the sidebar destination had.
    expect(section?.shipped).toBe(true);
    expect(section?.scope).toBe("firm");
  });

  it("commits as a draft rather than instantly", () => {
    // Not a style choice. Instant apply would make a floor of whatever a half-finished edit
    // happened to say, and the floor decides what every later check must search.
    expect(section?.commitMode).toBe("draft");
  });
});

describe("the words the policy controls carry", () => {
  it("gives every offered name role a label and a meaning", () => {
    for (const role of NAME_ROLES) {
      const word = nameRoleVocabulary(role);
      expect(word.label.length).toBeGreaterThan(0);
      expect(word.meaning.length).toBeGreaterThan(0);
    }
  });

  it("offers the roles the shipped default compares, and the two it deliberately does not", () => {
    // The default set encodes one reading — "the same person under a name they previously held" —
    // and `aka` and `dba` are outside it on purpose. Both are still offered, because excluding a
    // role from a default is a different act from hiding it from the firm.
    expect(NAME_ROLES).toContain("current");
    expect(NAME_ROLES).toContain("former");
    expect(NAME_ROLES).toContain("maiden");
    expect(NAME_ROLES).toContain("alias");
    expect(NAME_ROLES).toContain("aka");
    expect(NAME_ROLES).toContain("dba");
  });

  it("says on the current role why it cannot be switched off", () => {
    // The screen renders this control locked. A locked control whose reason is not readable is
    // indistinguishable from an option somebody forgot to wire up.
    expect(NAME_ROLE_VOCABULARY["current"]?.meaning).toMatch(/always compared/i);
  });

  it("has a word for every source class the floor offers", () => {
    for (const source of ["party", "graph", "imputation", "content"]) {
      expect(SOURCE_VOCABULARY[source]?.label.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("does not resolve an unknown role to a guess", () => {
    // An unrecognized role prints itself rather than borrowing another role's meaning, the same
    // posture the rest of this vocabulary takes towards words a build has not heard of.
    const unknown = nameRoleVocabulary("religious");
    expect(unknown.label).toBe("religious");
    expect(unknown.meaning).toBe("");
  });
});
