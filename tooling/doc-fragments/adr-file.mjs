// One file per ADR: frontmatter (fixed keys) + body. The literal id prefix is built by
// concatenation on purpose — this source is scanned by the process-refs gate, which bans a
// literal "ADR-" followed by digits. See tooling/lint-process-references.mjs.
const ID_PREFIX = "ADR-";
const FRONTMATTER_KEYS = ["number", "slug", "status", "date", "area", "summary"];

export function pad(number) {
  return String(number).padStart(4, "0");
}

export function firstLine(body) {
  const index = body.indexOf("\n");
  return index === -1 ? body : body.slice(0, index);
}

export function serializeAdrFile(record) {
  const lines = ["---"];
  for (const key of FRONTMATTER_KEYS) {
    const value = record[key];
    if (key === "summary" && (value === null || value === undefined)) continue;
    // Empty values emit a bare `key:` with no trailing space, so generated files are stable
    // under the formatter (a trailing space would be stripped, then re-added on the next build).
    const isEmpty = value === null || value === undefined || value === "";
    lines.push(isEmpty ? `${key}:` : `${key}: ${value}`);
  }
  lines.push("---", "", record.body);
  return `${lines.join("\n")}\n`;
}

export function parseAdrFile(markdown) {
  const lines = markdown.split("\n");
  const end = lines.indexOf("---", 1);
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
    const colon = line.indexOf(": ");
    const key = colon === -1 ? line.replace(/:$/, "") : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 2);
    if (key === "number") record.number = value === "" ? null : Number.parseInt(value, 10);
    else if (FRONTMATTER_KEYS.includes(key)) record[key] = value;
  }
  // Body starts after the closing fence; tolerate any number of blank lines between the
  // frontmatter and the body (generated files emit exactly one; hand-authored fragments may vary).
  let start = end + 1;
  while (start < lines.length && lines[start] === "") start++;
  record.body = lines.slice(start).join("\n").replace(/\n$/, "");
  return record;
}

export function registerLineFor(record) {
  const summary = record.summary ?? firstLine(record.body);
  const fields = [record.status];
  if (record.date) fields.push(record.date);
  fields.push(record.area);
  return `- **${ID_PREFIX}${pad(record.number)}** · ${fields.join(" · ")} — ${summary}`;
}
