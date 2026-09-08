---
category: Added
audience: internal
---

Every reviewed table rebuild is now run over a database that already holds rows.

Nothing in the repository did. `createMigratedNodeDatabase` migrates an EMPTY database and seeds afterwards, and the fixtures harness and the load-profile suites all build on it, so the lineage was only ever applied to nothing. Two outages in one day came through that gap, both the same shape: a rebuild that cannot survive contact with real data, passing every test because no test had any.

A rebuild is the one migration shape where an empty database is not a weaker case but a different one. It drops the table it replaces, and `DROP TABLE` on a parent fires a foreign-key violation for every child row — of which an empty database has none. So the fixture that matters is not volume: it is one row in the table being rebuilt and one row pointing at it.

Each case seeds exactly that at the schema of the moment, applies the rest of the lineage, and requires that it completes, that `PRAGMA foreign_key_check` comes back empty, and that the child still resolves to the row it resolved to before — a rebuild that silently re-keyed its rows would pass a check that only asked whether the migration finished. Reintroducing the pragma bug fails all six.

The pairing is asserted: a tag in `REVIEWED_REBUILDS` without a case here fails, so the coverage cannot fall behind the list it covers.
