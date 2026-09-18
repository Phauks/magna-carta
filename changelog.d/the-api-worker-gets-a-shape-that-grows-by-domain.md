---
category: Added
audience: internal
---

**The api worker gets a design for a shape that grows by domain.** A spec and a proposed decision reorganize the Worker's 99 flat route files into about twenty domain modules, each a sub-app built by one constructor and mounted by a short manifest, with a route's request and response shapes moving to the domain package and the tree split into an HTTP side and a background side held apart by a fitness test. Four repo-wide checks are specified to stop the shape regrowing, and `wrangler check startup` joins the gate as a recorded trend. Lazy per-domain loading was checked and deferred: Hono's router refuses additions after its first match, and domains do not map to path prefixes. The standing ruling that the background orchestration stays in this Worker is kept. Design only; no code moves in this change.
