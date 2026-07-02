---
category: Changed
---

- **Malware-scan Container:** the `*/20` warm-poke cron is disabled while no firms are onboarded. With
  no scan traffic it kept a `standard-1` instance resident around the clock (4 GiB memory billed
  continuously, ~$26/mo) for no benefit; the container now reaches its 30-minute `sleepAfter` and scales
  to zero, billing only while an actual scan runs. The daily signature-refresh rebuild is unchanged, and
  the poke handler stays wired so re-arming it at first-firm onboarding is a one-line cron add.
