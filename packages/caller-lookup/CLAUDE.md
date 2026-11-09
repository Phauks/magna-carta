# @magna-carta/caller-lookup — local notes

The **caller-identity port and its engine**: who the telephone network says a number belongs to (the
carriers' caller-name database and the line type), plus the free, offline area-code region for a North
American number, and the API contract shapes for both. Pure package — no `env`, no UI; the Telnyx adapter's
transport is injected, and the Worker decides which port a request gets
(`apps/api-worker/src/caller-lookup/caller-lookup-engine.ts`).

**Spec:** [`docs/specs/2026-11-09-caller-lookup-design.md`](../../docs/specs/2026-11-09-caller-lookup-design.md).

## Key files / entry points

- `src/port.ts` — `CallerLookupPort`, its typed outcomes, `CALLER_LINE_TYPES`, and
  `deferredCallerLookupPort()` for while no provider is provisioned
- `src/telnyx.ts` — `telnyxCallerLookupPort(credentials, fetch)`: Telnyx Number Lookup, caller name and
  carrier in one request
- `src/area-code.ts` — `areaCodeRegion(number)`: the free answer, from the table below
- `src/contract.ts` — the request and response bodies of the two caller-lookup routes, as plain zod;
  the route module in `apps/api-worker` declares its routes over these
- `src/north-american-area-codes.ts` — the area-code table, derived from libphonenumber's geocoding
  data (Apache 2.0); its header says how to refresh it

## Invariants that apply here

- **Every answer is paid for, so nothing here is asked automatically.** The port is called when a
  person presses for it, and the caller (the communications package's `caller_identity` table) keeps
  the answer so one number is paid for once per firm. A surface that calls the port on every keystroke
  or every render is a bill nobody agreed to.
- **Only the number is sent.** No name, matter or firm id goes to the provider. The disclosure of the
  number itself is what the owner accepted on 2026-11-09 when the lookup was asked for.
- **Not covered is not the same as nothing found.** A number outside North America answers
  `not-covered` without a request, because there is no caller-name data to buy for it.
- **An area code says where a number was issued, never where the caller is.** Surfaces word it as "a
  Nevada number", not "calling from Nevada".
- **Never a throw.** Every operation answers a typed outcome.

## Dependencies & contracts

- One runtime dependency, `zod`, for `src/contract.ts`. Reference for the provider's request and body:
  https://developers.telnyx.com/api-reference/number-lookup/lookup-phone-number-data
