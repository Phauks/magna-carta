/*
 * The settings permission seam — the one place settings pages ask "may this member edit this
 * firm area?", plus the roster of who CAN. Pure functions, no storage, no session: today both
 * are mocks (the member may edit "billing" and nothing else; the roster is a fixed cast), so
 * every page posture stays demonstrable — Billing renders the editable draft flow, Firm profile
 * renders read-only. The real checks read the member's permission grants and the firm's member
 * directory when authentication and firm accounts arrive; callers keep the same call sites.
 */

/** Mirrors SettingsSection.editPermissionArea (settings-sections.ts). */
export type SettingsPermissionArea = "firm" | "billing" | "documents" | "integrations";

export function canEditFirmSettings(area: SettingsPermissionArea): boolean {
  return area === "billing";
}

/**
 * A firm member who holds edit rights over one or more settings areas — the audience a change
 * request can be addressed to.
 */
export interface FirmAdministrator {
  readonly id: string;
  readonly name: string;
  /** The role line shown beside the name — context for choosing whom to ask. */
  readonly role: string;
  readonly permissionAreas: readonly SettingsPermissionArea[];
}

/*
 * Mock roster seam. The change-request dialog addresses a request to real names — a request
 * "to whoever" gives no administrator a reason to feel it was meant for them. The firm member
 * directory replaces this list when firm accounts arrive; the function below is the contract
 * that survives the swap.
 */
const FIRM_ADMINISTRATORS: readonly FirmAdministrator[] = [
  {
    id: "member-goldsmith",
    name: "Trevor Goldsmith",
    role: "Managing partner",
    permissionAreas: ["firm", "billing", "documents", "integrations"],
  },
  {
    id: "member-paget",
    name: "Amelia Paget",
    role: "Firm administrator",
    permissionAreas: ["firm", "documents"],
  },
  {
    id: "member-vance",
    name: "Rowan Vance",
    role: "Billing administrator",
    permissionAreas: ["billing"],
  },
];

/** The administrators holding an area's edit right — a change request's eligible recipients. */
export function administratorsForPermissionArea(
  area: SettingsPermissionArea,
): readonly FirmAdministrator[] {
  return FIRM_ADMINISTRATORS.filter((administrator) =>
    administrator.permissionAreas.includes(area),
  );
}
