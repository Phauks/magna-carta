import { pad, parseAdrFile, serializeAdrFile } from "./adr-file.mjs";
import { parseRegister } from "./parse-register.mjs";

const STOP_WORDS = new Set(["the", "a", "an", "of", "for", "and", "to", "with"]);

export function slugFor(entry) {
  const words = `${entry.area} ${entry.body}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
  return words.slice(0, 6).join("-");
}

export function planMigration(registerMarkdown) {
  const seen = new Map();
  return parseRegister(registerMarkdown).map((entry) => {
    let slug = slugFor(entry);
    if (seen.has(slug)) slug = `${slug}-${pad(entry.number)}`;
    seen.set(slug, true);
    return {
      number: entry.number,
      slug,
      status: entry.status,
      date: entry.date ?? "",
      area: entry.area,
      summary: null,
      body: entry.body,
      path: `docs/decisions/${pad(entry.number)}-${slug}.md`,
    };
  });
}

export function roundTripOk(registerMarkdown) {
  const original = parseRegister(registerMarkdown);
  const planned = planMigration(registerMarkdown);
  const reparsed = planned.map((record) => parseAdrFile(serializeAdrFile(record)));
  const key = (record) =>
    JSON.stringify([record.number, record.status, record.date || null, record.area, record.body]);
  const originalKeys = original.map((entry) => key({ ...entry, date: entry.date })).sort();
  const reparsedKeys = reparsed.map(key).sort();
  return JSON.stringify(originalKeys) === JSON.stringify(reparsedKeys);
}
