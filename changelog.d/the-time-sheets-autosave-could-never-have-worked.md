---
category: Fixed
audience: internal
---

**Every write on the Time surface except creating an entry was answered `400` before the handler
ran.** The contract declares `Idempotency-Key` required on update, submit, approve, kick-back and
void; the client sent one only on create, and the transport adds the header solely when a caller
supplies it.

So a row typed into the Time Sheet saved once, and every keystroke after that settled into "Not
saved. The server answered 400." Striking a row failed the same way. Saving from the record window
failed the same way. The autosave was architecturally present and could not succeed.

**No test could have caught it.** Nothing anywhere in the web application asserted what a surface put
on the wire — method, path, headers or body — so the whole suite passed with this live. The key is
now a required parameter of every write, making an omission a type error at the call site rather than
a failed save, and the new test asserts the header on all six writes from a table that a new write
cannot be added to without carrying it. The defect was reintroduced deliberately to confirm the test
fails: seven failures across two files.

Seven further defects went with it. "New Entry" created two rows and left one permanently phantom.
Undo announced "Undid striking this entry" when nothing un-strikes one, because no unvoid route
exists — it now refuses the step and says so at the moment it happens. Submit and approve discarded
their outcomes, so a refusal was silent. Two capabilities the code claimed were "rendered disabled
with the dependency named" were not rendered at all. The footer and the Worked column disagreed while
a timer ran. Duplicate opened a blank draft. And the forty-step undo bound had no test — changing it
to four, or to infinity, broke nothing.
