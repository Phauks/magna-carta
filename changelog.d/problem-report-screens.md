---
category: Added
audience: public
---

**Problem report screens.** The report dialog takes two steps (describe, then a screenshot captured
with modern-screenshot and covered on the device before upload). Admins answer reports at
Settings › Problem Reports; senders read theirs at Settings › My Reports. A firm switch
(`firm.shares_problem_reports`, on by default) records a pointer in control-plane
`shared_problem_report`, and platform operators open shared reports one at a time through an
audited read in System Status › Problem Reports. Turning the switch off withdraws the pointers.

## Public

Reporting a problem now takes two steps: describe it, then send a screenshot of the screen you were
on, with anything private covered before it leaves your computer. Your firm's admins read and answer
reports under Settings › Problem Reports, and you see where each of yours stands under My Reports,
with a notification when it arrives and each time it is answered. Firms send their reports to Magna
Carta too, so problems get fixed; an admin can turn that off.
