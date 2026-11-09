---
category: Added
audience: public
---

**Caller lookup on a typed number.** A whole number in the call record's number field is answered by `POST /api/v1/communications/caller-lookup` (`communications.callerLookup`): the Directory records listing it (`packages/directory/src/phone-match.ts`, matching numbers stored with or without their country code), the area code's region (`packages/caller-lookup/src/area-code.ts`, from libphonenumber's geocoding rows), and any caller ID already kept. `POST /api/v1/communications/caller-lookup/caller-identity` (`communications.callerIdentity`, idempotency required) asks Telnyx Number Lookup for the caller name and carrier through the new `@magna-carta/caller-lookup` port and keeps the answer in the new per-firm `caller_identity` table, so a number is paid for once per firm; a refused query keeps nothing. Both are gated on `communications:log` and are POSTs because the number is a client's. The paid half is dormant until `TELNYX_API_KEY` is set (runbook in `docs/conventions/operations.md`), counted as `communications.caller_lookup`. The web logic is `apps/web/src/lib/communications/caller-lookup.ts`, drawn by `caller-lookup.svelte` under the number field.

## Public

**See who is calling.** When you type a phone number into a call or text record, Magna Carta now tells you what it knows about it: any contact in your directory who has that number, with a button to put them on the record, and the state or province the area code belongs to. Once your firm turns it on, a **Look Up Caller ID** button asks the telephone network for the name and line type behind the number. Each lookup costs a fraction of a cent, so it only runs when you press it, and the answer is kept so nobody at the firm pays for the same number twice.
