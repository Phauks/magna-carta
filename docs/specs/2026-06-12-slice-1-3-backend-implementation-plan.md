# Slice 1·3 — Directory — backend implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@magna-carta/directory` domain package and its Worker surface — the firm's SSOT graph of Person/Organization entities, queryable name history with phonetic + trigram search, `protected()` sensitive identifiers, the typed-edge graph, entry-time duplicate prevention, non-destructive merge, and the live `matter_party` wiring — backend only.

**Architecture:** A new per-firm-D1 domain package on the ADR-0071 structure-vs-access seam, composing into the slice-0·2 atomic `batch()` exactly as `@magna-carta/ledger`/`@magna-carta/matters` do. Two equal-depth node tables (`directory_person`/`directory_organization`) + one typed `directory_edge` table; all names live in `directory_name` rows with write-time Double Metaphone codes and an FTS5 trigram index; sensitive identifiers ride the 1·2 `protected()` machinery; merge is non-destructive with an append-only `entity_merge` event. Per the design spec [`2026-06-12-slice-1-3-directory-design.md`](2026-06-12-slice-1-3-directory-design.md) (ADR-0085–0087).

**Tech Stack:** TypeScript, Drizzle (per-firm lineage), D1/SQLite (FTS5 trigram), `words/double-metaphone` (pinned), Vitest over `@magna-carta/database/node-sqlite`, Hono + `@hono/zod-openapi` (the 0·5 chokepoint).

**Build gates (must be landed before execution):** slice 1·1 backend (`matter`, `matter_party` _not yet created_ — this slice creates it, `setting`, `audit_log`, the per-firm migration sequence), slice 1·2 (`@magna-carta/encryption`, the `data-access` `protectedField`/`readProtected`/`blindIndexValue` API + the policy table), slice 0·5 (the OpenAPI `defineOpenAPIRoute` chokepoint + problem module). **At execution time, confirm the exact signatures of `protectedField`/`readProtected`/`blindIndexValue` (1·2) and the `matter` table + `composeEffectBatch`/`runIdempotentEffect` (0·2/1·1) against their landed code — the references below are to their spec'd shapes.**

**Model attribution:** Directory is core-domain (not financial-ledger or crypto-primitive — it _consumes_ 1·2's crypto, does not build it), so the build is "Opus builds → Fable reviews" territory like 1·1 — but the build-model choice is the owner's at execution time per the model-split policy.

---

## File structure

```
packages/directory/
  package.json                     # @magna-carta/directory; deps: identifiers, database, data-access; words/double-metaphone
  vitest.config.ts
  CLAUDE.md                        # local rules (per-area template)
  src/
    types.ts                       # branded ids (dpe_/dor_/dnm_/ded_/eme_/…), enums, domain types
    normalize-name.ts              # frozen name normalization (NFC/case/punct/diacritic/suffix)
    phonetics.ts                   # Double Metaphone scheme-keyed code computation (seam over words/double-metaphone)
    statements.ts                  # SQL statement builders (insert/update/repoint) for the atomic batch
    person.ts                      # createPerson / readPerson / updatePerson
    organization.ts                # createOrganization / readOrganization / updateOrganization
    name-history.ts                # addName / changeName (append-and-flip) / former-name rows
    search.ts                      # FTS5 trigram search + the candidate-generation query (phonetic ∪ trigram ∪ blind-index)
    identifiers.ts                 # protectedField declarations + identifier row read/write + EIN policy note
    edges.ts                       # createEdge / readEdges (typed, temporal)
    categories.ts                  # category definitions + entity_category links
    merge.ts                       # mergeEntities (non-destructive, repoint, entity_merge event, survivorship)
    party.ts                       # matter_party links + party-role list
    fitness.ts                     # table-wide fitness queries + assertDirectoryFitness
    index.ts                       # public exports
  test/                            # mirrors src/ + schema-name-sync.test.ts + no-plaintext-escape source scan
packages/database/drizzle/per-firm/
  <next>_directory.sql             # migration (number assigned against the landed sequence)
  schema/per-firm/directory.ts     # drizzle schema (follow the existing per-firm schema file layout)
packages/fixtures/src/load-profile/
  profiles/directory-volume.ts     # the Directory volume profile (accretion rule)
apps/worker/src/routes/
  directory.ts                     # /v1/directory/* routes via defineOpenAPIRoute
```

---

## Task 1: Schema + migration

**Files:**

- Create: `packages/database/drizzle/schema/per-firm/directory.ts` (drizzle schema — follow the existing per-firm schema file's column/index idioms)
- Create: `packages/database/drizzle/per-firm/<next>_directory.sql` (generated via drizzle-kit, then committed; `--> statement-breakpoint` between statements)
- Test: `packages/database/test/per-firm-directory-migration.test.ts`

Tables (per-firm; all primary keys are TEXT identifier handles per ADR-0062; no REAL columns per ADR-0061; soft-delete = `deleted_at text`):

- `directory_person` (`id` PK `dpe_`, `name_prefix`,`name_given`,`name_middle`,`name_family`,`name_suffix`,`display_name`, `dob_ciphertext`,`dob` — protected, no blind index, `member_id` nullable, `created_at`,`updated_at`,`deleted_at`)
- `directory_organization` (`id` PK `dor_`, `legal_name`,`display_name`, `ein_ciphertext`,`ein_blind_index`, timestamps, `deleted_at`)
- `directory_name` (`id` PK `dnm_`, `entity_id`, `entity_kind` `'person'|'organization'`, `name_role` TEXT CHECK, structured parts, `normalized_display`, `is_current` integer 0/1, `valid_from`,`valid_to`, timestamps, `deleted_at`) — indexes on `(entity_id)`, `(normalized_display)`
- `directory_name_phonetic_code` (`name_id`, `scheme` TEXT CHECK, `code`) — PK `(name_id, scheme)`, index `(scheme, code)`
- `directory_name_fts` — FTS5 virtual table `USING fts5(normalized_display, content='directory_name', content_rowid='rowid', tokenize='trigram')` + the three sync triggers (insert/update/delete)
- `directory_identifier` (`id` PK `did_`, `entity_id`, `identifier_type` TEXT CHECK, `value_ciphertext`, `value_blind_index` nullable, `valid_from`,`valid_to`, timestamps, `deleted_at`) — index `(identifier_type, value_blind_index)`
- `directory_edge` (`id` PK `ded_`, `from_entity_id`,`to_entity_id`,`edge_type` TEXT CHECK, `role`, `note`, `valid_from`,`valid_to`, timestamps, `deleted_at`) — indexes `(from_entity_id)`,`(to_entity_id)`
- `directory_category` (`id` PK `dct_`, `name`, `applies_to` `'person'|'organization'|'both'`, `position`, `archived`, timestamps) and `directory_entity_category` (`entity_id`,`category_id`, PK both)
- `directory_email` / `directory_phone` / `directory_address` (entity_id, type/label, value(s), `is_primary`, `valid_from`/`valid_to`, soft-delete; address uses the ADR-0031 structured fields)
- `directory_party_role` (`id` PK `dpr_`, `name`, `archived`, `position`) and `matter_party` (`id` PK `mtp_`, `matter_id`, `entity_id`, `role`, `valid_from`,`valid_to`, timestamps, `deleted_at`) — indexes `(matter_id)`,`(entity_id)`
- `entity_merge` (`id` PK `eme_`, `master_id`, `subordinate_id`, `survivorship` text JSON, `repointed` text JSON, `merged_at`, `merged_by`) — append-only

- [ ] **Step 1: Write the failing migration test**

```ts
// packages/database/test/per-firm-directory-migration.test.ts
import { test, expect } from "vitest";
import { createLocalPerFirmDatabase } from "@magna-carta/database/node-sqlite";

test("directory migration creates the node, name, edge, identifier and merge tables", async () => {
  const db = await createLocalPerFirmDatabase(); // applies all committed per-firm migrations
  const tables = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  const names = tables.map((t) => t.name);
  for (const t of [
    "directory_person",
    "directory_organization",
    "directory_name",
    "directory_name_phonetic_code",
    "directory_identifier",
    "directory_edge",
    "directory_category",
    "directory_entity_category",
    "matter_party",
    "entity_merge",
  ]) {
    expect(names).toContain(t);
  }
  // FTS5 trigram virtual table exists and is queryable
  await db.run("INSERT INTO directory_name_fts(directory_name_fts) VALUES('integrity-check')");
});
```

- [ ] **Step 2: Run it; expect FAIL** — `pnpm --filter @magna-carta/database test per-firm-directory-migration` → tables missing.
- [ ] **Step 3: Author the drizzle schema** in `schema/per-firm/directory.ts` (mirror the existing per-firm schema file's `sqliteTable` idioms; add the CHECK constraints as `sql` checks where drizzle text-enums are type-level only — the ledger `amount_minor`/direction CHECK pattern). Then `pnpm --filter @magna-carta/database exec drizzle-kit generate` to emit `<next>_directory.sql`; hand-add the **FTS5 virtual table + triggers** to the SQL (drizzle-kit does not model FTS5) following the conflicts-research D1 trigram pattern.
- [ ] **Step 4: Run the test; expect PASS.**
- [ ] **Step 5: Add the schema fitness assertions to the existing database fitness suite** (every directory table PK is a TEXT handle; no REAL columns) — extend the existing fitness test rather than duplicating it.
- [ ] **Step 6: Commit** — `git add packages/database/drizzle/... packages/database/test/per-firm-directory-migration.test.ts && git commit -m "feat(directory): per-firm schema + migration"`

---

## Task 2: Package scaffold

**Files:**

- Create: `packages/directory/package.json`, `vitest.config.ts`, `src/index.ts`, `src/types.ts`, `CLAUDE.md`

- [ ] **Step 1: Create `package.json`** mirroring `packages/ledger/package.json` (name `@magna-carta/directory`, workspace deps `@magna-carta/identifiers`, `@magna-carta/database`, `@magna-carta/data-access`; add `words/double-metaphone` to the pnpm catalog and reference it). Add `acct_`-style prefixes `dpe_`,`dor_`,`dnm_`,`did_`,`ded_`,`dct_`,`dpr_`,`mtp_`,`eme_` to `@magna-carta/identifiers`' prefix registry (one edit there + its test).
- [ ] **Step 2: Create `src/types.ts`** — branded id types (`PersonId`, `OrganizationId`, `NameId`, `EdgeId`, `IdentifierId`, `MergeEventId`, `MatterPartyId`) via the identifiers brand helper; the enums (`EntityKind`, `NameRole`, `PhoneticScheme`, `EdgeType`, `IdentifierType`) as `as const` unions matching the CHECK strings.
- [ ] **Step 3: Run** `pnpm --filter @magna-carta/directory exec tsc --noEmit` → PASS (empty package compiles).
- [ ] **Step 4: Write `CLAUDE.md`** from the area template — local rules: all writes compose `composeEffectBatch` (never raw D1); names are append-and-flip; phonetic codes computed on every name write; sensitive identifiers only via `protectedField`.
- [ ] **Step 5: Commit** — `git add packages/directory packages/identifiers && git commit -m "chore(directory): package scaffold + id prefixes"`

---

## Task 3: Name normalization (pure)

**Files:**

- Create: `packages/directory/src/normalize-name.ts`, `packages/directory/test/normalize-name.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/normalize-name.test.ts
import { test, expect } from "vitest";
import { normalizeName } from "../src/normalize-name.js";

test("normalizes case, punctuation, diacritics, and NFC", () => {
  expect(normalizeName("O'Brien")).toBe("obrien");
  expect(normalizeName("José")).toBe("jose");
  expect(normalizeName("  Smith-Jones ")).toBe("smith jones");
});

test("is idempotent (frozen transform)", () => {
  const once = normalizeName("McDonald, Jr.");
  expect(normalizeName(once)).toBe(once);
});
```

- [ ] **Step 2: Run; expect FAIL** — `pnpm --filter @magna-carta/directory test normalize-name`.
- [ ] **Step 3: Implement** `normalizeName(raw: string): string` — NFC normalize, strip diacritics (`normalize("NFD").replace(/\p{Diacritic}/gu,"")`), lowercase, replace punctuation with spaces, collapse whitespace, trim. Document it as a **frozen contract** (a change = a phonetic+search reindex sweep).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): frozen name normalization"`

---

## Task 4: Phonetic codes (Double Metaphone, scheme-keyed)

**Files:**

- Create: `packages/directory/src/phonetics.ts`, `packages/directory/test/phonetics.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/phonetics.test.ts
import { test, expect } from "vitest";
import { phoneticCodes } from "../src/phonetics.js";

test("returns scheme-keyed primary + secondary Double Metaphone codes", () => {
  const codes = phoneticCodes("Catherine");
  expect(codes).toEqual([
    { scheme: "double_metaphone_primary", code: expect.any(String) },
    { scheme: "double_metaphone_secondary", code: expect.any(String) },
  ]);
});

test("sound-alikes share a primary code (the blocking guarantee)", () => {
  const a = phoneticCodes("Smith").find((c) => c.scheme === "double_metaphone_primary")!.code;
  const b = phoneticCodes("Smyth").find((c) => c.scheme === "double_metaphone_primary")!.code;
  expect(a).toBe(b);
});

test("is deterministic", () => {
  expect(phoneticCodes("Nguyen")).toEqual(phoneticCodes("Nguyen"));
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `phoneticCodes(name: string)` behind a one-file seam over `words/double-metaphone` (`import { doubleMetaphone } from "double-metaphone"`), returning the `[{scheme,code}]` shape; dedupe when primary === secondary is **not** done (store both; blocking treats them uniformly). Add a fitness test that only `phonetics.ts` imports the library (the ledger seam pattern).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): scheme-keyed Double Metaphone codes"`

---

## Task 5: Statement builders + createPerson

**Files:**

- Create: `packages/directory/src/statements.ts`, `packages/directory/src/person.ts`, tests for both

`createPerson` composes one atomic batch: the `directory_person` row (current-name denormalized), one `directory_name` row (`is_current=1`, `name_role='current'`, normalized), its phonetic-code rows, and the `directory.entity.created` outbox row — via `composeEffectBatch` (0·2).

- [ ] **Step 1: Write failing test** (real SQLite)

```ts
// test/person.test.ts
import { test, expect } from "vitest";
import { createLocalPerFirmDatabase } from "@magna-carta/database/node-sqlite";
import { seededRandomSource } from "@magna-carta/identifiers";
import { createPerson, readPerson } from "../src/person.js";

test("createPerson writes the entity, a current name row, and phonetic codes in one batch", async () => {
  const db = await createLocalPerFirmDatabase();
  const rng = seededRandomSource("t5");
  const id = await createPerson(db, rng, {
    given: "Catherine",
    family: "Smith",
  });
  const person = await readPerson(db, id);
  expect(person.displayName).toBe("Catherine Smith");

  const names = await db.all("SELECT * FROM directory_name WHERE entity_id = ?", [id]);
  expect(names).toHaveLength(1);
  expect(names[0].is_current).toBe(1);

  const codes = await db.all("SELECT scheme FROM directory_name_phonetic_code WHERE name_id = ?", [
    names[0].id,
  ]);
  expect(codes.map((c: any) => c.scheme).sort()).toEqual([
    "double_metaphone_primary",
    "double_metaphone_secondary",
  ]);
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `statements.ts` (pure SQL-statement builders: `insertPersonStatement`, `insertNameStatement`, `insertPhoneticCodeStatements`) and `person.ts` (`createPerson` mints ids via the injected source, normalizes the name, computes phonetic codes, and assembles statements + outbox row into `composeEffectBatch`; `readPerson` is a firm-scoped select). The FTS trigger (Task 1) keeps `directory_name_fts` in sync automatically.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Add `updatePerson`** for non-name standard fields (a focused test + impl).
- [ ] **Step 6: Commit** — `git commit -m "feat(directory): createPerson + statement builders"`

---

## Task 6: createOrganization

**Files:**

- Create: `packages/directory/src/organization.ts`, `packages/directory/test/organization.test.ts`

- [ ] **Step 1: Write failing test** — mirror Task 5 for `createOrganization` (legal name → `directory_name` `name_role='current'` + phonetic codes; `dor_` id; `display_name = legal_name` by default).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `organization.ts` reusing `statements.ts` (the name/phonetic builders are entity-kind-parameterized; `entity_kind='organization'`).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): createOrganization"`

---

## Task 7: Name history — append-and-flip

**Files:**

- Create: `packages/directory/src/name-history.ts`, `packages/directory/test/name-history.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/name-history.test.ts — changeName flips current→former and appends a new current
test("changeName preserves history and keeps exactly one current name", async () => {
  const db = await createLocalPerFirmDatabase();
  const rng = seededRandomSource("t7");
  const id = await createPerson(db, rng, { given: "Mary", family: "Jones" });
  await changeName(db, rng, id, { given: "Mary", family: "Smith" }); // married

  const rows = await db.all(
    "SELECT name_role, is_current, valid_to FROM directory_name WHERE entity_id = ? ORDER BY created_at",
    [id],
  );
  expect(rows).toHaveLength(2);
  const current = rows.filter((r: any) => r.is_current === 1);
  expect(current).toHaveLength(1); // exactly one current
  const former = rows.find((r: any) => r.is_current === 0);
  expect(former.name_role).toBe("former");
  expect(former.valid_to).not.toBeNull(); // former carries valid_to
});

test("the former name still produces phonetic codes (conflicts corpus)", async () => {
  // ... after the change, Jones' phonetic code rows still exist and are queryable
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `addName` (append an alias/aka/maiden/dba row) and `changeName` (one batch: flip the prior current to `name_role='former'`, `is_current=0`, `valid_to=now`; insert the new `current` row + phonetic codes; update the entity-row name denormalization). Never edit a name in place.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): append-and-flip name history"`

---

## Task 8: FTS5 trigram search

**Files:**

- Create: `packages/directory/src/search.ts`, `packages/directory/test/search.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/search.test.ts
test("trigram search finds a substring/typo match", async () => {
  const db = await createLocalPerFirmDatabase();
  const rng = seededRandomSource("t8");
  await createPerson(db, rng, { given: "Catherine", family: "Smith" });
  const hits = await searchNames(db, "cathrine"); // typo
  expect(hits.map((h) => h.displayName)).toContain("Catherine Smith");
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `searchNames(db, query)` — query `directory_name_fts` with the trigram MATCH against `normalizeName(query)`, join back to `directory_name` + entity, exclude soft-deleted/merged-away rows from the _self_ result set (merged-away rows resolve to the master in candidate generation, Task 12, but ordinary search shows the master).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): FTS5 trigram name search"`

---

## Task 9: Sensitive identifiers — protected() wiring

**Files:**

- Create: `packages/directory/src/identifiers.ts`, `packages/directory/test/identifiers.test.ts`
- Modify: the 1·2 policy table (add the **EIN** row) + register `directory:viewSensitiveIdentifiers` in `@magna-carta/access-control`

- [ ] **Step 1: Add the EIN policy-table row** in `data-access` (1·2): `EIN` → `pii`, standalone blind index, L=16, digit-strip normalization (mirrors SSN). Add `directory:viewSensitiveIdentifiers` to the permission registry + its resolver test.
- [ ] **Step 2: Write failing tests**

```ts
// test/identifiers.test.ts
test("an SSN round-trips through protected() and matches by blind index without decrypt", async () => {
  const ctx = await directoryTestContext("t9"); // db + injected crypto handles per the 1·2 test harness
  const id = await createPerson(ctx.db, ctx.rng, { given: "Jane", family: "Roe" });
  await addIdentifier(ctx, id, { type: "ssn", value: "123-45-6789" });

  // exact-match channel: stored blind index equals a fresh blind index of the same value
  const hits = await findByIdentifier(ctx, { type: "ssn", value: "123456789" }); // formatting-insensitive
  expect(hits).toContain(id);

  // reading the plaintext requires the permission + writes an audit row (1·2 contract)
  await expect(readIdentifier(ctx.withoutPermission, id, "ssn")).rejects.toThrow(/permission/);
});

test("EIN on an organization is standalone-indexed", async () => {
  // ... addIdentifier(org, {type:"ein", value:"12-3456789"}) → findByIdentifier matches "123456789"
});

test("DOB is stored protected but never standalone-indexed", async () => {
  // ... directory_identifier for dob has value_blind_index NULL; findByIdentifier({type:"dob"}) throws "no-standalone-index"
});
```

- [ ] **Step 3: Run; expect FAIL.**
- [ ] **Step 4: Implement** `identifiers.ts` — declare the `directory_identifier.value` field via the 1·2 `protectedField` registry (carrying `directory:viewSensitiveIdentifiers`); `addIdentifier` encrypts + computes the blind index (per policy) into the atomic batch; `findByIdentifier` matches on `value_blind_index` equality (no decrypt, no audit) and refuses non-indexed types (`dob`, `ssn_last_four`) with a named code; `readIdentifier` = permission check → `audit_log` row → AAD decrypt (the 1·2 `readProtected` path).
- [ ] **Step 5: Run; expect PASS.**
- [ ] **Step 6: Commit** — `git add packages/directory packages/data-access packages/access-control && git commit -m "feat(directory): protected() identifiers + EIN policy + blind-index channel"`

---

## Task 10: The typed edge graph

**Files:**

- Create: `packages/directory/src/edges.ts`, `packages/directory/test/edges.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/edges.test.ts
test("createEdge accepts the conflicts seam-4 types and validates endpoints", async () => {
  const db = await createLocalPerFirmDatabase();
  const rng = seededRandomSource("t10");
  const person = await createPerson(db, rng, { given: "Ann", family: "Lee" });
  const org = await createOrganization(db, rng, { legalName: "Acme LLC" });
  const edge = await createEdge(db, rng, {
    from: person,
    to: org,
    edgeType: "affiliation",
    role: "principal",
  });
  const edges = await readEdges(db, person);
  expect(edges.map((e) => e.edgeType)).toContain("affiliation");
});

test("rejects an unknown edge type and a non-existent endpoint", async () => {
  // ... createEdge({edgeType:"bogus"}) → "invalid-edge-type"; missing endpoint → "unknown-entity"
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `edges.ts` — `createEdge` validates `edge_type` against the union (`affiliation`,`relationship`,`corporate_parent`,`corporate_subsidiary`,`corporate_successor`,`representation`,`role_assignment`) and that both endpoints exist + are not hard-deleted (they never are — soft-delete only), composes the batch; `readEdges(entity)` returns inbound+outbound active edges.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): typed edge graph"`

---

## Task 11: Categories

**Files:**

- Create: `packages/directory/src/categories.ts`, `packages/directory/test/categories.test.ts`

- [ ] **Step 1: Write failing test** — define a category (`name="Opposing Counsel"`, `applies_to="person"`), link an entity, read its categories; a person-only category rejects an organization link (`category-applies-to-mismatch`).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `categories.ts` — `createCategory`, `assignCategory` (validates `applies_to` against the entity kind), `readCategories(entity)`. Categories are labels only — no field attachment (that is slice 1·4).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): entity categories (labels)"`

---

## Task 12: Candidate generation (duplicate prevention)

**Files:**

- Modify: `packages/directory/src/search.ts` (add `findDuplicateCandidates`)
- Test: `packages/directory/test/candidate-generation.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/candidate-generation.test.ts
test("surfaces a sound-alike + an exact-identifier match as candidates", async () => {
  const ctx = await directoryTestContext("t12");
  const existing = await createPerson(ctx.db, ctx.rng, { given: "John", family: "Smith" });
  await addIdentifier(ctx, existing, { type: "ssn", value: "111-22-3333" });

  // entering "Jon Smyth" with the same SSN should surface `existing`
  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Jon",
    family: "Smyth",
    identifiers: [{ type: "ssn", value: "111223333" }],
  });
  expect(candidates.map((c) => c.entityId)).toContain(existing);
});

test("the candidate list excludes the entity being edited itself", async () => {
  /* ... */
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `findDuplicateCandidates` — union of: phonetic-block equality (any incoming name part's primary code matches a `directory_name_phonetic_code` row), FTS5 trigram match on `normalizeName`, and blind-index equality on any supplied standalone-indexable identifier. Merged-away subordinate rows resolve to their master (the result set is de-duplicated to master ids). Recall-biased, unscored (scoring is Phase 4). Returns ranked-by-signal-count candidates.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): duplicate-candidate generation"`

---

## Task 13: Non-destructive merge + entity_merge event

**Files:**

- Create: `packages/directory/src/merge.ts`, `packages/directory/test/merge.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/merge.test.ts
test("merge archives the subordinate, repoints references, and records the exact repoint list", async () => {
  const ctx = await directoryTestContext("t13");
  const master = await createPerson(ctx.db, ctx.rng, { given: "John", family: "Smith" });
  const dup = await createPerson(ctx.db, ctx.rng, { given: "John", family: "Smith" });
  // dup is the beneficiary on a matter (the owner's scenario)
  await linkMatterParty(ctx, { matterId: "mat_demo", entityId: dup, role: "beneficiary" });

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // subordinate archived, not deleted
  const sub = await ctx.db.get("SELECT status, merged_into_id FROM directory_person WHERE id = ?", [
    dup,
  ]);
  expect(sub.merged_into_id).toBe(master);

  // matter_party repointed to master
  const links = await ctx.db.all("SELECT entity_id FROM matter_party WHERE matter_id = 'mat_demo'");
  expect(links.every((l: any) => l.entity_id === master)).toBe(true);

  // the event records the exact repoint
  const event = await ctx.db.get("SELECT repointed FROM entity_merge WHERE subordinate_id = ?", [
    dup,
  ]);
  expect(JSON.parse(event.repointed)).toContainEqual({
    table: "matter_party",
    row: expect.any(String),
    from: dup,
    to: master,
  });
});

test("a merged-away alias still matches in candidate generation (conflicts corpus)", async () => {
  // after merge, findDuplicateCandidates on the subordinate's old name resolves to `master`
});

test("the relink leaves no inbound reference pointing at the subordinate", async () => {
  // assertNoDanglingToSubordinate(ctx, dup) passes
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `mergeEntities` — one atomic batch: set subordinate `status='merged_into'` + `merged_into_id`; repoint `matter_party`, `directory_edge` (both endpoints), `directory_entity_category`, and the contact/identifier rows per policy (all real indexed columns); apply field-level survivorship to the master (record prior values); insert the `entity_merge` event (survivorship + the exact repoint list) **and** an `audit_log` row. Subordinate name + phonetic + identifier rows stay alive and master-resolved. Add `assertNoDanglingToSubordinate` to `fitness.ts`.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): non-destructive merge + entity_merge event"`

---

## Task 14: matter_party + the 1·1 client-field migration

**Files:**

- Create: `packages/directory/src/party.ts`, `packages/directory/test/party.test.ts`
- Create: the data-migration routine + `packages/directory/test/client-migration.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/party.test.ts
test("linkMatterParty supports many-hats (one entity, several roles)", async () => {
  // entity linked as both 'client' and 'guardian' on one matter → two matter_party rows
});

// test/client-migration.test.ts
test("migrates 1·1 client_display_name/client_code into a Person entity + role='client' link", async () => {
  const ctx = await directoryTestContext("t14");
  await seedMatterWithDisplayClient(ctx, {
    matterId: "mat_x",
    clientDisplayName: "Acme Corp",
    clientCode: "ACME",
  });
  await migrateClientDisplayFields(ctx);
  const link = await ctx.db.get("SELECT entity_id, role FROM matter_party WHERE matter_id='mat_x'");
  expect(link.role).toBe("client");
  const entity = await ctx.db.get("SELECT display_name FROM directory_organization WHERE id=?", [
    link.entity_id,
  ]);
  expect(entity.display_name).toBe("Acme Corp");
});

test("an ambiguous/blank display name migrates to a provisional review entity, never auto-merged", async () => {
  // blank name → provisional Person flagged needs_review; no merge on a bare string
});

test("re-running the migration is idempotent", async () => {
  /* second run is a no-op */
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `party.ts` (`linkMatterParty`, `readMatterParties`, the `directory_party_role` list; `role='client'` is client-ship) and `migrateClientDisplayFields` — for each matter with a display client, find-or-create the entity (person vs org heuristic; ambiguous/blank → provisional `needs_review` Person, never auto-merged on a bare string), create the `role='client'` link, mark the display columns legacy. Idempotent (guard on an existing client link).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): matter_party + 1·1 client-field migration"`

---

## Task 15: Worker routes

**Files:**

- Create: `apps/worker/src/routes/directory/directory.ts`
- Modify: the worker route registry; Test: `apps/worker/test/directory-routes.test.ts`

- [ ] **Step 1: Write failing test** (Miniflare) — `POST /api/v1/directory/persons` creates a person (idempotency-key required, the 0·2 middleware); `GET /api/v1/directory/persons/:id` returns it; `GET /api/v1/directory/search?q=` returns candidates; a sensitive-identifier read without `directory:viewSensitiveIdentifiers` is 403; the OpenAPI snapshot includes the new operations.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `directory.ts` via `defineOpenAPIRoute` (0·5): zod request/response schemas, the ordered chokepoint (auth → permission → idempotency → handler), RFC 9457 problems via the 0·5 module. Routes: create/read person + organization, add name/identifier/edge/category, search, duplicate-candidates, merge, matter-party link. Each handler calls the domain service with the firm-scoped db + injected crypto handles.
- [ ] **Step 4: Run; expect PASS; regenerate the committed OpenAPI snapshot.**
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): /v1/directory routes"`

---

## Task 16: Load-profile extension (accretion rule)

**Files:**

- Create: `packages/fixtures/src/load-profile/profiles/directory-volume.ts`
- Modify: the measured-set registry; Test: extend the load-profile smoke test

- [ ] **Step 1: Write failing test** — the `directoryVolume` profile generates entities/names/edges/identifiers/matter_party through the real domain write-paths (one-seed deterministic); the smoke test asserts the new measured ops run and their hot-path statements are scan-free.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** the `directoryVolume` profile (counts/distributions as parameters, one scale multiplier) and add the measured ops: `directory.find-by-identifier` (blind-index lookup), `directory.read-protected-list`, `directory.candidate-generation`, `directory.graph-expansion` (the Phase-4 related-party query shape). `EXPLAIN QUERY PLAN` flagging on each; no timing gates.
- [ ] **Step 4: Run; expect PASS** — `pnpm --filter @magna-carta/fixtures run measure` writes the first `directoryVolume` baseline.
- [ ] **Step 5: Commit** — `git commit -m "feat(directory): load-profile volume + measured ops"`

---

## Task 17: Fitness functions + end-to-end

**Files:**

- Create: `packages/directory/src/fitness.ts` (finalize), `packages/directory/test/fitness.test.ts`, `packages/directory/test/schema-name-sync.test.ts`, `packages/directory/test/no-plaintext-escape.test.ts`, `apps/worker/test/directory-e2e.test.ts`

- [ ] **Step 1: Write failing fitness tests**

```ts
// test/fitness.test.ts
test("every directory_name row has both Double Metaphone codes", async () => {
  // assertDirectoryFitness flags any name row missing a phonetic scheme
});
test("no edge references a hard-deleted entity; no inbound reference points at a merged subordinate", async () => {
  /* ... */
});
```

- [ ] **Step 2:** the **no-plaintext-escape source scan** (extend the 1·2 scan to Directory fields — SSN/EIN/DL/DOB never read into a non-protected column or logged) and the **schema-name-sync** test (every SQL identifier pins to the drizzle schema — the ledger pattern).
- [ ] **Step 3: Run; expect FAIL, then implement** `assertDirectoryFitness` + the table-wide queries.
- [ ] **Step 4: Write the end-to-end test** — create entities → add names/edges/identifiers → entry-time `findDuplicateCandidates` surfaces the dup → `mergeEntities` → assert matter-party + edges repointed, the merged-away alias still matches, the `entity_merge` event is complete, an audited SSN read works and writes the audit row.
- [ ] **Step 5: Run the full package suite + worker suite; expect PASS.**
- [ ] **Step 6: Commit** — `git commit -m "test(directory): fitness functions + end-to-end"`

---

## Final: docs + roadmap (golden rule 5, same commit as the build's last task)

- [ ] Update ROADMAP (1·3 → built), STATUS (1·3 Built cell with the model attribution + `↻` if Opus-built), CHANGELOG (the built entry), and `packages/directory/CLAUDE.md`. The **UI plan + owner manual-verification checklist** are written separately once 0·7a/0·7b land (the 1·1 precedent). Run `pnpm check` green, commit.

---

## Self-review notes

- **Spec coverage:** §2 entities → T5/T6; §2.3 categories → T11; §3 names → T7; §4 phonetics+trigram → T4/T8; §5 identifiers+EIN → T9; §6 edges → T10 (firm-personnel exclusion is a non-task — nothing is built); §7 prevention+merge → T12/T13; §8 matter_party+migration → T14; §9 temporal/soft-delete → carried in every table (T1) and service; §9.3 custom-fields seam → **not built (slice 1·4)**, no task by design; §10 load profile → T16; §11 testing → T17; §12 docs → Final.
- **Deferred-by-design (no task, correct):** automated unmerge (LEAP), Beider-Morse/scorer/conflicts-log (Phase 4), custom-fields engine (1·4), UI (after 0·7a/0·7b).
- **Cross-slice interface risk:** `protectedField`/`readProtected`/`blindIndexValue` (1·2) and `composeEffectBatch`/`runIdempotentEffect` + the `matter` table (0·2/1·1) are referenced by their spec'd shapes — confirm signatures against landed code at execution start (build gate).
