---
category: Added
audience: internal
---

**Community board worker and sign-in.** The board has its own worker for `community.magnacarta.esq`
(`apps/community-worker`): anyone can read the board's API, and a member of a firm who is signed in
can post, vote, comment, flag and set a display name, with the team's triage and moderation routes
beside them. Every answer carries `noindex`. A switch in the control-plane database
(`community_board_switch`) makes the board read-only or closes it without a deploy. A member reaches
the board signed in through a one-minute, one-use link from the app (`GET
/api/v1/me/community-handoff`), signed with a secret only the two workers share. Nothing is live on
the community host until the worker is connected and the secret is set.
