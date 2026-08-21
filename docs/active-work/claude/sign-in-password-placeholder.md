---
worktree: C:/dev/magna-carta-worktrees/claude/sign-in-password-placeholder
area: Sign-in screen — password field placeholder
status: review
touches: apps/web/src/lib/auth/screens/sign-in-screen.svelte, changelog.d
---

One attribute on the sign-in screen's password input, matching the email input above it. No component
change: `PasswordInput` already accepts `placeholder` and it was simply not passed.
