---
category: Fixed
audience: internal
---

`pnpm run lint:status` has been failing on `main`, and the cause is a coupling nobody had exercised
before tonight: a status fragment carries an `active-work` pointer at the stream note describing the
work, and sweeping a landed stream's note leaves that pointer dangling. Two sweeps of landed notes
broke five fragments across three areas.

Both halves of that are correct in isolation. The note should go when the branch lands — the worktree
lifecycle says so, and leaving it turns the registry into a list of finished work. The pointer should
resolve — a fragment citing a file that is not there is a broken reference the linter exists to catch.
What was missing is that they move together: the pointer's whole meaning is "this slice is being worked
on, over there", so when the stream lands, the honest value is empty rather than a path to something
deleted. Five fragments now say that, which is what every fragment for a slice with no live stream
already said.

Also re-rendered `STATUS.md` and `STATUS.json`, which the fragment edits moved. The drift gate that
caught it is the one added a few merges ago precisely so a fragment could not move without the
assembler running; it is now working on a case it was not written for.
