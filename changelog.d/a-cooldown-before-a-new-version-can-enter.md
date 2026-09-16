---
category: Security
audience: internal
---

**New dependency versions wait three days before they can be resolved.** `minimumReleaseAge` in `pnpm-workspace.yaml`. A version published minutes ago is the shape a compromised release arrives in: the attacker publishes, the weekly automated upgrade opens its pull request, and the package is in the tree before the registry has heard the report. Every recent npm compromise of this kind was caught in public within days, by other people, at no cost to us — the cooldown is how that work gets used.

It applies at resolution, so nothing already in the lockfile moves, and it is a floor rather than a wall: a security fix that has to land the day it ships is `pnpm add <package>@<version> --config.minimumReleaseAge=0`, a deliberate act with a reason.
