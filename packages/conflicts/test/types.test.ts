import { expect, test } from "vitest";
import {
  SOURCE_CLASSES,
  STRICTNESS_LEVELS,
  CONFLICTS_TRIGGERS,
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

test("the trigger catalog matches the four documented triggers", () => {
  expect([...CONFLICTS_TRIGGERS]).toEqual([
    "preliminary",
    "comprehensive",
    "new_party",
    "periodic_rescan",
  ]);
});

test("strictness has exactly two levels", () => {
  expect([...STRICTNESS_LEVELS]).toEqual(["balanced", "over_inclusive"]);
});
