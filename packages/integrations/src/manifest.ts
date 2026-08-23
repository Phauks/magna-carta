import type { CapabilityDescriptor, CredentialRequirement } from "./port.ts";

// A plugin's self-description: pure data (no D1, no Hono, no env), so the core reads it to build the
// catalog and route mount, and the future per-Worker transport (the C seam) ships it unchanged. The
// worker pairs it with its route-registration + adapter binding (apps/api-worker/src/plugins). The
// marketplace fields (defaultEnablement, connectSchema, settingsSchema) are declared here so the
// contract is whole; the core leaves them dormant until the marketplace slice consumes them.
export interface IntegrationManifest {
  readonly id: string; // stable adapter id, e.g. "easypost"
  readonly category: string; // port category, e.g. "shipping"
  readonly displayName: string;
  readonly summary: string;
  readonly vendorUrl?: string;
  readonly credential: CredentialRequirement;
  readonly capability: CapabilityDescriptor;
  // Operational permission key (a key in @magna-carta/access-control's registry); null for
  // credential-less integrations with no protected operations.
  readonly permission: string | null;
  readonly defaultEnablement: "on" | "off";
  // Validated at the boundary by the marketplace slice; typed as unknown here so this pure package
  // takes no zod dependency in its contract surface.
  readonly connectSchema?: unknown;
  readonly settingsSchema?: unknown;
}

// Structural checks the fitness test runs over every registered manifest. Returns a list of
// human-readable problems (empty = well-formed). Cross-registry checks (permission exists,
// id uniqueness across the set) live in the worker fitness test, which can see those registries.
export function isWellFormedManifest(manifest: IntegrationManifest): string[] {
  const problems: string[] = [];
  if (manifest.id.trim() === "") problems.push("id must be non-empty");
  if (manifest.category.trim() === "") problems.push("category must be non-empty");
  if (manifest.capability.category !== manifest.category) {
    problems.push(
      `capability.category "${manifest.capability.category}" must equal category "${manifest.category}"`,
    );
  }
  if (manifest.capability.credential.kind !== manifest.credential.kind) {
    problems.push("capability.credential.kind must equal credential.kind");
  }
  return problems;
}
