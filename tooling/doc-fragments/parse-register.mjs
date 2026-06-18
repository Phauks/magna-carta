// Parse the Decision-Log register into structured records. The register is the generated
// surface; per-ADR files in docs/decisions/ are the canonical home (see docs/conventions/documentation.md).
const ADR_BULLET = /^- \*\*ADR-(\d+)\*\* · (.+)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The metadata fields and the body are split on the first " — " (space, em-dash, space).
const SEPARATOR = " — ";

export function parseRegisterLine(line) {
  const match = ADR_BULLET.exec(line.trimEnd());
  if (match === null) return null;
  const number = Number.parseInt(match[1], 10);
  const dashIndex = match[2].indexOf(SEPARATOR);
  if (dashIndex === -1) return null;
  const head = match[2].slice(0, dashIndex);
  const body = match[2].slice(dashIndex + SEPARATOR.length);
  const fields = head.split(" · ");
  const area = fields[fields.length - 1];
  const status = fields[0];
  const maybeDate = fields[fields.length - 2];
  const date = fields.length >= 3 && ISO_DATE.test(maybeDate) ? maybeDate : null;
  return { number, status, date, area, body };
}

export function parseRegister(markdown) {
  const entries = [];
  for (const line of markdown.split("\n")) {
    const entry = parseRegisterLine(line);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}
