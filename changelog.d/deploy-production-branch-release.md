---
category: Changed
---

Pushing or merging to `main` no longer builds or deploys anything. The
Cloudflare Workers Builds production branch is now `release` on every connected
Worker, so the trunk carries code to GitHub without changing the live
environment. Deploying is an explicit fast-forward — `git push origin
main:release` — after which each Worker's Build Watch Paths decide which
Workers rebuild.
