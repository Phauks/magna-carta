import type { NaturalLanguageInstanceConfiguration } from "./natural-language-instance.ts";

// The management side of the managed natural-language index: create an instance, destroy one, and
// read back what the service says about a sync. Separate from `NaturalLanguageSearchPort` because it
// is a different binding with a different lifetime — the query path resolves an instance handle and
// makes one call, and this path is queue-dispatched work that runs nowhere near a request.
//
// Every operation returns a typed outcome and nothing throws, so a provisioning job pattern-matches
// on the answer and records it. There is deliberately no `list()` operation and there must not be
// one: the platform's own control-plane row is the catalog of which firms have instances, for the
// same reason the split catalog exists rather than a bucket listing. Asking the service what exists
// makes the service the authority on a fact this platform owns, and makes an outage look like a firm
// having no instance.

export interface NaturalLanguageInstanceCreateInput {
  /** The derived, opaque instance name. Repeating a create with the same name converges rather than duplicating. */
  readonly instanceName: string;
  /** The firm's own bucket, and the key prefix within it the feed lives under. */
  readonly bucketName: string;
  readonly keyPrefix: string;
  readonly configuration: NaturalLanguageInstanceConfiguration;
}

export interface NaturalLanguageInstanceRecord {
  /** The identifier the service returned. Recorded verbatim; never parsed for meaning. */
  readonly instanceIdentifier: string;
  readonly instanceName: string;
}

// A teardown records what it can DEMONSTRATE and asserts nothing else.
//
// The platform deletes the extracted text it wrote, from storage it owns, and can enumerate the
// catalog to show it. Deletion of the managed index is a request to a service whose documentation
// states that a delete operation exists and does not state what it guarantees about the vectors, the
// keyword index, the converted text, or within what interval. So the response is recorded verbatim
// and nothing is concluded from it — `acknowledged` means the service accepted the request, not that
// anything is gone.
export interface NaturalLanguageInstanceTeardownRecord {
  readonly acknowledged: boolean;
  /** Whatever the service said, kept as-is so a later question can be answered from the record. */
  readonly response: string;
}

export interface NaturalLanguageSyncStatus {
  /** The instant of the last completed sync, or null when the service reports none. */
  readonly lastCompletedAt: string | null;
}

export type NaturalLanguageProvisioningFailureReason =
  // No binding in this deployment. The same honest not-configured answer the query port gives.
  | "binding-not-configured"
  // The call was made and the service refused or failed it.
  | "adapter-error";

export interface NaturalLanguageProvisioningFailure {
  readonly ok: false;
  readonly reason: NaturalLanguageProvisioningFailureReason;
  readonly detail?: string;
}

export type NaturalLanguageInstanceCreateResult =
  | { readonly ok: true; readonly record: NaturalLanguageInstanceRecord }
  | NaturalLanguageProvisioningFailure;

export type NaturalLanguageInstanceTeardownResult =
  | { readonly ok: true; readonly record: NaturalLanguageInstanceTeardownRecord }
  | NaturalLanguageProvisioningFailure;

export type NaturalLanguageSyncStatusResult =
  | { readonly ok: true; readonly status: NaturalLanguageSyncStatus }
  | NaturalLanguageProvisioningFailure;

export type NaturalLanguageKeepAliveResult =
  | { readonly ok: true }
  | NaturalLanguageProvisioningFailure;

export interface NaturalLanguageProvisioningPort {
  createInstance(
    input: NaturalLanguageInstanceCreateInput,
  ): Promise<NaturalLanguageInstanceCreateResult>;
  destroyInstance(instanceName: string): Promise<NaturalLanguageInstanceTeardownResult>;
  syncStatus(instanceName: string): Promise<NaturalLanguageSyncStatusResult>;
  /**
   * One trivial full-text query, to keep an instance's scheduled syncs from being paused for
   * inactivity. Metered as a platform query so it is never mistaken for a member's.
   */
  keepAlive(instanceName: string): Promise<NaturalLanguageKeepAliveResult>;
}

// ── Smart constructors ──────────────────────────────────────────────────────

export function naturalLanguageInstanceCreated(
  record: NaturalLanguageInstanceRecord,
): NaturalLanguageInstanceCreateResult {
  return { ok: true, record };
}

export function naturalLanguageInstanceTornDown(
  record: NaturalLanguageInstanceTeardownRecord,
): NaturalLanguageInstanceTeardownResult {
  return { ok: true, record };
}

export function naturalLanguageSyncStatusRead(
  status: NaturalLanguageSyncStatus,
): NaturalLanguageSyncStatusResult {
  return { ok: true, status };
}

export function naturalLanguageKeptAlive(): NaturalLanguageKeepAliveResult {
  return { ok: true };
}

export function naturalLanguageProvisioningNotConfigured(): NaturalLanguageProvisioningFailure {
  return {
    ok: false,
    reason: "binding-not-configured",
    detail: "no managed search management binding in this deployment",
  };
}

export function naturalLanguageProvisioningAdapterError(
  detail: string,
): NaturalLanguageProvisioningFailure {
  return { ok: false, reason: "adapter-error", detail };
}

// The port a deployment with no management binding resolves to. Every operation reports
// `binding-not-configured` — the same discipline as the query port's default: an unconfigured
// deployment produces an obviously-unavailable feature, never a provisioning job that appears to
// have succeeded. A logging adapter that resolved cleanly here would mean a control-plane row
// recorded `ready` against an instance that does not exist.
export const notConfiguredNaturalLanguageProvisioningPort: NaturalLanguageProvisioningPort = {
  createInstance: () => Promise.resolve(naturalLanguageProvisioningNotConfigured()),
  destroyInstance: () => Promise.resolve(naturalLanguageProvisioningNotConfigured()),
  syncStatus: () => Promise.resolve(naturalLanguageProvisioningNotConfigured()),
  keepAlive: () => Promise.resolve(naturalLanguageProvisioningNotConfigured()),
};
