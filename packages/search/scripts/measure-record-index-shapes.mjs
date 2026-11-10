// Measures the shapes the record index could take, on a synthetic firm, so the choice between them
// is a reading and not an argument.
//
// It builds the same corpus three ways — the matter and the source as tokens with prefix indexes,
// the same without prefix indexes, and with no scope column at all — and reports, for each, the
// size of the full-text index against the size of the text, and the time of the questions the index
// exists to answer beside the substring scan each one replaces: a rare word, a phrase, a
// mid-frequency word and a word in most records, across the firm and inside one busy matter.
//
// What it found is why record-index-schema.ts carries the matter as a token, the source as a column
// on the entry row, and no prefix indexes. Re-run it before changing any of the three.
//
// The corpus is generated here from a fixed seed with a skewed vocabulary; it is not a firm's data
// and its timings are this machine's. Compare the shapes with each other, on one machine, and never
// read a figure as a production latency. It touches no database but the in-memory ones it creates.
//
// usage: node packages/search/scripts/measure-record-index-shapes.mjs [record count, default 200000]

import { DatabaseSync } from "node:sqlite";
// ROWS records over MATTERS matters, with a skewed vocabulary so words range from rare to everywhere.
const ROWS = Number(process.argv[2] ?? 200000),
  MATTERS = 400,
  VOCAB = 30000,
  WORDS = 25;
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const syll = [
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
  "fi",
  "gra",
  "pli",
  "str",
  "ent",
  "ous",
  "ing",
  "ment",
  "al",
  "er",
  "ist",
  "um",
  "ia",
  "or",
  "ke",
  "zu",
];
const vocab = Array.from({ length: VOCAB }, (_, i) => {
  let w = "",
    n = 2 + (i % 3);
  let x = i * 7919 + 13;
  for (let k = 0; k < n; k++) {
    w += syll[x % syll.length];
    x = Math.floor(x / syll.length) + i;
  }
  return w + (i % 97 === 0 ? "" : String.fromCharCode(97 + (i % 26)));
});
const zipf = () => Math.min(VOCAB - 1, Math.floor(Math.exp(rnd() * Math.log(VOCAB)) - 1));
const text = () => {
  const out = [];
  for (let i = 0; i < WORDS; i++) out.push(vocab[zipf()]);
  return out.join(" ");
};
const hex = (s) => Buffer.from(s).toString("hex");
function build(variant) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE rec (id TEXT PRIMARY KEY, matter_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX rec_matter ON rec(matter_id);
  CREATE TABLE entry (id INTEGER PRIMARY KEY, source TEXT NOT NULL, record_id TEXT NOT NULL, matter_id TEXT, sort_key TEXT NOT NULL); CREATE UNIQUE INDEX e1 ON entry(source, record_id);`);
  const cols = variant.scope ? "scope, title, body" : "title, body";
  db.exec(
    `CREATE VIRTUAL TABLE fts USING fts5(${cols}, content='', contentless_delete=1, tokenize="unicode61 remove_diacritics 2"${variant.prefix ? `, prefix='${variant.prefix}'` : ""}${variant.detail ? `, detail=${variant.detail}` : ""});`,
  );
  seed = 12345;
  const ir = db.prepare("INSERT INTO rec VALUES (?,?,?)"),
    ie = db.prepare(
      "INSERT INTO entry (id, source, record_id, matter_id, sort_key) VALUES (?,?,?,?,?)",
    );
  const ifts = db.prepare(
    variant.scope
      ? "INSERT INTO fts (rowid, scope, title, body) VALUES (?,?,NULL,?)"
      : "INSERT INTO fts (rowid, title, body) VALUES (?,NULL,?)",
  );
  db.exec("BEGIN");
  let bytes = 0;
  const t0 = performance.now();
  for (let i = 1; i <= ROWS; i++) {
    // matter 0 is the busy one with 3000 rows spread through time; the rest are spread evenly
    const m =
      i % Math.floor(ROWS / 3000) === 0
        ? "matter_busy000000000000000000000"
        : `matter_${String(Math.floor(rnd() * MATTERS)).padStart(26, "0")}`;
    const src = i % 3 === 0 ? "notes" : "time";
    let b = text();
    if (i === Math.floor(ROWS / 2)) b += " zyzzogeton herrera";
    if (i % 5000 === 0) b += " maria herrera";
    bytes += b.length;
    ir.run(`r_${i}`, m, b);
    ie.run(i, src, `r_${i}`, m, "2026-01-01");
    if (variant.scope) ifts.run(i, `src${src} m${hex(m)}`, b);
    else ifts.run(i, b);
  }
  db.exec("COMMIT");
  const buildMs = performance.now() - t0;
  db.exec("INSERT INTO fts(fts) VALUES('optimize')");
  const size = db.prepare("SELECT SUM(length(block)) AS n FROM fts_data").get().n;
  return { db, bytes, size, buildMs };
}
function time(db, sql, args, reps = 30) {
  const st = db.prepare(sql);
  let n = 0;
  st.all(...args);
  const t = performance.now();
  for (let k = 0; k < reps; k++) n = st.all(...args).length;
  return `${((performance.now() - t) / reps).toFixed(3)} ms (${n} rows)`;
}
const BUSY = "matter_busy000000000000000000000";
const common = vocab[3],
  mid = vocab[400],
  rare = "zyzzogeton";
for (const variant of [
  { name: "scope+prefix23", scope: true, prefix: "2 3" },
  { name: "scope,no-prefix", scope: true },
  { name: "noscope,no-prefix", scope: false },
]) {
  const { db, bytes, size, buildMs } = build(variant);
  console.log(
    `\n== ${variant.name}: rows ${ROWS}, text ${(bytes / 1e6).toFixed(1)} MB, index ${(size / 1e6).toFixed(1)} MB (${((size / bytes) * 100).toFixed(0)}% of text), build ${buildMs.toFixed(0)} ms`,
  );
  const J = "FROM fts JOIN entry ON entry.id = fts.rowid";
  for (const [label, w] of [
    ["rare", rare],
    ["phrase", '"maria herrera"'],
    ["mid", mid],
    ["common", common],
  ]) {
    const q = w.startsWith('"') ? w : `"${w}"`;
    console.log(
      ` firm-wide ${label}: LIKE ${time(db, "SELECT id FROM rec WHERE body LIKE ? LIMIT 51", [`%${w.replace(/"/g, "")}%`], 3)}`,
    );
    console.log(
      `   fts plain ranked: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? ORDER BY fts.rank LIMIT 51`, [`{title body}:(${q})`])}`,
    );
    console.log(
      `   fts plain + entry.source filter ranked: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? AND entry.source = 'time' ORDER BY fts.rank LIMIT 51`, [`{title body}:(${q})`])}`,
    );
    if (variant.scope)
      console.log(
        `   fts scope-source token ranked: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? ORDER BY fts.rank LIMIT 51`, [`scope:("srctime") AND {title body}:(${q})`])}`,
      );
    console.log(
      ` in-matter ${label}: LIKE ${time(db, "SELECT id FROM rec WHERE matter_id = ? AND body LIKE ? LIMIT 51", [BUSY, `%${w.replace(/"/g, "")}%`])}`,
    );
    console.log(
      `   fts + entry.matter_id filter: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? AND entry.matter_id = ? LIMIT 51`, [`{title body}:(${q})`, BUSY])}`,
    );
    if (variant.scope)
      console.log(
        `   fts scope-matter token: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? LIMIT 51`, [`scope:"m${hex(BUSY)}" AND {title body}:(${q})`])}`,
      );
  }
  console.log(
    ` prefix 'he*' firm-wide ranked: ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? ORDER BY fts.rank LIMIT 51`, ['{title body}:("he"*)'], 5)} ; 'herr*': ${time(db, `SELECT entry.record_id ${J} WHERE fts MATCH ? ORDER BY fts.rank LIMIT 51`, ['{title body}:("herr"*)'], 5)}`,
  );
  db.close();
}

// The alternative that would have kept substring matching: a trigram index. Size only — it is the
// size that decided against it — over a quarter of the records, which is enough for a ratio.
{
  seed = 12345;
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE VIRTUAL TABLE fts USING fts5(body, content='', contentless_delete=1, tokenize="trigram")`,
  );
  const insert = db.prepare("INSERT INTO fts (rowid, body) VALUES (?, ?)");
  let bytes = 0;
  db.exec("BEGIN");
  for (let i = 1; i <= Math.floor(ROWS / 4); i++) {
    const b = text();
    bytes += b.length;
    insert.run(i, b);
  }
  db.exec("COMMIT");
  db.exec("INSERT INTO fts(fts) VALUES('optimize')");
  const size = db.prepare("SELECT SUM(length(block)) AS n FROM fts_data").get().n;
  console.log(
    `\n== trigram (size only): text ${(bytes / 1e6).toFixed(1)} MB, index ${(size / 1e6).toFixed(1)} MB (${((size / bytes) * 100).toFixed(0)}% of text)`,
  );
  db.close();
}
