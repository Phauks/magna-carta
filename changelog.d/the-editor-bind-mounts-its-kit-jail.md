---
category: Changed
audience: internal
---

**The editor image no longer switches off `mount_jail_tree`, and the capabilities experiment is recorded as a success.** The owner's deploy of 2026-09-19 showed the runtime jails the kit with `security.capabilities` at its default (the audit reports each document as securely contained), which makes a mount namespace of the kit's own likely, and in that namespace the bind mount the fast path needs is permitted. coolwsd tests the mount at startup and falls back to copying if it fails, so the worst outcome is the audit's "cannot bind-mount" line rather than an outage; the Dockerfile's note carries the one-line revert.
