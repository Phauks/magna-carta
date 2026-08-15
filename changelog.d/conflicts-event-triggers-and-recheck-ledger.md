---
category: Added
audience: public
---

**Conflicts checks now fire when the world changes, not only when somebody asks.** The second slice of
the conflicts deepening: outbox topics at the write points that can invalidate an answered check, a
durable re-check ledger, two queue consumers, a cron backstop, and a notification.

Six write paths each add **exactly one** outbox row to a batch they were already composing — no query,
no fan-out, no traversal on any request path. `packages/directory/src/topics.ts` names them once, in
the shape `packages/matters/src/topics.ts` already holds, so a producer and a subscriber cannot come
to spell one topic two ways: `matter_party.linked` (`linkMatterParty`), `directory.entity.merged`
(`mergeEntities`, naming master **and** subordinate), `directory.edge.created` (`createEdge`, naming
both endpoints and the type), `directory.identifier.added` (`addIdentifier`, naming the entity and the
identifier **type** — never a value, never the blind index), plus the two shipped literals moved onto
constants. `member.provisioned` joins them from the member-provision mirror, because Rule 1.10 imputes
across the whole firm. `matter.created` / `matter.opened` / `matter.reopened` were already emitted and
are wired, not duplicated.

**`conflicts_recheck_request`** is the load-bearing new object, and it exists because a queue message
is not a record. A partial unique index over the _unsatisfied_ rows makes a redelivery a no-op while
still letting a genuinely recurring cause be requested again after it has been answered. Three
triggers hold the rest: the cause columns cannot be rewritten, a satisfaction cannot be reopened, and
no row is ever deleted — the interval between a corpus change and the check that answered it is the
evidence that the firm's procedure noticed something, which no check row alone can show.
`conflicts_check` gains two nullable columns by `ALTER TABLE ADD COLUMN` (`trigger_source`,
`cause_json`), so the append-only guard triggers stand and every stored row reads exactly as it did.

Request and run are **separate consumers**, deliberately: a slow check must not be able to
back-pressure the recording of causes, because the recording is what makes staleness visible. The
request consumer resolves the affected matter set in one bounded indexed query per topic and records
one ledger row per matter; the run consumer claims a matter's open causes, coalesces **every** one of
them into a single check whose `cause_json` names them all, and stamps each claimed row with the check
that answered it. `CONFLICTS_TRIGGERS` widens to the full catalogue (the column CHECK is `length > 0`,
so no migration), and an automated run records `trigger_source: "event"` with no actor.

**Bounds bind the invocation, never the work.** A fan-out past `maxMattersPerEvent` still writes every
ledger row and simply queues fewer of them; the cron backstop drains the rest oldest-cause-first under
a wall-clock budget, and exceeding it leaves rows _pending_ — a visible state the posture read reports,
never a discarded one. The scheduled re-scan enqueues open matters in batches at the firm's cadence
(weekly by default), and whether a firm has switched it off is recorded and surfaced. Both ride the
**daily** cron pass rather than the `*/5` sweep, because `scheduleRequestPathSweep` runs that sweep on
`waitUntil` after a provisioning route commits — anything on it executes on the tail of an HTTP
request, and a full conflicts check is precisely the work that must not. Nothing is lost by the wait:
the queue is the primary path and answers a cause within one relay cycle.

**`conflicts.hit.surfaced`** joins the notifications registry — category `conflicts`, audience
`conflicts:read` holders, matter-anchored, `digest`. It subscribes to a check-written outbox row the
automated path emits only when there is something to say, and carries **two counts and nothing else**:
no entity, no matched field, no identifier. A notification row outlives the access check that
justified it.

**The automated path is structurally incapable of concluding anything.** Two source-scan fitness
functions fail the build if any module on it imports the disposition writer, and a third proves the
request consumer never runs a check. `packages/conflicts/src/posture.ts` fills `pendingRecheck` from
the ledger — a matter that has _never_ been checked can still be owed one, and that is the case that
most needs saying.

## Public

**Magna Carta now notices when your records change under a matter you have already screened, and
re-runs the check itself.**

Six kinds of change set one off: a party added to a matter; two directory records merged into one; a
name added or changed; a relationship recorded; a tax or social security number entered; and somebody
joining the firm. A scheduled sweep re-screens your open matters weekly on top of that, because a list
of triggers is a list, and any list can turn out to be incomplete. Adding a person to your directory
on its own does **not** set one off — otherwise importing two thousand contacts would re-screen your
entire caseload for no possible new result.

The part that matters most is not the speed. **A matter says a re-check is owed from the moment the
change is recorded**, naming what changed and when — not from whenever the re-check runs. If your
firm's re-screening ever falls behind, the matters waiting say so out loud instead of looking up to
date. A backlog you can see is a different thing from a stale answer that looks fresh.

Several changes to one matter become one search that lists all of them, rather than several searches
or two of three quietly dropped. An automatic check is never credited to a person: it records that it
ran by itself and what set it off.

You are told when an automatic check turns something up — a result at one of the two strongest
evidence levels, or the first result ever on a matter that had none. A check you ran yourself does not
notify you; you are looking at it. The notification says how many results surfaced and how many are
strong, and takes you to the matter. It carries **no names at all**: a notification sits in a feed and
an inbox long after it was sent, and the detail belongs behind the link where your permission to see it
is checked at the moment you look.

And nothing about this decides anything for you. An automatic re-check runs a search and records what
it found. It cannot mark a result reviewed, cleared, or waived — that stays a person's act with that
person's name on it, and the software is built so that it cannot do otherwise.

New guide: [Automatic conflicts re-checks](docs/user/features/automatic-conflicts-rechecks.md).
