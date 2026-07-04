import { expect, test } from "vitest";
import { emptyAuthored, emptyDerived, parseAuthored, parseDerived } from "../src/schema.ts";

const NOW = "2026-07-02T00:00:00.000Z";

test("empty docs carry the schema version and are valid", () => {
  expect(emptyDerived(NOW)).toMatchObject({ schemaVersion: 1, components: [], providers: [] });
  expect(emptyAuthored(NOW)).toMatchObject({ schemaVersion: 1, events: [], overrides: [] });
});

test("parse returns an empty doc for null or garbage, never throws", () => {
  expect(parseDerived(null, NOW)).toEqual(emptyDerived(NOW));
  expect(parseDerived("{not json", NOW)).toEqual(emptyDerived(NOW));
  expect(parseAuthored('{"schemaVersion":999}', NOW)).toEqual(emptyAuthored(NOW));
});

test("parse round-trips a valid derived doc", () => {
  const doc = {
    schemaVersion: 1,
    generatedAt: NOW,
    components: [
      {
        id: "worker",
        name: "API",
        group: "Core",
        status: "operational",
        source: "probe",
        lastChange: NOW,
      },
    ],
    providers: [],
  };
  expect(parseDerived(JSON.stringify(doc), NOW)).toEqual(doc);
});
