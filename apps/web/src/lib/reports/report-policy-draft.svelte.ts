/*
 * The firm's report policy as a draft the settings page can stage and save — server-backed, on the
 * calendar settings draft's pattern (calendar-settings-draft.svelte.ts says why a firm setting with
 * a server behind it keeps no per-browser copy and writes no per-browser history).
 *
 * Two settings, both about the trust-compliance document: whether a matter ledger at zero all
 * period appears, and whether the member who authorized each payment is named. Every question the
 * settings rows and footer ask is answered from the one read of GET /api/v1/firm/reports/policy; a
 * save is PATCH on the same route, audited there, and the value in force is what the server said
 * back. A save that fails keeps the stage, with the failure beside it.
 */
import type { Failure } from "$lib/api/request.ts";
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
import {
  readFirmReportPolicy,
  updateFirmReportPolicy,
  type FirmReportPolicy,
  type TrustComplianceListing,
} from "./reports-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const REPORTS_SETTINGS_SECTION_ID = "reports";

export const ZERO_BALANCE_LEDGERS_DEFINITION: SettingDefinition = {
  id: "reports.trust-compliance.zero-balance-ledgers",
  sectionId: REPORTS_SETTINGS_SECTION_ID,
  plateLabel: "The Trust Compliance Report",
  label: "Ledgers at Zero All Period",
  description:
    "Whether matter ledgers with no activity this period are listed at zero, so the report shows every ledger.",
  kind: "select",
  options: [
    { value: "include", label: "Listed" },
    { value: "omit", label: "Omitted" },
  ],
  defaultValue: "include",
  sensitivity: "open",
  audited: true,
};

export const AUTHORIZERS_DEFINITION: SettingDefinition = {
  id: "reports.trust-compliance.authorizers",
  sectionId: REPORTS_SETTINGS_SECTION_ID,
  plateLabel: "The Trust Compliance Report",
  label: "Who Authorized Each Payment",
  description:
    "Whether ledgers and the journal name the staff member who approved money leaving a client ledger.",
  kind: "select",
  options: [
    { value: "include", label: "Named" },
    { value: "omit", label: "Omitted" },
  ],
  defaultValue: "include",
  sensitivity: "open",
  audited: true,
};

export const REPORT_POLICY_DEFINITIONS: readonly SettingDefinition[] = [
  ZERO_BALANCE_LEDGERS_DEFINITION,
  AUTHORIZERS_DEFINITION,
];

type PolicyKey = "zeroBalanceLedgers" | "authorizers";

const KEY_BY_DEFINITION: Readonly<Record<string, PolicyKey>> = {
  [ZERO_BALANCE_LEDGERS_DEFINITION.id]: "zeroBalanceLedgers",
  [AUTHORIZERS_DEFINITION.id]: "authorizers",
};

/** The wire value a select choice stands for; null for a string the vocabulary does not carry. */
export function listingFromValue(value: SettingValue): TrustComplianceListing | null {
  return value === "include" || value === "omit" ? value : null;
}

const DEFAULT_POLICY: FirmReportPolicy = {
  trustCompliance: { zeroBalanceLedgers: "include", authorizers: "include" },
};

export class ReportPolicyDraft extends SettingsDraft {
  /** What the server said the firm's policy is; null until the read lands. */
  committed = $state<FirmReportPolicy | null>(null);
  readFailure = $state<Failure | null>(null);
  /** The staged values, held only while they differ from the committed ones. */
  #staged = $state<Partial<Record<PolicyKey, TrustComplianceListing>>>({});
  saving = $state(false);
  saveFailure = $state<Failure | null>(null);
  #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    super(REPORTS_SETTINGS_SECTION_ID);
    this.#fetchImpl = fetchImpl;
  }

  get loaded(): boolean {
    return this.committed !== null;
  }

  async load(): Promise<void> {
    const outcome = await readFirmReportPolicy(this.#fetchImpl);
    if (outcome.kind === "ok") {
      this.committed = outcome.value;
      this.readFailure = null;
    } else {
      this.readFailure = outcome.failure;
    }
  }

  #committedValue(key: PolicyKey): TrustComplianceListing {
    return (this.committed ?? DEFAULT_POLICY).trustCompliance[key];
  }

  override value(definition: SettingDefinition): SettingValue {
    const key = KEY_BY_DEFINITION[definition.id];
    return key === undefined ? definition.defaultValue : this.#committedValue(key);
  }

  override stagedValue(definition: SettingDefinition): SettingValue {
    const key = KEY_BY_DEFINITION[definition.id];
    if (key === undefined) return definition.defaultValue;
    return this.#staged[key] ?? this.#committedValue(key);
  }

  override stage(definition: SettingDefinition, next: SettingValue): void {
    const key = KEY_BY_DEFINITION[definition.id];
    if (key === undefined) return;
    const listing = listingFromValue(next);
    const staged = { ...this.#staged };
    // A value the vocabulary does not carry, or the committed value staged back, is no change.
    if (listing === null || listing === this.#committedValue(key)) delete staged[key];
    else staged[key] = listing;
    this.#staged = staged;
  }

  override isStaged(definition: SettingDefinition): boolean {
    const key = KEY_BY_DEFINITION[definition.id];
    return key !== undefined && this.#staged[key] !== undefined;
  }

  override get stagedCount(): number {
    return Object.keys(this.#staged).length;
  }

  override get stagedEntries(): ReadonlyArray<{
    definition: SettingDefinition;
    from: SettingValue;
    to: SettingValue;
  }> {
    return REPORT_POLICY_DEFINITIONS.flatMap((definition) => {
      const key = KEY_BY_DEFINITION[definition.id];
      const to = key === undefined ? undefined : this.#staged[key];
      if (key === undefined || to === undefined) return [];
      return [{ definition, from: this.#committedValue(key), to }];
    });
  }

  override get requiresConfirm(): boolean {
    return false;
  }

  override discard(): void {
    this.#staged = {};
    this.saveFailure = null;
  }

  override save(): void {
    void this.commit();
  }

  async commit(): Promise<void> {
    const staged = this.#staged;
    if (Object.keys(staged).length === 0 || this.saving) return;
    this.saving = true;
    this.saveFailure = null;
    // One key per attempt: a retry after a failure is a new attempt, and a duplicate of a landed
    // one is what the key on the server catches.
    const outcome = await updateFirmReportPolicy(
      this.#fetchImpl,
      { trustCompliance: staged },
      crypto.randomUUID(),
    );
    this.saving = false;
    if (outcome.kind !== "ok") {
      this.saveFailure = outcome.failure;
      return;
    }
    this.committed = outcome.value;
    this.#staged = {};
  }
}
