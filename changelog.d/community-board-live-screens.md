---
category: Added
audience: internal
---

**Community board screens, live.** On `community.magnacarta.esq` the board's screens now read and
write through the board's worker: the request and question lists with their topic, sort, status and
search filters, an opened post with voting, comments, reporting and the author's delete, and the
composer, which saves a member's display name before their first post. Sign In goes through the
app's new `/community-sign-in` page, which fetches the one-minute link and sends the member back
signed in; a link that did not work says so under the board's header. A read-only board says so too.
