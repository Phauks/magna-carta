// Measures the search across matters on a synthetic firm, so its two bounds are readings and not
// arguments: the cap on how many index matches one statement draws on, and the decision to match
// file names by reading the file table.
//
// It builds a migrated per-firm database, fills it with notes, time entries and files through
// ordinary inserts (so the record index is filled by its own triggers, as it is in a firm), and
// times the real statements the registry builds for a rare word, a word in about one record in a
// hundred, and a word in nearly every record, at several caps and with no cap at all.
//
// What it found is why run-across-matters.ts caps at 2,000 and why the files source may declare
// `reads: "names"`. Re-run it before changing either.
//
// The corpus is generated here from a fixed seed; it is not a firm's data and its timings are this
// machine's. Compare the rows with each other and never read a figure as a production latency. It
// touches no database but the in-memory one it creates.
//
// usage: node packages/matter-search/scripts/measure-across-matters.mts [record count, default 200000]

import { performance } from "node:perf_hooks";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { RECORD_QUERY_MATTERS_LIMIT } from "@magna-carta/search/record-index-query";
import type { MatterNarrowing } from "../src/narrowing.ts";
import { runSearchAcrossMatters } from "../src/run-across-matters.ts";
import { matterSearchSources } from "../src/sources/all.ts";

const RECORDS = Number(process.argv[2] ?? 200000);
const MATTERS = 400;
const INSTANT = "2026-08-01T00:00:00.000Z";
const ACTOR = "user_measure0000000";

let seed = 20261110;
function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

// A skewed vocabulary: a few words are in most records and most words are in few.
const SYLLABLES = [
  "ba",
  "re",
  "ti",
  "on",
  "ex",
  "qu",
  "ar",
  "mo",
  "ne",
  "sa",
  "lu",
  "vi",
  "co",
  "de",
];
const VOCABULARY = Array.from({ length: 20000 }, (_unused, index) => {
  let word = "";
  let rest = index + 7;
  do {
    word += SYLLABLES[rest % SYLLABLES.length];
    rest = Math.floor(rest / SYLLABLES.length);
  } while (rest > 0);
  return `${word}${String(index % 7)}`;
});
function word(): string {
  return VOCABULARY[Math.floor(random() ** 3 * VOCABULARY.length)] ?? "ba0";
}
function sentence(index: number): string {
  const words = Array.from({ length: 20 }, word);
  // Three planted words of known frequency.
  words.push("everywhere");
  if (index % 100 === 0) words.push("percentile");
  if (index % 20000 === 0) words.push("needle");
  return words.join(" ");
}

const { database, raw } = createMigratedNodeDatabase("per-firm");
const matterIds = Array.from(
  { length: MATTERS },
  (_unused, index) => `matter_measure${String(index).padStart(19, "0")}`,
);

raw.exec("BEGIN");
raw.exec(
  `INSERT INTO member (user_id, display_name, status, created_at) ` +
    `VALUES ('${ACTOR}', 'Measurer', 'active', '${INSTANT}')`,
);
for (const id of matterIds) {
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, system_key, opened_at, created_at, updated_at) ` +
      `VALUES ('${id}', 'Matter', 'open', '${ACTOR}', NULL, '${INSTANT}', '${INSTANT}', '${INSTANT}')`,
  );
}
const insertNote = raw.prepare(
  `INSERT INTO matter_note (id, matter_id, author_user_id, body, last_edited_by, occurred_on, ` +
    `occurred_at_time, time_zone, created_at, updated_at) VALUES (?, ?, '${ACTOR}', ?, NULL, NULL, NULL, NULL, ?, ?)`,
);
const insertTime = raw.prepare(
  `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, ` +
    `raw_duration_minutes, narrative, billable, currency, status, source, created_at, updated_at) ` +
    `VALUES (?, ?, '${ACTOR}', '2026-07-01', 30, 30, ?, 1, 'USD', 'draft', 'manual', ?, ?)`,
);
const insertFile = raw.prepare(
  `INSERT INTO file (id, matter_id, folder_id, name, edit_state, deleted_at, created_at, updated_at) ` +
    `VALUES (?, ?, NULL, ?, 'idle', NULL, ?, ?)`,
);
const started = performance.now();
for (let index = 0; index < RECORDS; index += 1) {
  const matter = matterIds[Math.floor(random() * MATTERS)] ?? matterIds[0]!;
  const suffix = String(index).padStart(12, "0");
  if (index % 2 === 0)
    insertNote.run(`matterNote_${suffix}`, matter, sentence(index), INSTANT, INSTANT);
  else insertTime.run(`timeEntry_${suffix}`, matter, sentence(index), INSTANT, INSTANT);
  insertFile.run(
    `file_${suffix}`,
    matter,
    `${word()} ${word()} ${String(index)}.pdf`,
    INSTANT,
    INSTANT,
  );
}
raw.exec("COMMIT");
console.log(
  `built ${String(RECORDS)} indexed records and ${String(RECORDS)} files over ${String(MATTERS)} matters ` +
    `in ${((performance.now() - started) / 1000).toFixed(1)} s`,
);

const visibility = visibleMatterPredicate();
const permissions = new Set(
  matterSearchSources
    .all()
    .map((source) => source.permission)
    .filter((permission) => permission !== null),
);

// A reader's narrowing to the first `count` matters, in the shape a caller hands one in.
function firstMatters(count: number): MatterNarrowing {
  const named = matterIds.slice(0, count);
  return {
    fragmentFor: (matterIdExpression) =>
      `${matterIdExpression} IN (${named.map(() => "?").join(", ")})`,
    bindings: named,
  };
}

async function time(
  label: string,
  query: string,
  sourceKeys: readonly string[],
  candidateCap: number,
  narrowing?: MatterNarrowing,
): Promise<void> {
  const repetitions = 10;
  const input = {
    database,
    registry: matterSearchSources,
    query,
    visibility,
    sourceKeys,
    permissions,
    limit: 5,
    candidateCap,
    ...(narrowing === undefined ? {} : { narrowing }),
  };
  let answer = await runSearchAcrossMatters(input);
  const begun = performance.now();
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    answer = await runSearchAcrossMatters(input);
  }
  const each = (performance.now() - begun) / repetitions;
  const hits = answer.groups.reduce((sum, group) => sum + group.hits.length, 0);
  console.log(
    `${label.padEnd(46)} ${each.toFixed(2).padStart(9)} ms   ${String(hits).padStart(3)} hits   ` +
      `broad=${String(answer.broad)}`,
  );
}

const PROSE = ["notes", "time", "costs", "communications"];
const NO_CAP = 1_000_000_000;

console.log("\nprose sources (the record index), by cap:");
for (const [name, query] of [
  ["a rare word", "needle"],
  ["a word in 1 record in 100", "percentile"],
  ["a word in every record", "everywhere"],
  ["two words, one in every record", "everywhere percentile"],
  ["a part-typed common word", "every"],
] as const) {
  for (const cap of [500, 2000, 10000, NO_CAP]) {
    await time(`${name}, cap ${cap === NO_CAP ? "none" : String(cap)}`, query, PROSE, cap);
  }
}

console.log("\nfile and folder names (a read of the file table):");
await time("a name no file has", "zzzzzz", ["files"], 2000);
await time("a syllable in many names", "ba", ["files"], 2000);
await time("a number in one name", "199999.pdf", ["files"], 2000);

// A search its reader narrowed. Up to the number of matters one question names, the matters are
// named to the index and the cap is over their records; past it the index is asked the firm-wide
// way and the narrowing is applied to what the cap admitted.
console.log(
  `\na narrowed search, cap 2000 (matters named to the index up to ${String(RECORD_QUERY_MATTERS_LIMIT)}):`,
);
for (const [name, query] of [
  ["a word in every record", "everywhere"],
  ["a word in 1 record in 100", "percentile"],
] as const) {
  for (const count of [1, 5, RECORD_QUERY_MATTERS_LIMIT, 150]) {
    await time(`${name}, ${String(count)} matters`, query, PROSE, 2000, firstMatters(count));
  }
}
await time("a syllable in many file names, 5 matters", "ba", ["files"], 2000, firstMatters(5));
await time("a syllable in many file names, 150 matters", "ba", ["files"], 2000, firstMatters(150));
