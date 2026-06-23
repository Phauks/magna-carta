# External YARA Ruleset Provider — Research

**Date:** 2026-06-23 · **Context:** the slice 2·1 scan engine ships with **no YARA rules today** (`containers/scan/src/main.rs`: `yara::build_rules(&[])`); rule loading was deferred to "land with the image build." The owner wants the rules sourced from an **externally maintained provider** that **self-updates once the engine is running** — not hand-curated. This pairs with the separable `engineVersion` (the `yara-rules/<n>` component) and the daily Deploy-Hook image rebuild.

## Recommendation: YARA Forge (Core tier), pulled at image build

[YARA Forge](https://yarahq.github.io/) aggregates public YARA repositories, normalizes them to the YARA style guide, **deduplicates by logical rule structure**, tags CVE/MITRE, runs quality + performance analysis (`yaraQA`), applies manual false-positive tuning, and publishes **versioned ZIP releases** on GitHub (`yara-forge-rules-core.zip` / `-extended.zip` / `-full.zip`). It is the maintained, license-aware distribution layer the owner is asking for — it does the daily curation we explicitly do not want to do.

**Use the `core` package**, not extended/full. Core is "high-accuracy, performance-optimized, excludes low-quality and threat-hunting rules" → the **lowest false-positive rate**. That matters disproportionately here: this scanner runs over clients' **legal documents**, where a false "infected"/"suspicious" on a legitimate filing is costly (alarms the firm, forces the informed-access acknowledgment). clamd already does the heavy signature lifting; YARA is the heuristic layer, so favor precision over coverage.

**Self-updating, with zero new egress:** the daily Deploy-Hook rebuild (operations §11) already re-runs `freshclam` for the clamav DB. The same build step downloads the latest YARA Forge `core` release ZIP and compiles it into the image. So both signature sources refresh automatically on the existing nightly rebuild — the running container still has `enableInternet = false`. The `engineVersion` `yara-rules/<n>` component (separable, per the engine-version work) is set to the YARA Forge release tag, so a rules update changes `engineVersion` → the access-triggered re-scan staleness gate fires → files re-scan against the new rules. That is the autonomous loop the owner wants.

## Licensing (the decisive filter — verified)

| Source | License | Commercial SaaS? |
| --- | --- | --- |
| Florian Roth **signature-base** | Detection Rule License (DRL) 1.1 | **Yes** — DRL is written for commercial detection use (attribution; no reselling the rules as a standalone product) |
| **abuse.ch** YARAhub | CC0 1.0 (public domain) | **Yes** — no restrictions |
| **Elastic** protections-artifacts | Elastic License v2 | **No / risky** — proprietary; YARA Forge already **disables** it |

YARA Forge records per-rule license metadata and already excludes Elastic. **Still do a license skim of what `core` actually includes** before shipping (confirm DRL 1.1 + CC0 + the other included licenses are acceptable for an embedded, non-resold detection use — they generally are). A standalone clean fallback is **abuse.ch YARAhub (CC0)** if a fully-public-domain-only posture is ever wanted.

## Caveats / integration work (a future build task, not done here)

1. **YARA-X compatibility is NOT guaranteed.** Our engine uses **yara-x** (the Rust rewrite), but YARA Forge validates rules with **classic YARA**. Some rules use modules/features yara-x does not yet support and will fail to compile. The build step must **compile the downloaded rules with yara-x and skip + log the incompatible ones** (yara-x reports per-rule errors) — never fail the whole image build over a handful of incompatible rules. Count of successfully-compiled rules feeds the `yara-rules` version (and ideally the count, eventually a content hash — see the engine-version Minor M-1).
2. **Verdict mapping for FP safety.** Consider mapping a YARA-rule hit to **`suspicious`** rather than `infected` (clamd signature hits stay `infected`). Given the legal-document FP risk and most-dangerous-wins combining, a heuristic-rule match is weaker evidence than a clamd signature; `suspicious` keeps the file accessible under informed-access without the full malware gate. (Design decision to confirm.)
3. **Pin + verify the release.** Download a specific YARA Forge release tag (not "latest" unpinned) and record it; optionally verify the asset checksum. The nightly rebuild bumps the pin.

## Proposed next task (when rule-loading is built)

A build step in `containers/scan/` (or the Dockerfile) that: downloads the pinned YARA Forge `core` release at image build → compiles with yara-x, skipping+logging incompatible rules → wires the compiled set into `build_rules(...)` → sets the `yara-rules` version component from the release tag. The nightly Deploy-Hook rebuild then keeps it current automatically.
