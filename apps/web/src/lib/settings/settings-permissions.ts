/*
 * The settings permission seam — the one place settings pages ask "may this member edit this
 * firm area?". A pure function, no storage, no session: today it is a mock that grants
 * "billing" and denies everything else, so both page postures stay demonstrable (Billing
 * renders the editable draft flow, Firm profile renders read-only). The real check reads the
 * member's permission grants when authentication and firm accounts arrive; callers keep the
 * same call site.
 */

/** Mirrors SettingsSection.editPermissionArea (settings-sections.ts). */
export type SettingsPermissionArea = "firm" | "billing" | "documents" | "integrations";

export function canEditFirmSettings(area: SettingsPermissionArea): boolean {
  return area === "billing";
}
