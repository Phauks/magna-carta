// One file per decision: frontmatter (fixed keys) + body. The literal id prefix is built by
// concatenation on purpose — this source is scanned by the process-refs gate, which bans a
// literal "ADR-" followed by digits. See tooling/lint-process-references.mjs.
const ID_PREFIX = "ADR-";
const FRONTMATTER_KEYS = ["number", "slug", "status", "date", "area", "summary"];
// What an author writes in a pending fragment. `number` is assigned by the assembler at merge, so
// naming it in the "you are missing the fence" message would invite an author to invent one.
const AUTHORED_KEYS = ["slug", "status", "area", "date", "summary"];
const FENCE = "---";

// The register's status lifecycle. A status may carry a qualifier after the lifecycle word
// ("Superseded by …", "Accepted (amended …)"), and it may be quoted when it contains a character
// the frontmatter reader would otherwise take for punctuation, so only the leading word is checked.
const LIFECYCLE = ["Proposed", "Accepted", "Superseded", "Deprecated", "Rejected"];
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function pad(number) {
  return String(number).padStart(4, "0");
}

export function firstLine(body) {
  const index = body.indexOf("\n");
  return index === -1 ? body : body.slice(0, index);
}

export function serializeAdrFile(record) {
  const lines = [FENCE];
  for (const key of FRONTMATTER_KEYS) {
    const value = record[key];
    if (key === "summary" && (value === null || value === undefined)) continue;
    // Empty values emit a bare `key:` with no trailing space, so generated files are stable
    // under the formatter (a trailing space would be stripped, then re-added on the next build).
    const isEmpty = value === null || value === undefined || value === "";
    lines.push(isEmpty ? `${key}:` : `${key}: ${value}`);
  }
  lines.push(FENCE, "", record.body);
  return `${lines.join("\n")}\n`;
}

// Structural read of a decision file. It THROWS rather than returning a half-built record, because
// the frontmatter is the only place the register's status/date/area come from: a file that opens
// with a title instead of a frontmatter fence used to parse "successfully" into a record whose
// fields were all empty and whose body still carried the title, and the register then rendered a
// bullet with two empty fields and the title standing in for the decision. Silent degradation of a
// generated document is worse than a failed build, so every malformed shape stops the assembly.
export function parseAdrFile(markdown, context = "decision file") {
  const lines = markdown.split("\n");
  if (lines[0] !== FENCE) {
    throw new Error(
      `${context}: missing the opening \`${FENCE}\` frontmatter fence — a decision file starts with frontmatter (${AUTHORED_KEYS.join(", ")}), not with a Markdown title`,
    );
  }
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    throw new Error(`${context}: missing the closing \`${FENCE}\` frontmatter fence`);
  }
  const record = {
    number: null,
    slug: "",
    status: "",
    date: "",
    area: "",
    summary: null,
    body: "",
  };
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(": ");
    const key = colon === -1 ? line.replace(/:$/, "") : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 2);
    if (!FRONTMATTER_KEYS.includes(key)) {
      throw new Error(
        `${context}: unknown frontmatter line "${line}" (expected one of ${FRONTMATTER_KEYS.join(", ")}, each written as \`key: value\`)`,
      );
    }
    if (key === "number") record.number = value === "" ? null : Number.parseInt(value, 10);
    else record[key] = value;
  }
  // Body starts after the closing fence; tolerate any number of blank lines between the
  // frontmatter and the body (generated files emit exactly one; hand-authored fragments may vary).
  let start = end + 1;
  while (start < lines.length && lines[start] === "") start++;
  record.body = lines.slice(start).join("\n").replace(/\n$/, "");
  return record;
}

// The text the register bullet ends with: the explicit summary when the author wrote one, else the
// body's opening line.
export function summaryFor(record) {
  return record.summary ?? firstLine(record.body);
}

function unquote(value) {
  return value.replace(/^["']/, "").replace(/["']$/, "").trim();
}

// Semantic checks on a parsed record, returned as a list so a caller can report every problem in a
// file at once. Structural problems are already impossible here — parseAdrFile threw on those.
export function validateAdrRecord(record, context = "decision file") {
  const problems = [];
  const requireField = (key, hint) => {
    if (!record[key] || record[key].trim() === "") {
      problems.push(`${context}: ${key} is empty — ${hint}`);
    }
  };
  requireField(
    "slug",
    "it names the file and is how other documents reference the decision before it is numbered",
  );
  requireField(
    "status",
    `one of ${LIFECYCLE.join(", ")} (a qualifier may follow, e.g. "Superseded by …")`,
  );
  requireField("area", "the subsystem or topic the register bullet labels the decision with");

  const status = unquote(record.status);
  const startsWithLifecycleWord = LIFECYCLE.some(
    (word) => status === word || status.startsWith(`${word} `) || status.startsWith(`${word}(`),
  );
  if (status !== "" && !startsWithLifecycleWord) {
    problems.push(
      `${context}: status "${record.status}" does not start with a lifecycle word (${LIFECYCLE.join(", ")})`,
    );
  }

  if (record.date && !DATE_SHAPE.test(record.date.trim())) {
    problems.push(`${context}: date "${record.date}" is not YYYY-MM-DD`);
  }

  const summary = summaryFor(record).trim();
  if (summary === "") {
    problems.push(
      `${context}: nothing to render in the register — give the file a \`summary:\` or a body whose first line states the decision`,
    );
  } else if (summary.startsWith("#")) {
    problems.push(
      `${context}: the register line would render the body's Markdown heading ("${summary}") as the decision — put the title in \`summary:\` and open the body with the decision itself`,
    );
  }
  return problems;
}

export function assertValidAdrRecord(record, context = "decision file") {
  const problems = validateAdrRecord(record, context);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return record;
}

// Parse and validate a whole set at once — the shape both the assembler and the governance gate
// need. Every file is reported, not just the first offender: an author fixing one fragment should
// see every problem in one run, and the assembler must know the whole set is sound BEFORE it starts
// consuming fragments, since folding a fragment deletes it.
export function collectAdrRecords(entries) {
  const records = new Map();
  const problems = [];
  for (const { key, context, markdown } of entries) {
    let record;
    try {
      record = parseAdrFile(markdown, context);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    const found = validateAdrRecord(record, context);
    if (found.length > 0) problems.push(...found);
    else records.set(key ?? context, record);
  }
  return { records, problems };
}

export function registerLineFor(record) {
  const fields = [record.status];
  if (record.date) fields.push(record.date);
  fields.push(record.area);
  return `- **${ID_PREFIX}${pad(record.number)}** · ${fields.join(" · ")} — ${summaryFor(record)}`;
}
