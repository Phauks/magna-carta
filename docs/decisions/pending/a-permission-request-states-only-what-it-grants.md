---
slug: a-permission-request-states-only-what-it-grants
status: Accepted
area: Design system
date: 2026-11-10
summary: "Asking a member for a permission is one reusable design-system window with three parts: a title naming what is being allowed, one line naming who is asking, and a list of exactly what is granted. It never lists what is not granted. Calendar sync is its first use."
---

**A permission request states only what it grants, and it is one reusable window.**

**Context:** the first sketch of connecting an Outlook account carried a two-column "will" and "will
not" list, and a second sketch grew it to six parts. The owner ruled on 2026-11-10: "permissions only
ever say what they are granting, not what they are not granting. simpler permission windows", having
already asked for "a general asking for permission screen that can be reused".

**Decision.** One component in `@magna-carta/design-system`. A feature supplies a title that names
what is being allowed, the name of who or what is asking, and the list of grants, each a plain
sentence about an act. The component supplies the layout and the two actions. A feature cannot add a
"will not" list, a reassurance paragraph or a second column.

**Why only grants.** A list of what is not granted is unbounded, and every item on it invites the
question of what else was left off. The list of grants is the whole of what the member is deciding.

**Consequences.** Calendar sync is the first use. Any later request for a permission (a mailbox, a
recording, a device) uses the same window, so a member learns the shape once.
