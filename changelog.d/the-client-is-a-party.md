---
category: Added
audience: public
---

**The client is a party from the moment a matter exists.** `CreateMatterRequest` gains
`clientEntityId`; `packages/matters` `createMatter` writes the `client` `matter_party` row in the
same batch as the matter (`clientPartyStatements`), so billing, trust, document assembly and the
conflicts engine, which all derive the client from that link, find one from the first read.
`MatterDetail` and `MatterSummary` carry `clientEntityId` (one batched read per page, never per
row). The intake's client field is the design-system `EntityPicker` over the directory; the draft
refuses to create a matter of either status without a chosen client; `client-picker.svelte` and
`knownClientNames` are gone. "Open Client Record" is a real link, and "Run Conflict Check" runs a
preliminary check against the chosen client before the matter exists, reporting the hit count with
a link to the report. The overview's Client fact opens the directory record. The backfill in
`packages/directory/src/client-migration.ts` gains its production caller,
`POST /api/v1/directory/matter-clients/backfill`, idempotent and reporting how many matters gained a
link. `client_display_name` keeps being written as the docket's caption; the contract step that
drops it is not this change.

## Public

**Opening a matter starts with choosing the client from the Directory.** Type three characters of
the name, pick the person or organization, and the matter is linked to their record from the moment
it exists, whether it opens outright or is recorded as a consultation. Someone not in the Directory
yet is added there first, which is what keeps one client from ending up in the book twice. Open
Client Record takes you to them, and Run Conflict Check searches the firm's record for them before
the matter is created, telling you how many hits it found and where to read the report. The
matter's Overview shows the client as a link to their record.

**Matters opened before this change can be linked in one step.** An administrator can ask the
platform to give every matter that carries only a client name its own Directory record and link,
once; matters already linked are left alone.
