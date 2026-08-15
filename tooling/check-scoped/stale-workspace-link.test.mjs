import { describe, expect, it } from "vitest";
import { mentionsMissingWorkspaceModule } from "./stale-workspace-link.mjs";

// The whole value of the hint is that it is silent when it does not apply: a message that also fired
// on ordinary type errors would teach everyone to scroll past the one time it is right. These are the
// real compiler shapes, verbatim.
describe("mentionsMissingWorkspaceModule", () => {
  it("recognizes a missing workspace module", () => {
    const output = [
      "packages/trust/src/unclaimed-funds.ts:3:31 - error TS2307: Cannot find module '@magna-carta/identifiers/generate' or its corresponding type declarations.",
      "",
      '3 import { newIdentifier } from "@magna-carta/identifiers/generate";',
    ].join("\n");
    expect(mentionsMissingWorkspaceModule(output)).toBe(true);
  });

  it("stays silent on an ordinary type error", () => {
    const output =
      "packages/trust/src/firm-funds.ts:434:7 - error TS2322: Type 'string' is not assignable to type 'number'.";
    expect(mentionsMissingWorkspaceModule(output)).toBe(false);
  });

  it("stays silent on a missing module that is not a workspace package", () => {
    const output =
      "packages/trust/src/statements.ts:1:20 - error TS2307: Cannot find module 'drizzle-orm' or its corresponding type declarations.";
    expect(mentionsMissingWorkspaceModule(output)).toBe(false);
  });

  it("stays silent when a workspace package is merely named on another line", () => {
    // A TS2307 about an unrelated module, with a @magna-carta specifier quoted in the source excerpt
    // of a DIFFERENT diagnostic below it. Matching across lines would call this a stale link.
    const output = [
      "packages/trust/src/movements.ts:2:20 - error TS2307: Cannot find module 'hono' or its corresponding type declarations.",
      "",
      "packages/trust/src/movements.ts:9:31 - error TS2345: Argument of type 'string' is not assignable.",
      "",
      '9 import { toMinor } from "@magna-carta/money/format";',
    ].join("\n");
    expect(mentionsMissingWorkspaceModule(output)).toBe(false);
  });

  it("stays silent on the type-library failure that usually accompanies it", () => {
    // TS2688 alone means the compiler never got as far as resolving imports, so there is nothing here
    // to distinguish a stale link from anything else.
    const output = "error TS2688: Cannot find type definition file for 'node'.";
    expect(mentionsMissingWorkspaceModule(output)).toBe(false);
  });

  it("survives a colorized compiler", () => {
    // Written as an escape sequence rather than a raw byte: a control character in source fails the
    // gate, and this file would be the last place anyone thought to look for one.
    const escape = "\u001b";
    const output =
      `packages/trust/src/holds.ts:4:24 - ${escape}[91merror${escape}[0m ${escape}[90mTS2307: ${escape}[0m` +
      "Cannot find module '@magna-carta/ledger/post-entry' or its corresponding type declarations.";
    expect(mentionsMissingWorkspaceModule(output)).toBe(true);
  });
});
