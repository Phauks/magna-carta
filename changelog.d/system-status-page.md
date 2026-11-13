---
category: Changed
audience: public
---

**Settings › Versions becomes System Status, organised by feature.** `GET /api/v1/meta/versions` now
carries `features` (each Working, Not set up or Not working, from
`apps/api-worker/src/system-status/feature-roster.ts`) and, for a platform operator only,
`featureRequirements` (the presence of each setting a feature needs, never a value). The new
operator-only `GET /api/v1/platform/recent-errors` reads the last day of `error.captured` and
`operation.failed` events back from Workers Logs and folds them by Worker, place and error name. It
needs the `OBSERVABILITY_API_TOKEN` secret (`docs/deploy-queue.md`). The page has counts and tabs for
Features, Deployment, Workers, This Firm, Recent Errors and Feature Flags. The header chip is trimmed
to the deployment, the features that are not working, and the firm's records. The old
`/settings/versions` address redirects.

## Public

**Settings › Versions is now System Status, and it starts with what works.** The page opens on a
count of features, deployment, workers and recent errors. Below that, tabs list every feature as
Working, Not set up or Not working, along with the build you are on, the platform's services, your
firm's records and your feature flags. The version chip at the top of the screen is shorter: it
shows the build, any feature that is not working, and a button to the full page.
