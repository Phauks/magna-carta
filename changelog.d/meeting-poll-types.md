---
category: Added
audience: public
---

**Meeting polls have a Poll Type: One, Multiple, Ranking or Score.** `meeting_poll.kind` is an added column with its own CHECK (existing polls mapped from `max_choices`), and `meeting_poll_answer.rank` records a ranking's places, so an anonymous ranking stays anonymous. The open route takes `kind`, which follows `maxChoices` when it is left out, and every poll option carries `averageRank`, which the live tally frames carry too. A score's options are its scale ("1" upward), so its average is read off the ordinary tally.

## Public

When you open a poll in a meeting you now choose its Poll Type. One and Multiple work as before. Ranking asks everyone to put the answers in order and shows the room's order. Score asks for a number on a scale and shows the average.
