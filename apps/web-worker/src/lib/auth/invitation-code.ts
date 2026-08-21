/*
 * How an invitation code is shown while it is being typed, and what is sent when it is submitted.
 *
 * The code is generated as twelve unbroken characters over an alphabet with no confusable glyphs
 * (apps/api-worker/src/joining-secrets.ts). Two facts about the server side decide everything here:
 *
 *   1. It NORMALIZES before it hashes — uppercased, and everything that is not a letter or a digit
 *      removed. So the surface is free to group the characters for the eye, and free to accept a
 *      code pasted with whatever spacing it picked up on the way, because none of it survives to
 *      the comparison.
 *   2. It carries NO prefix. The artifact these screens were transposed from renders the code with
 *      a generated, non-deletable `MCINV-` inside the field, which is a good idea for a code found
 *      loose in a drawer — and it is deliberately NOT implemented, for the same reason the recovery
 *      field does not carry `MCREC-`: a prefix the generator has never emitted would be typed into
 *      every code and normalize into the digest, so every real code would be refused. The prefix
 *      belongs to the change that puts it in the generator, not to this field.
 *
 * Grouping in fours is the one liberty taken, and it is free: twelve characters in three groups are
 * read back and checked against a printed invitation far faster than twelve in a row.
 */

/** How many characters the generator emits, before any grouping. */
export const INVITATION_CODE_LENGTH = 12;

/** How many characters sit between the separators the field renders. */
const GROUP_SIZE = 4;

const SEPARATOR = "-";

/**
 * A typed or pasted code reduced to the form the server hashes: uppercased, with everything that is
 * not a letter or a digit removed. Mirrors `normalizeInvitationCode` in
 * apps/api-worker/src/joining-secrets.ts — the two must agree, or a code the field accepted would be
 * refused by the comparison.
 */
export function normalizeInvitationCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * What the field shows: the normalized characters, capped at the generated length, grouped in
 * fours. Applied on every keystroke, so a trailing separator is never inserted ahead of the
 * character that would follow it — an eagerly-added separator puts the caret behind punctuation the
 * person did not type and has to delete.
 */
export function formatInvitationCode(code: string): string {
  const characters = normalizeInvitationCode(code).slice(0, INVITATION_CODE_LENGTH);
  const groups: string[] = [];
  for (let index = 0; index < characters.length; index += GROUP_SIZE) {
    groups.push(characters.slice(index, index + GROUP_SIZE));
  }
  return groups.join(SEPARATOR);
}

/**
 * Whether the field holds a whole code. This gates the submit button and NOTHING else: it is a
 * "you have not finished typing" check, never a verdict on the code, which only the server can
 * give and only as part of one indivisible answer about all three facts.
 */
export function isCompleteInvitationCode(code: string): boolean {
  return normalizeInvitationCode(code).length === INVITATION_CODE_LENGTH;
}
