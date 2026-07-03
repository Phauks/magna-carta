import type { IntegrationManifest } from "@magna-carta/integrations/manifest";
import type { CapabilityDescriptor } from "@magna-carta/integrations/port";

// One detection category, many vendor adapters across the credential boundary (the conversion/
// government-links pattern). No concrete vendor is registered yet; the deferred adapter keeps the
// category whole and callable until a vendor is chosen and wired.
export const AI_DETECTION_CATEGORY = "ai-detection";

// The deferred adapter is credential-less and supports nothing — the descriptor says so, so callers
// degrade gracefully instead of calling an operation that cannot run.
export const deferredCapability: CapabilityDescriptor = {
  adapterId: "deferred",
  category: AI_DETECTION_CATEGORY,
  credential: { kind: "none" },
  operations: { detect: { supported: false } },
  passthroughAvailable: false,
};

export const aiDetectionManifest: IntegrationManifest = {
  id: "deferred",
  category: AI_DETECTION_CATEGORY,
  displayName: "AI-Text Detection",
  summary: "Estimate the likelihood that text was machine-generated. Returns a signal, not proof.",
  credential: { kind: "none" },
  capability: deferredCapability,
  permission: "tools:aiTextDetection",
  defaultEnablement: "off",
};
