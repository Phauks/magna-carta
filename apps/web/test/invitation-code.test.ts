/*
 * The invitation-code field's formatting, pinned against the ONE thing that makes it safe to format
 * at all: the server normalizes before it hashes, so whatever the field renders must reduce to the
 * same twelve characters the generator emitted.
 *
 * The cases below are the ways somebody actually gets a code into the box — typed in lowercase,
 * pasted with the grouping already in it, pasted out of a mail client that wrapped it with a space,
 * pasted with the whole thing selected and replaced — plus the one case the field must not invent:
 * a prefix. See ../src/lib/auth/invitation-code.ts for why there is none.
 */
import { describe, expect, it } from "vitest";
import {
  INVITATION_CODE_LENGTH,
  formatInvitationCode,
  isCompleteInvitationCode,
  normalizeInvitationCode,
} from "../src/lib/auth/invitation-code.ts";

/**
 * The server's own reduction, transcribed from apps/worker/src/joining-secrets.ts. Written out here
 * rather than imported because the Worker is a different package and this is the assertion that the
 * two agree — importing the thing under comparison would assert nothing.
 */
function serverNormalization(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const GENERATED = "ABCD2345EFGH";

describe("normalizeInvitationCode", () => {
  it("agrees with the server's reduction on every shape the field can produce", () => {
    const typed = ["abcd2345efgh", "ABCD-2345-EFGH", " abcd 2345 efgh ", "AbCd2345eFgH"];
    for (const value of typed) {
      expect(normalizeInvitationCode(value)).toBe(serverNormalization(value));
      expect(normalizeInvitationCode(value)).toBe(GENERATED);
    }
  });

  it("drops punctuation rather than mapping it onto a character", () => {
    expect(normalizeInvitationCode("ABCD_2345.EFGH")).toBe(GENERATED);
  });
});

describe("formatInvitationCode", () => {
  it("groups the generated length in fours", () => {
    expect(formatInvitationCode(GENERATED)).toBe("ABCD-2345-EFGH");
  });

  it("never inserts a separator ahead of the character that would follow it", () => {
    // A separator added the moment a group fills puts the caret behind punctuation nobody typed.
    expect(formatInvitationCode("ABCD")).toBe("ABCD");
    expect(formatInvitationCode("ABCDE")).toBe("ABCD-E");
  });

  it("is idempotent, because it runs on every keystroke over its own output", () => {
    const once = formatInvitationCode("abcd2345efgh");
    expect(formatInvitationCode(once)).toBe(once);
  });

  it("caps at the generated length so an over-long paste cannot fill the field with noise", () => {
    expect(normalizeInvitationCode(formatInvitationCode(`${GENERATED}ZZZZZZ`))).toHaveLength(
      INVITATION_CODE_LENGTH,
    );
  });

  it("adds no prefix of its own", () => {
    // A prefix the generator never emitted would normalize into the digest and refuse every code.
    expect(formatInvitationCode(GENERATED).startsWith("MC")).toBe(false);
  });
});

describe("isCompleteInvitationCode", () => {
  it("is true only at the generated length, whatever the grouping", () => {
    expect(isCompleteInvitationCode("ABCD-2345-EFGH")).toBe(true);
    expect(isCompleteInvitationCode("abcd2345efgh")).toBe(true);
    expect(isCompleteInvitationCode("ABCD-2345-EFG")).toBe(false);
    expect(isCompleteInvitationCode("")).toBe(false);
  });
});
