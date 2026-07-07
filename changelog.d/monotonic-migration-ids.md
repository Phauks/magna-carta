---
category: Changed
---

Schema migrations now use monotonic, timestamp-based IDs instead of sequential
`00NN` numbers, so migrations authored on parallel branches never collide on a
number or need renumbering at merge. The pre-production migration chain was
collapsed to one clean baseline per lineage (control-plane and per-firm),
verified schema- and data-equivalent to the full legacy chain.
