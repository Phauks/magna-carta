// @repo-wide-fitness — the catalogue lives here, but what it must never reach lives in
// packages/notes and packages/database's per-firm schema. The diff that would break this rule is a
// plausible-looking new catalogue entry, and it never touches those packages.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARY } from "../src/dictionary.ts";
import { MERGE_SUBJECTS } from "../src/catalog/subjects.ts";

// NO MERGE FIELD EVER RESOLVES TO A NOTE.
//
// This is the single highest-consequence leak this package could grow, and it is guarded
// mechanically because judgement will not hold it. Document assembly fills templates from matter
// data and the result goes out under the firm's letterhead — to an opposing party, to a court, to a
// client. A matter note is the opposite kind of text: the firm's candid internal assessment, written
// fast, and the most protected class of prose it produces.
//
// The PDF metadata scrub in crates/pdf-core/src/scrub.rs is structurally blind to this route. It
// removes document-level surfaces — the Info dictionary, XMP, embedded files, XFA, form values, the
// structure tree, bookmarks — and merge-filled text is none of those. It is page content. So the one
// machine built to stop privileged text escaping in a PDF would not see a leaked note at all.
//
// The rule is stated as a scan rather than left to review because the entry that breaks it will look
// entirely reasonable to whoever adds it: a "matter.latestNote" field is an obvious convenience, and
// the catalogue is a data table that grows by entries. Not the body, not the latest revision, not a
// count, not a concatenation — nothing.
//
// Notes reach a document by ONE deliberate route, and it is not this one: a person exports a note as
// a document into the matter's file record, which gives it a version, a hash and a custodian of
// record, and that is an attributable single act rather than a field somebody bound by accident.

// The per-firm tables the note primitive owns (packages/notes/src/note-statements.ts).
const NOTE_TABLES = ["matter_note", "matter_note_revision"];

// Words that would name a note-shaped fact in a merge key. Deliberately broader than the tables:
// a catalogue entry reaches its data through a batched read, so the key is where the intent shows up
// first, and "comment" and "memo" are the two words somebody reaching for this would use instead.
const NOTE_WORDS = ["note", "memo", "comment", "annotation"];

function mentionsNoteWord(value: string): string | undefined {
  const lowered = value.toLowerCase();
  return NOTE_WORDS.find((word) => lowered.includes(word));
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("no merge field resolves to a note", () => {
  it("no dictionary entry's key names a note", () => {
    const offenders = DICTIONARY.filter((entry) => mentionsNoteWord(entry.key) !== undefined).map(
      (entry) => entry.key,
    );
    expect(
      offenders,
      `these merge keys name a note-shaped fact; a note must never be assembled into a document: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no subject in the catalogue is a note", () => {
    const offenders = MERGE_SUBJECTS.filter(
      (subject) => mentionsNoteWord(subject.key) !== undefined,
    ).map((subject) => subject.key);
    expect(offenders, `these merge subjects name a note: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no batched read in this package reaches a note table", async () => {
    // The structural half of the guard: a catalogue entry can only surface what some read selects,
    // so a source scan for the table names catches a resolver added ahead of its catalogue entry —
    // which is the order this mistake would actually be made in.
    const files = await sourceFiles(join(import.meta.dirname, "..", "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const table of NOTE_TABLES) {
        // Word-bounded: `matter_note` must not match a longer identifier that merely contains it.
        if (new RegExp(String.raw`\b${table}\b`, "u").test(contents)) {
          offenders.push(`${file} reads ${table}`);
        }
      }
    }
    expect(
      offenders,
      `document assembly must not read a note table; export the note as a document instead: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
