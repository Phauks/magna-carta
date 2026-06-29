# AI-Text Detection — design

**Status:** Accepted (design) · **Date:** 2026-06-28 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ ("pure utilities are libraries, not plugins") · the Tools area.
**Builds on:** the Tools area (`docs/specs/2026-06-16-tools-area-design.md`, ADR-0101) · the integration ports-and-adapters foundation (`packages/integrations`, ADR-0091/0092) · the AI-inference confidentiality posture (ADR-0109/0110) · the metadata tool's deterministic-outbound-vs-probabilistic-inbound distinction (`docs/specs/2026-06-22-metadata-tool-design.md`, §0).
**ADRs (new, to record):**

- **ADR-AAAA** — AI-text-detection architecture: an external, vendor-agnostic detection capability on the integration framework (`ai-detection` category); a `DetectionReport` that encodes a calibrated likelihood band with structured caveats rather than a boolean verdict; confidentiality consent inherited from the inference posture; concrete vendor adapter + consent gate deferred.

A lawyer increasingly needs to ask, of a document that crossed their desk, _"was this written by a person, or generated?"_ — of an opponent's filing or discovery production, of a client's submitted declaration or writing sample, of their own work product before filing (a growing number of courts require disclosure of generative-AI use), or simply as a throwaway curiosity. This design adds an ethereal Tools-area utility — **AI-Text Detection** — that takes text and returns a **calibrated likelihood that it was machine-generated, framed as a signal and never as proof.** It is built core-first, so the same capability can later back a matter-action ("flag this production for AI review"), per the Tools-area principle: _do matter-grade work without committing it to a matter._

This build delivers the **vendor-agnostic core only.** Which commercial detector we wire first is a deliberate, separable decision (see §6); the core is shaped so that choice is one adapter, never a rewrite.

---

## 0. The governing constraint — signal, not proof

Every AI-text detector available today is unreliable enough that, in a legal or evidentiary context, its output **cannot be presented as proof.** This is not a pessimistic framing choice; it is the documented state of the field:

- Detection accuracy collapses on **short**, **edited/paraphrased/"humanized"**, and **non-native-English** text. Vendor "99% accurate" claims describe raw, unedited model output only.
- Independent 2026 benchmarks **contradict each other** on which tool leads — rankings are unstable and marketing-driven.
- False positives have caused real-world harm (wrongful academic-misconduct accusations); OpenAI retired its own classifier for low accuracy.

The design therefore makes "signal, not proof" a **structural** property, not a UI disclaimer bolted on at the end:

- The result type cannot express a bare boolean verdict (§3).
- Reliability-reducing input characteristics are detected and surfaced as first-class `caveats` on every report.
- This holds regardless of which vendor is wired — the framing lives in our core, above any adapter.

This mirrors the metadata spec's deliberate split (§0 there): deterministic _outbound hygiene_ (the scrubber) is safe to rely on; probabilistic _inbound analysis_ (this tool) is a caveated guess, and the line between the two must stay crisp.

## 1. Module placement

Mirroring the codebase's existing tool packages (`whois`, `safe-browse`, `conversion`) and the integration ports-and-adapters foundation:

- **`@magna-carta/ai-detection`** — new **pure** TypeScript package. No D1, no Hono, no `env`, no Svelte, no network — fully unit-testable. All I/O arrives through injected ports (the integration framework's `CredentialStore` / `ConnectionStore` and an injected `HttpClient`), never imported directly.
- Files (indicative):
  - `src/port.ts` — `AiTextDetectionPort` (`detect`) + the input/output types.
  - `src/report.ts` — the `DetectionReport` model + the band/caveat enums.
  - `src/normalize.ts` — the vendor-agnostic normalizer (raw vendor score → our band; input characteristics → caveats). The valuable agnostic core.
  - `src/manifest.ts` — the `ai-detection` category registration + the deferred adapter's manifest/capability descriptor.
  - `src/adapters/deferred.ts` — the one runnable adapter shipped now: returns `capability-unsupported` (the descriptor declares `detect.supported = false`, so the honest signal is that the capability has not been wired to a concrete vendor, not that a connection is missing).
  - `src/consent.ts` — the confidentiality consent/policy types (declared now; the firm setting + gate are seams, §5).
  - `test/*` — purity, manifest well-formedness, normalizer logic, deferred-adapter Dispatch contract.

Why the **integration framework**, not the standalone `inference` pattern: detection is vendor-credentialed, request/response, with no streaming or durable-Workflow need. That is exactly what `Adapter<Port>` + `CapabilityDescriptor` + `IntegrationManifest` + the `Dispatch`/`IntegrationProblem` taxonomy + the credential stores already model. `inference` bypassed the framework only because it is credential-less (Cloudflare-managed) and needs streaming; neither applies here. Reuse before building (golden rule 1).

## 2. The port — our vocabulary, never a vendor's

```
interface DetectionInput {
  readonly text: string;
  readonly languageHint?: string;   // BCP-47; informs caveats, never required
  readonly firmId: FirmId;          // carried for tenancy + future metering, like InferencePort
}

interface AiTextDetectionPort {
  detect(input: DetectionInput): Promise<Dispatch<DetectionReport>>;
}
```

- Returns a typed **`Dispatch`** (the integrations sum), never a throw. A vendor/credential/transport failure becomes a first-class `not-connected` / `capability-unsupported` / `adapter-error` problem; the `category` drives retry and the connection-health state machine, exactly as other adapters.
- The port is named in our domain vocabulary, defined here in the consuming domain package — never a vendor's request/response shape.

## 3. The result model — a calibrated signal

`DetectionReport` is deliberately **not** a boolean. Indicative shape:

```
type LikelihoodBand = "unlikely" | "mixed" | "likely" | "inconclusive";

type Caveat =
  | "text-too-short"
  | "possible-paraphrase-or-humanization"
  | "non-target-language"
  | "mixed-or-edited-authorship"
  | "low-vendor-confidence";

interface DetectionReport {
  readonly band: LikelihoodBand;            // the headline — coarse on purpose
  readonly score: number;                   // normalized 0..1 (provenance/debug, not the headline)
  readonly reliability: "high" | "moderate" | "low"; // derived from input + caveats, NOT vendor marketing
  readonly caveats: readonly Caveat[];      // why the reader should hesitate
  readonly segments?: readonly SegmentScore[]; // optional per-passage breakdown (e.g. Copyleaks)
  readonly provenance: {
    readonly adapterId: string;
    readonly vendorModel?: string;
    readonly vendorVersion?: string;
    readonly detectedAt: string;            // ISO; passed in, never Date.now() in the pure core
    readonly egressedTo?: string;           // which external service saw the text (consent provenance, §5)
  };
}
```

- `band` is the headline and is **coarse by design** — `inconclusive` is a legitimate, common answer.
- `reliability` and `caveats` are computed by **our** normalizer from input characteristics, independent of the vendor's claimed confidence. A vendor returning "99% AI" on a 40-word snippet still yields `reliability: "low"` + `text-too-short`.
- `score` exists for provenance/auditing, not as the headline — the UI leads with the band and caveats.
- **Every §0 accuracy-collapse vector forces `inconclusive`:** short text, non-target-language input, suspected paraphrase/humanization, and mixed/edited authorship are all fatal caveats that bottom out reliability to `"low"` and force the headline `band` to `"inconclusive"`. Per-segment bands inherit this override — a segment cannot assert a direction when the overall input is unreliable. `score` is audit-only; consumers must always lead with `band`.

## 4. The normalizer — the agnostic heart (built now, real logic)

`normalize.ts` is the one piece of genuine domain logic shipped in this build (not deferred). Each adapter returns its raw vendor score; the normalizer:

1. maps the raw score into our `LikelihoodBand` (with an explicit `inconclusive` zone, not a forced binary);
2. inspects the input (length, language hint, simple paraphrase/edit signals) and emits `caveats`;
3. downgrades `reliability` accordingly.

This logic is **vendor-independent** — it is what guarantees the "signal, not proof" law holds no matter which adapter is wired, and it is fully unit-testable with no vendor present.

## 5. Confidentiality posture (declared now, gate wired later)

Sending privileged content to a third-party detector is the exact situation the AI-inference confidentiality decisions already govern (ADR-0109/0110): an **opt-in firm policy, off by default, with recorded consent.** This tool inherits that posture rather than inventing a new one.

- The core declares the consent/policy types (`src/consent.ts`) and the report carries `provenance.egressedTo` (REQUIRED — every detection is external, so every report must name where the privileged text went) so every external analysis is self-describing.
- The **firm setting**, the **UI consent gate**, and the **worker route** that enforces them are designed-in seams (a follow-on slice), consistent with how `inference` shipped its chokepoint before its consumer surfaces.
- An in-house engine option is **not** in scope — the owner's decision (2026-06-28) is to rely on an actively-maintained external vendor (detection is an arms race a static local model loses); confidentiality is handled by vendor zero-data-retention terms + recorded consent, not by keeping analysis in-tenant.
- **Additional designed-in seams (not yet built):**
  - The consent gate must mint a consent witness bound into the `detect()` call path so a vendor adapter cannot egress privileged text without recorded consent being in scope.
  - A vendor adapter's `IntegrationProblem.detail` must never echo the analyzed text — only error metadata, never the input.
  - `firmId` must be carried onto provenance and used to scope any cache key when per-firm metering lands.

## 6. Adapters & registry — complete scope, vendor deferred

- Register the **`ai-detection` category** and a single **deferred/unconfigured adapter** whose `detect` returns `capability-unsupported` (the descriptor declares `detect.supported = false`; there is no connection to be missing — the capability simply has not been wired to a concrete vendor yet). The package is whole and fully testable with **zero vendor wired**.
- Do **not** register per-vendor manifests yet (owner decision, 2026-06-28). Each vendor manifest + HTTP body is added when that vendor is actually chosen and built — no interface change, just a new adapter dropped into the registry (the conversion package's registered-but-deferred-engine pattern).
- **Credential scope is intentionally left open** (owner undecided 2026-06-28 between firm-provides-key / billed-service / absorbed-cost). The framework already represents `apiKey`/`oauth` at `firm` or `user` scope, plus platform-managed (the inference precedent); since no concrete adapter exists yet, nothing forces the choice. It is pinned when the first vendor is wired.
- Vendor research context (the shortlist, June-2026 pricing/terms, and the benchmark-instability finding) is captured in `docs/research/` for when that decision is made — Pangram, GPTZero, and Copyleaks are the confidentiality-cleared front-runners; the agnostic core makes the pick low-stakes.

## 7. Tools catalog + permission

One catalog row (`packages/tools/src/catalog.ts`):

```
{ id: "ai-text-detection", name: "AI-Text Detection", icon: <lucide>,
  subjectGroup: "documents", permission: assertPermission("tools:aiTextDetection"),
  contextTags: ["none"], backing: { kind: "integration", category: "ai-detection" },
  matterContext: "optional" }
```

- `subjectGroup: "documents"` — it acts on text/documents. (The metadata spec reserves a future `forensics` group for image forensics/AI-image detection; if that group ever lands, text detection may co-locate there as probabilistic-inbound analysis. Kept in `documents` now to avoid introducing an empty group.)
- `matterContext: "optional"` is the seam for the later matter-action; the standalone widget is the first consumer.
- A new `tools:aiTextDetection` permission key is registered in `@magna-carta/access-control`; role-seeding is the standard worker follow-on.

## 8. Testing

- **Purity fitness** — no D1/Hono/env/Svelte/network/vendor-SDK imports (mirrors `conversion`/`tools` purity tests).
- **Manifest well-formedness** — the `ai-detection` category + deferred adapter satisfy `isWellFormedManifest`.
- **Normalizer logic** — the part that must never mislead: band mapping (including the `inconclusive` zone), caveat emission on short/paraphrased/non-target-language input, and reliability downgrades. This is the highest-value test surface.
- **Deferred-adapter Dispatch contract** — `detect` returns `capability-unsupported`, never throws.
- End-of-build **7-angle adversarial review** per `docs/conventions/testing.md`.

## 9. Out of scope for this build (designed-in seams)

Concrete vendor HTTP adapter body · document **text-extraction** (paste-text first; `.docx`/`.pdf` extraction reuses the metadata/conversion engines later) · the **UI widget** (Tools shell) · the **firm consent setting + gate** · the **worker route** + permission seeding · the **matter-action** consumer · per-firm **metering**.
