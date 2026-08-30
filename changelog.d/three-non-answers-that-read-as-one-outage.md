---
category: Changed
audience: public
---

**The version overlay now explains each non-answer instead of leaving a two-word badge to be read
as an outage.** "Not deployed", "Unreachable" and "Not reporting" are three different facts about a
deployment, and a bare badge separated none of them: a service this deployment was never wired to
looked identical to a service that failed the read, which looked identical to a healthy service
whose build simply predates the version route. Each row now carries the sentence that says which
one it is, on the line the reported rows use for their timestamps.

Two smaller repairs ride along. The build-identity stamp reads the build runner's own commit
variable (`WORKERS_CI_COMMIT_SHA`, `GITHUB_SHA`) when git cannot answer for the checkout, so a
Worker built on a runner without a usable `.git` reports the commit it was built from rather than
`dev`; a commit that no source can name still reports `dev`, unchanged. And the web-versus-API skew
call compares commits by prefix rather than by equality, because the two sides abbreviate the hash
independently and an equality test would raise "Different Builds" over a deployment that is in step.

## Public

**The version panel now says what each "not reporting" line actually means.** A service the
deployment does not include, a service that failed to answer, and a service running a build made
before it could report its version now read differently instead of all looking like a fault.
