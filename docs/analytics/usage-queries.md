# Usage analytics — canonical queries

The builder-facing query set over product-usage data. Two layers (see the white paper's _Observability and diagnostics_ → _Product-usage analytics_):

- **Analytics Engine `usage` dataset** — live, aggregate totals. Available now. Holds `feature × phase × surface` counts only (no per-firm/per-user cardinality), so these queries are **aggregate totals and must never be filtered to a single firm**.
- **R2 Data Catalog (Iceberg)** — full-fidelity rows with pseudonymous `firmIdHash`/`userIdHash`. Built with the Logpush→Pipelines tier (a later Cloudflare-infra step). The per-firm/per-user queries (dead-feature by distinct users, funnel, retention) run here, each applying small-n suppression (`k = 5`, `suppressSmallCells`).

## Analytics Engine (live now)

The counter is written as `count("usage", { feature, phase, surface })` → `blob1="usage"`, `blob2=feature`, `blob3=phase`, `blob4=surface`, `double1=1`.

**Reached/completed totals by feature (last 7 days):**

```sql
SELECT blob2 AS feature, blob3 AS phase, SUM(_sample_interval) AS approx_count
FROM usage
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY feature, phase
ORDER BY approx_count DESC
```

**Dead-feature candidates:** features in the taxonomy (`@magna-carta/telemetry/usage-features`) with no `reached` rows in the window — compute the set difference between the taxonomy and the `feature` values returned above.

> `_sample_interval` weights for Analytics Engine's adaptive sampling under load (irrelevant at low volume; included so the counts stay correct as traffic grows). Retention is ~90 days; for longer horizons or exact unsampled counts, use the Iceberg layer.

## Iceberg / R2 Data Catalog (full-fidelity, with the Logpush→Pipelines tier)

Run with DuckDB/PyIceberg over the R2 Data Catalog REST URI (an R2 API token with both R2 and catalog permissions), at zero egress. Each query applies small-n suppression (drop any cell from < 5 distinct firms, and for user-level metrics < 5 distinct `userIdHash`); the suppressed count is reported, never silently hidden.

- **Dead-feature** — features with zero distinct `userIdHash` over a window.
- **Funnel drop-off** — `reached` vs `completed` per feature (firm-level; `completed` is firm-attributed).
- **Retention** — distinct `userIdHash` per feature per week.
