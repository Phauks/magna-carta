---
category: Added
audience: public
---

**The header chip now answers "can I reach my firm's records", not only "what version am I on" —
and both of its sections fold.**

A newly created firm produced screens that all refused with the same sentence — "Your role does not
grant this action in this firm" — for a reason that had nothing to do with roles: the owner's member
record had not yet been mirrored from the control plane into the firm's own database, so their
effective permission set was empty. That state was invisible from the interface, indistinguishable
from a role somebody had forgotten to grant, and self-clearing within minutes, which is the worst
combination a diagnosis can have.

- **A new read, `GET /api/v1/meta/database-health`.** It reports five facts separately: a timed
  round trip to the firm's own database, the control plane's answer and whether the firm's storage
  is allocated, the applied migration lineage against the one this build expects, the session's own
  member row with the roles on it and the permission count they resolve to, and any
  `member.provision` message for the firm still pending or dead-lettered. Every check reports a
  state rather than prose, a check that could not run says "unknown" instead of reporting health,
  and one failing check never fails the reply — the route has to be readable during the outage it
  is describing. It carries `permission: null` deliberately: a gated version of it would refuse
  exactly the session it exists to explain.
- **A Database section in the Build Versions panel** renders that read as four rows, each with the
  remedy its own state implies — a wait, an administrator's grant, a broken seeding, a connection
  fault — plus a Provisioning line when a member mirror is still on its way or has been given up on,
  and a Copy diagnosis control that puts the whole reading on the clipboard.
- **Deployment and Database each sit behind a caret now**, remembered per browser and open by
  default, with the fleet keeping its own fold inside Deployment. All three render through one
  disclosure snippet, and a shut heading carries what folding it hides: the count of Workers without
  a version, or the worst reading among the health rows.
- **Neither read fires until the panel is opened**, so the chip costs a page load nothing, and the
  panel's one Refresh control now re-asks both.

## Public

The version chip at the top right can now tell you whether Magna Carta can reach your firm's own
records. Open it and look under **Database**: it shows whether your firm's database answered and how
quickly, whether it has caught up with the version you are running, and — the row that matters when
a screen has just refused you — whether your account has been written into the firm's records yet,
which roles you hold, and how much those roles permit.

That last row exists because of one specific frustration. On a firm created a few minutes ago, every
screen can refuse you with a message about permissions when the real answer is that your membership
is still being written and will arrive on its own. The panel now says which of those it is, with a
line telling you whether the record is still on its way or has failed and needs releasing. **Copy
diagnosis** puts the whole reading on your clipboard for a support request.

The overlay's **Deployment** and **Database** sections each fold away behind the caret beside their
heading, and it remembers how you left them. A folded heading still shows anything wrong underneath
it — amber **Needs attention**, red **Not working** — so tidying the panel never hides a problem.
