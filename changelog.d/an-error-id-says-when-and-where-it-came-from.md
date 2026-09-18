---
category: Changed
audience: internal
---

**An Error ID says when and where it came from.** Its body carries 9 base36 milliseconds since the
epoch, a 3-character service code and 9 base62 random characters; `describeErrorId` in
`@magna-carta/telemetry/ids` reads it back. Both facts are on the log record already, and being on
the record is no help while the record is the thing being searched for: a member quotes an id days
later, and whoever reads it has to choose a Worker and judge whether retention still holds the
window before the search can start.

**The fields are packed INTO the existing 21-character body, never appended.** That body's shape is
pinned in three places that know nothing about the telemetry package — the per-entity identifier
validators, the `pattern` emitted for every identifier field in the OpenAPI document, and the
scrubber's whole-handle exemption. The last is the sharp one: a handle the scrubber stops
recognising is rewritten to `[scrubbed]` on the way out, destroying the very Error ID a failure is
keyed by. Keeping the budget means every previously minted id stays well-formed and no contract
moves. The random part drops from ~126 bits to ~53, which is ample for a correlation handle that
grants nothing and addresses no record, and would not be acceptable for a handle that names one.

A 9-character timestamp rather than 8 because 8 runs out in 2059 and would have truncated silently
into a confidently wrong date; the test that pins both ends of the range is what found it. A Worker
announces itself once through `setServiceIdentity`, from the module its events pass through rather
than its entrypoint, which is held to a startup CPU budget the telemetry import would spend. A
Worker that never announces mints `unk`.

**And one failure now mints one Error ID.** `logOperationFailed` returns the id it minted. A caller
that had to show the member an id used to mint its own and call this too, which minted a second —
so the record's `errorId` field named a failure nobody held, and the member's id survived only if
the caller had buried it in the message. A support search against the field found nothing, which is
the one thing that field exists to make possible.
