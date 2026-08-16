import { expect, test } from "vitest";
import {
  LEGAL_ENTITY_FORMS,
  normalizedMatchKey,
  normalizedMatchKeyBare,
} from "../src/match-key.ts";
import { normalizeName } from "../src/normalize-name.ts";

// The case that motivated the whole channel. `normalizeName` is frozen, and under it these two
// strings are `smith jones llp` and `smith and jones l l p` — not equal, so a conflicts check holding
// one and searching for the other reaches it only through trigram overlap, buried under every other
// name in the corpus sharing a three-character window.
test("the same firm written two ways is one match key", () => {
  expect(normalizeName("Smith & Jones LLP")).not.toBe(normalizeName("Smith and Jones, L.L.P."));
  expect(normalizedMatchKey("Smith & Jones LLP")).toBe("smith jones llp");
  expect(normalizedMatchKey("Smith and Jones, L.L.P.")).toBe("smith jones llp");
});

test("a different legal form is a different match key, and the same bare key", () => {
  // The distinction the match key keeps: a partnership and a limited company are different legal
  // persons until somebody establishes otherwise, so they must not read as the same name.
  expect(normalizedMatchKey("Smith & Jones LLP")).not.toBe(normalizedMatchKey("Smith & Jones LLC"));
  // The question the bare key raises: they may be one firm re-formed. Surfaced, never answered.
  expect(normalizedMatchKeyBare("Smith & Jones LLP")).toBe("smith jones");
  expect(normalizedMatchKeyBare("Smith & Jones LLC")).toBe("smith jones");
});

test("legal-entity spellings canonicalize to one token, longest phrase first", () => {
  expect(normalizedMatchKey("Acme Incorporated")).toBe("acme inc");
  expect(normalizedMatchKey("Acme Inc.")).toBe("acme inc");
  expect(normalizedMatchKey("Acme Corporation")).toBe("acme corp");
  expect(normalizedMatchKey("Acme Limited")).toBe("acme ltd");
  // `limited liability company` must not match the shorter `limited` and leave `liability company`.
  expect(normalizedMatchKey("Acme Limited Liability Company")).toBe("acme llc");
  expect(normalizedMatchKey("Acme Limited Liability Partnership")).toBe("acme llp");
  expect(normalizedMatchKey("Acme P.L.L.C.")).toBe("acme pllc");
});

test("a leading article and an interior connector carry no information", () => {
  expect(normalizedMatchKey("The Acme Corporation")).toBe("acme corp");
  expect(normalizedMatchKey("Acme Corporation")).toBe("acme corp");
  expect(normalizedMatchKey("Baker and Baker LLP")).toBe("baker baker llp");
  expect(normalizedMatchKey("Baker & Baker LLP")).toBe("baker baker llp");
});

test("a name that IS a connector or an article keeps it — normalizing is not renaming", () => {
  // `and` is dropped only in the interior position a connector occupies. At either end it is being
  // used as a name part, and removing it would be rewriting somebody's name.
  expect(normalizedMatchKey("And Sons")).toBe("and sons");
  expect(normalizedMatchKey("Sons and")).toBe("sons and");
  expect(normalizedMatchKey("The")).toBe("the");
});

test("both keys are idempotent — layering them on their own output changes nothing", () => {
  const names = [
    "Smith & Jones LLP",
    "Smith and Jones, L.L.P.",
    "The Acme Limited Liability Company",
    "Nguyen",
    "O'Brien & Sons Pty",
    "Bartholomew Q. Cathermore III",
  ];
  for (const name of names) {
    const key = normalizedMatchKey(name);
    expect(normalizedMatchKey(key)).toBe(key);
    const bare = normalizedMatchKeyBare(name);
    expect(normalizedMatchKeyBare(bare)).toBe(bare);
    // And stable: the same input always yields the same key, since both are stored at write time and
    // compared against at read time by two different code paths.
    expect(normalizedMatchKey(name)).toBe(key);
  }
});

test("neither key is ever empty for a name the frozen normalization keeps", () => {
  // An emptied key would silently match every other emptied key in the corpus, which is a channel
  // producing hits that mean nothing. The bare key falls back rather than emptying.
  for (const name of ["The Company", "LLC", "Ltd", "The", "Inc."]) {
    expect(normalizeName(name).length).toBeGreaterThan(0);
    expect(normalizedMatchKey(name).length).toBeGreaterThan(0);
    expect(normalizedMatchKeyBare(name).length).toBeGreaterThan(0);
  }
  // A string the frozen normalization empties has nothing to key, and says so rather than inventing.
  expect(normalizeName("!!!")).toBe("");
  expect(normalizedMatchKey("!!!")).toBe("");
  expect(normalizedMatchKeyBare("!!!")).toBe("");
});

test("every canonical form in the table is itself a stable key", () => {
  // Adding a form is one entry, and this is what stops a badly-shaped one landing: the canonical
  // spelling has to be a token the table also recognizes, or the key would depend on which spelling
  // the corpus happened to store.
  for (const form of LEGAL_ENTITY_FORMS) {
    expect(normalizedMatchKey(`Acme ${form.tokens.join(" ")}`)).toBe(`acme ${form.canonical}`);
    expect(normalizedMatchKeyBare(`Acme ${form.tokens.join(" ")}`)).toBe("acme");
  }
});
