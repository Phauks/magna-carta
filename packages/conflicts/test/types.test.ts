import { expect, test } from "vitest";
import {
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
  CONFLICTS_TRIGGERS,
  CONFLICTS_TRIGGER_SOURCES,
  DISPOSITION_KINDS,
} from "../src/types.ts";

test("the source-class catalog matches the four classes", () => {
  expect([...SOURCE_CLASSES]).toEqual(["party", "graph", "imputation", "content"]);
});

test("the disposition catalog covers every terminal outcome", () => {
  expect([...DISPOSITION_KINDS]).toEqual([
    "cleared",
    "waiver_obtained",
    "wall_erected",
    "representation_declined",
  ]);
});

test("the trigger catalog names every way a check can start", () => {
  // Each value names the EVENT that set a run going, never its outcome. Reading a check back has to
  // say which, because "run because two records were merged" and "run because somebody clicked" are
  // different claims about how thorough a firm's procedure is, and only the first one is a procedure.
  // The column carries a `length > 0` CHECK, so this list grows without a migration.
  expect([...CONFLICTS_TRIGGERS]).toEqual([
    "preliminary",
    "comprehensive",
    "new_party",
    "entity_merged",
    "entity_renamed",
    "relationship_recorded",
    "identifier_recorded",
    "personnel_changed",
    "periodic_rescan",
  ]);
});

test("a trigger source is recorded beside the actor, not derived from it", () => {
  // An absent actor says nobody is being credited with a run; it does not say whether a person, an
  // event, or the clock set it going. A report that reads "run automatically because entity X was
  // merged" needs the second fact, and the row has to carry it.
  expect([...CONFLICTS_TRIGGER_SOURCES]).toEqual(["manual", "event", "schedule"]);
});

test("strictness has exactly two levels", () => {
  expect([...STRICTNESS_LEVELS]).toEqual(["balanced", "over_inclusive"]);
});
