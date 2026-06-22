# @magna-carta/locations — CLAUDE.md

**Purpose.** The firm-office (Location) domain module: addresses, letterhead/remit-to text, the
matter-numbering location code, staff assignment, and soft close. A Location is the root of trust-account
jurisdiction and the Custodian hierarchy in later phases. Validates in memory and composes statements into
@magna-carta/data-access's `composeEffectBatch`; never runs logic mid-transaction and never calls
external services.

**White paper:** _Locations_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
(ADR-0031.) **Spec:**
[`docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](../../docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md).

## Key files / entry points

- `src/location-service.ts` — `createLocation`/`updateLocation`/`closeLocation`/`setLocationAddresses`/`assignMemberLocations`
- `src/statements.ts` — statement builders for the effect batch
- `src/validation.ts` — named-code validation (the ledger pattern)
- `src/settings.ts` — the firm-default-Location setting definition (read through the data-access accessor)

## Invariants that apply here

- **Soft close only.** A Location is never deleted; `closeLocation` flips status to `closed`. Closing
  the firm-default Location is refused (`location-is-firm-default`).
- **Exactly one primary per member.** `assignMemberLocations` enforces one `is_primary` row per member
  (`member-needs-one-primary`).
- **Replace-set addresses.** `setLocationAddresses` replaces the address set rather than patching rows.
- **Every mutation audited.** A `location.created`/`location.updated` outbox row + an `audit_log` row
  ride in the same batch as the change.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` (effect batches), `@magna-carta/database` (schema),
  `@magna-carta/identifiers`. No other domain package — `matters` does NOT import `locations`; a route
  handler reads the location code and passes it to the numbering renderer as a plain string.
- Pure and synchronous: produces statements for the caller to run; holds no D1 binding, does no I/O.

## Gotchas

- The letterhead logo asset is a Phase 2 seam — the text fields (`address_block`, `footer`, `remit_to`)
  exist now; the logo lands with document generation.
- D1 has no interactive transactions — read what you need before composing, or assert it inside the batch.
