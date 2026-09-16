---
category: Changed
audience: internal
---

**A conference room is offered under the office it is in, and named by it where the firm has more than one.** The owner's shape: "A location may be Office 1, Room 1; Office 2, Room 2. Where offices are distinct addresses, but rooms are not."

The location picker listed every room under one "Rooms" heading, so a firm with three offices saw three "Conference Room 1"s and no way to tell them apart. It now draws a group per office, in the order the offices come, with rooms belonging to none under a final heading; an office with no bookable rooms is left out rather than drawn as an empty heading. What the field WRITES is the room's own name while the firm has one office, and "Main Office — Conference Room 1" once there is more than one.

Both spellings match back. A location recorded before this, or typed from memory, is a bare name and still finds its room and books it. A bare name that two offices both answer to matches **neither**: booking one of two rooms a person did not choose between is worse than booking none.

The grouping and the written name live in `room-location.ts` beside the matcher, because the module that writes a location is the one that reads it back to book the room — two answers to "what is this room called" would drift within a round.

`firm_resource` still has a firm-wide unique index on `name`, so two offices genuinely cannot hold rooms of the same name yet. That index, meeting links as bookable places with a concurrency ceiling, participants by tag, recurrence and a separate end zone are all specified in `docs/specs/2026-09-15-calendar-places-people-and-recurrence-design.md` and unbuilt.
