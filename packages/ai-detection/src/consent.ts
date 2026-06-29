// Sending privileged text to a third-party detector inherits the platform's AI-confidentiality
// posture: an opt-in firm policy, OFF by default, with recorded consent. The firm setting, the UI
// consent gate, and the worker route that enforce this are downstream consumers; this module is the
// shared vocabulary they bind to.

export type DetectionConsentScope = "engagement" | "per-matter";

export interface DetectionPolicy {
  readonly externalDetectionEnabled: boolean;
  readonly consentScope: DetectionConsentScope;
}

export function defaultDetectionPolicy(): DetectionPolicy {
  return { externalDetectionEnabled: false, consentScope: "engagement" };
}
