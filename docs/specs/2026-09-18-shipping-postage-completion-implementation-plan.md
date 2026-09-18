# Shipping & postage completion — implementation plan

**Status:** Proposed · **Date:** 2026-09-18 · **Owner:** Trevor Goldsmith
**Design:** [`2026-06-16-shipping-easypost-design.md`](2026-06-16-shipping-easypost-design.md) (accepted; its _B — shipping vertical slice_ UI section is superseded here)
**ADRs:** builds on ADR-0094 (shipping subsystem + EasyPost), ADR-0095 (API-key credential kind), ADR-0084 (`firm_secret`), ADR-0003 (tenancy). One new ADR falls out of decision **D1** below and is written when it is settled.

The shipping backend is built, tested and unreachable. `@magna-carta/shipping` holds the typed `ShippingPort` and its EasyPost adapter; eight routes are mounted through the chokepoint; the `shipment`, `shipment_label` and `tracking_event` tables exist; purchase is idempotent; certified mail is a first-class option; and `shipment.purchased` already posts postage against the matter through `apps/api-worker/src/costs/recoverable-charge-consumer.ts`. Every carrier operation nonetheless answers 501, because one seam returns `null`. This plan states exactly what that seam needs, surfaces the permission collision hiding behind it, and specifies the four surfaces the June design predates.

Two things have changed since that design was accepted, which is why its UI section no longer describes a buildable screen: the consolidated modal architecture landed (a record opens in a window over what you were doing, not on a page of its own), and the tools left their sub-page (every tool is a top-level address at `/<id>` with its own rail row). The design's "shipping UI" is written against a shell that no longer exists.

## The inventory — what each piece actually is today

| Piece                    | Built                                                                              | Reachable                               | Gap                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------ |
| `ShippingPort` + adapter | Yes — `packages/shipping/src/{port,canonical}.ts`, `easypost/`                     | n/a                                     | none                                 |
| Shipment tables          | Yes — `shipment`, `shipment_label`, `tracking_event`, per-firm                     | n/a                                     | none                                 |
| Eight routes             | Yes — connect, disconnect, create, rates, purchase, label, tracking, refund        | **Five answer 501**                     | the credential read — slice 1        |
| Draft creation           | Yes                                                                                | Yes — a draft needs no carrier          | none                                 |
| `firm_secret` store      | Yes — `packages/data-access/src/secret-statements.ts`, envelope-encrypted, audited | Yes, from a route that builds a context | the seam does not pass one — slice 1 |
| Cost recovery            | Yes — `shipment.purchased` → recoverable charge against the matter                 | Blocked behind purchase                 | none of its own                      |
| Certified mail           | Yes — modelled in `canonical.ts` and `easypost/map.ts`                             | Blocked behind rating                   | none of its own                      |
| Tool catalog entry       | Yes — `packages/tools/src/catalog.ts`, `tools:shipping`, subject group `mailing`   | Renders as a dead **Soon** row          | the surfaces — slice 2               |
| Tracking ingress         | Pull-on-demand (`getTracking`)                                                     | Blocked behind the credential           | push webhook — slice 3, deferred     |
| Postage account / Forge  | No                                                                                 | n/a                                     | a contract, not code                 |

## The blocker is one seam, and the collision inside it

`apps/api-worker/src/plugins/secret-store.ts` declares the seam as `(firmDatabase: unknown) => SecretStore | null` and `apps/api-worker/src/app.ts:911` defaults it to `firmSecretStoreNotYetAvailable`, which returns `null`. `buildIntegrationRegistry` turns that null into the framework's `unbuiltCredentialStore`, which dispatches `credential-store-not-implemented`, which the shipping routes render as 501. That chain is deliberate and honest — it refuses by name rather than throwing — and it is the whole of what stands between a built subsystem and a working one.

**The signature is the problem, not the machinery.** `getSecret` takes a `ProtectedReadContext`: the firm id, the firm key version, a `FirmKeyProvider`, the per-firm database, the caller's effective permission set, the acting user and a clock. The seam receives only a database handle, so it structurally cannot build one. Everything else already exists and is already assembled three times over — `identifierContext()` in `apps/api-worker/src/routes/directory.ts:182`, and the same shape at `routes/conflicts.ts:120` and `routes/matter-assets.ts:1962`, each combining `firmKeyProviderForEnv(c.env)` with `loadEffectivePermissions(firm.firmDatabase, actorUserId)`. All five shipping call sites sit inside route handlers with `c` in hand, so nothing is missing at the point of use; the indirection simply drops it.

**Wiring it naively converts an honest 501 into a 403 for the people the feature is for.** All eight shipping routes gate on `shipping:manage` (`routes/shipping.ts:58`). The decrypt gates on `firm:manageSecrets`, because `firmSecretValue` in `packages/data-access/src/protected-field-registry.ts:25` declares that permission, and `getSecret` throws `ProtectedReadForbiddenError` when the caller's effective set lacks it. A member who holds `shipping:manage` and not `firm:manageSecrets` — which is the ordinary shape of someone who mails things for a living — passes the route gate and fails the decrypt. Granting that member `firm:manageSecrets` instead is worse than it sounds: it is read access to **every** secret the firm holds, not the postage key, in exchange for buying a label.

This is decision **D1**, and it is the one thing in this plan that must be settled before slice 1 can be built rather than during it.

### D1 — how an operational credential read is authorized

The three candidates, with what each costs:

- **A — a system read on the member's behalf (recommended).** The decrypt for adapter dispatch runs under a context that satisfies the gate without the member holding it, keeps the audit row, and records the acting member on it. The member never receives the key; the worker uses it and the plaintext never reaches a response body. This is already the stated model — `secret-statements.ts:14` says "the core Worker decrypts and hands plaintext to plugin Workers; plugin Workers never see key material" — and the boundary permission that actually governs the act stays `shipping:manage`, which the route has already checked. The cost is a system affordance inside the protected-field chokepoint, which must be narrow, named, and impossible to reach from a route that has not checked something else first.
- **B — a second protected-field declaration.** Declare the postage credential as its own protected field gated on `shipping:manage`, separate from the general `firm_secret` value. The gate stays purely declarative and no bypass exists. The cost is that the secret store stops being one declaration and becomes one per purpose, and every future credentialed adapter adds another.
- **C — split the permission.** Add a right below `firm:manageSecrets` for running a connected integration. Cleanest conceptually; the cost is a new permission on every role definition and a migration for firms that already have roles.

A is recommended because the act being authorized is "buy postage," not "read a secret," and B/C both answer a question the route gate has already answered. If the owner prefers the gate to stay declarative with no bypass at all, B is the fallback and is a contained change.

**Coordinate this with the settings stream.** `claude/settings-implementation-plan-asr0l6` is rebuilding the firm permission model — role assignment, grants, and the client-side check that every firm page's posture reads — and both streams declare `packages/access-control/src/registry.ts`. D1 is a permission question whichever option wins, and C would add a right to the same registry that stream is reshaping. Settle D1 with that stream's model in view rather than beside it.

## The order, and why

1. **The credential read** (slice 1). It converts a large amount of already-tested code from 501 to working, it is verifiable against EasyPost test keys with no contract in place, and every surface in slice 2 is a screen over an endpoint that must work first.
2. **The four surfaces** (slice 2). What the firm actually sees. Gated on slice 1 only for live data — the register and the settings page can be built against the draft endpoint and the connection route while the rest still refuses.
3. **Tracking ingress** (slice 3, deferred). Deliberately last: whether pull is enough is a question the register answers, and building the webhook first is guessing.

Forge procurement runs in parallel with all three and gates none of them.

## Slice 1 — the per-firm credential read

**Widen the seam.** `SecretStoreForFirm` becomes `(context: ProtectedReadContext) => SecretStore | null`, and `buildIntegrationRegistry` takes the context rather than a bare database handle. The production implementation returns a `SecretStore` whose `getSecret`/`putSecret` close over that context; the not-yet-available value stays exactly as it is, so a deployment that has not wired it still refuses by name instead of throwing.

**Extract the context builder.** Three routes hand-roll the same object today. A shared `protectedReadContext(c)` helper in the worker is the reuse move (golden rule 1), and it is what keeps the fourth caller from being a fourth hand-rolled copy that disagrees about `firmKeyVersion`. Directory, conflicts and matter-assets migrate onto it in the same change or immediately after — not later, because a helper with one caller is not a helper.

**Preserve the test seam.** `CreateAppOptions.pluginRuntime.secretStoreForFirm` stays injectable. `apps/api-worker/test/shipping-e2e.test.ts:85` injects an in-memory store and drives connect, rate, purchase, track and refund green today; a fake that ignores its parameter keeps working across the signature change, which is what makes this refactor safe to do first.

**Then implement D1's outcome**, and only then remove the default. The route's 501 branch stays in the code and in the OpenAPI responses — it is the correct answer for a deployment where the seam is genuinely unwired, and deleting it would make that case a 500 again.

**Definition of done:** a firm with an EasyPost test key can connect, rate-shop, buy a label, fetch it from firm storage, track it and refund it, end to end, in Miniflare; a member holding `shipping:manage` and not `firm:manageSecrets` can do all of that; and the API key appears on no log, telemetry or response path.

## Slice 2 — the four surfaces

The tool's stage in `apps/web/src/lib/tools/tool-presentation.ts:68` is `soon`, which is what renders it as a dead row in the rail's Mailing cluster. Flipping it to `alpha` is the last step of this slice, not the first — `hasSurface` is what turns the row into a link, and a link to a half-built screen is worse than the Soon row it replaces.

**1. `/shipping` — the register.** List/Index archetype over `data-table`: status, recipient, carrier and service, tracking code, matter, postage cost, date. This is the tracking surface and the postage-spend surface at once. Saved views, filters and export come from the archetype rather than being invented here. The primary `+New` in the page header opens the buy wizard. Its empty state is the standing two-word form.

**2. `/shipping/[id]` — the shipment, in a window over the register.** Mirrors the directory precedent exactly: `apps/web/src/routes/(app)/directory/[id]/+page.ts` is a 307 redirect to the list with the record's window open, and the `+page.svelte` beside it is a comment explaining that nothing renders there. A shipment earns the same treatment — the dominant task is triage, a purchased shipment has no editing mode, and the reader wants to drop back to the list rather than press Back. The address survives so a shipment can be linked from a matter, a cost entry or an email. Contents: the tracking timeline (`history`), the label (`print-sheet`), the costs as posted, the matter link, and refund for an unused label.

Decision **D4**: which window kind. `RecordWindow` fits a thing with history and actions; the `reading` kind from the modal design fits "a fact with a step beside it." Refund is a destructive money action, which argues for `RecordWindow`. Settle when the slice opens; nothing else depends on it.

**3. The buy wizard.** `progress-steps` over: recipient (a Directory contact, a matter party, or manual) → package (predefined or dimensions and weight) → options (certified mail, return receipt, signature, insurance) → rate-shop → confirm → buy. Reuses `address-fields` and `entity-picker` rather than new address inputs. The confirm step shows **postage and the service fee as separate lines**, which the June design fixed as a requirement and which is the reason FlexRate was rejected; it also shows the wallet balance, because a dry postage account blocks the purchase and the person who needs to know that is the one standing at the confirm step.

**4. `/settings/shipping` — the postage account.** `SettingsSectionGroup` in `apps/web/src/lib/settings/settings-sections.ts` already declares an `integrations` group and **no section uses it**; this is its first occupant, which matters because the port system is built to take more adapters. Holds: connect and rotate the child-user API key, test versus production mode, funding and billing configuration, and the cost-recovery preference. It belongs in settings rather than inside `/shipping` because connecting is an administrative act with a different audience from buying a label — a member who mails things daily should not navigate an area containing a page they cannot open. The wallet **balance** is not exclusive to this page; it is read-only in the wizard and on the register, where the money is actually spent.

**Matter context.** The catalog manifest says `matterContext: "none"`, as every tool does today. Shipping is the first where that is arguably wrong: `shipment.matter_ref` exists and a purchase posts to matter costs, so "mail this from this matter" is a real path. Decision **D3**, settled in this slice.

## Slice 3 — tracking ingress (deferred)

`GET /api/v1/shipments/{id}/tracking` pulls on demand. The feature ledger marks the push webhook `deferred` and this plan keeps it there. A register that shows stale status until someone opens a row is the failure mode to watch for; if it appears, the cheaper fix is a cron sweep over in-transit shipments before the HMAC-verified webhook the design specified. Build whichever the register's behaviour actually asks for.

## Not engineering

**The Forge contract.** Parent account, per-firm child users, centralized billing. Named as a procurement track in the June design and not started. Engineering builds against the documented API regardless, and test keys carry slices 1 and 2 to done; a firm cannot buy real postage until it exists.

**The fee policy.** Two numbers, both owner decisions, neither blocking a build: what the firm pays Magna Carta per label, and — decision **D2** — whether postage recovers to the client with or without that service fee. The design records the latter as "per firm preference," which makes it a setting on the page above; the default still has to be chosen.

## Owner decisions

| #      | Decision                                                | Blocks               | Recommendation                                |
| ------ | ------------------------------------------------------- | -------------------- | --------------------------------------------- |
| **D1** | How an operational credential read is authorized        | Slice 1 — build gate | A, a system read with the member on the audit |
| **D2** | Does postage recover to the client with the service fee | Nothing; a default   | Firm setting, default postage only            |
| **D3** | Shipping's `matterContext`                              | Slice 2              | Not `none` — the matter path is real          |
| **D4** | `RecordWindow` or the `reading` kind for a shipment     | Slice 2 only         | `RecordWindow` — refund is an action          |

## Testing

- **Worker (Miniflare):** the existing e2e extended onto the real protected-context path; connect, purchase idempotency, label bytes landing in firm storage, refund. A permission test asserting D1's outcome — the `shipping:manage`-without-`firm:manageSecrets` member is the case that must pass.
- **Fitness:** the API key on no log, telemetry or response path (the design asked for this and it is the one test that must exist before a real key is ever stored); the adapter not imported by core; every registered adapter shipping a descriptor.
- **Data-access:** the credential never resolving across firms.
- **Web:** the register's empty and populated states, the wizard's validation and its separated cost lines, and the `/shipping/[id]` redirect landing on the register with the window open.
- **Load profile:** shipments-per-matter and tracking-event volume join through the real write paths, per the accretion rule.

## Docs and ledger

On build, in the same commit as the code: the `roadmap.d/integrations.md` nodes move (`easypost-adapter`'s note is rewritten the moment 501 stops being true, `shipping.ui` leaves `deferred`), a `status.d/` fragment plus `vp run status-build`, `vp run register-build`, a `changelog.d/` fragment, the ADR fragment that records D1, and a user guide under `docs/user/` shipping with the UI. This planning commit is `docs` and carries no changelog fragment by the documented type mapping.
