/*
 * The settings permission seam — the one place settings pages ask "may this member edit this firm
 * area?".
 *
 * It used to be a mock: a constant that said yes to "billing" and no to everything else, so that
 * one page could demonstrate the editable draft flow and another the read-only one. That made every
 * firm page's posture theatre, and it made each new page choose between the mock and a hand-rolled
 * session read — which is why Calendar, Reports and Matter Numbering each grew their own. It now
 * asks the session, through the shared reader every other control uses
 * (src/lib/access/session-permissions.svelte.ts). The call sites are unchanged.
 *
 * AN AREA IS COARSER THAN A PERMISSION, DELIBERATELY. A section declares the area its edits belong
 * to, and this maps the area to the capability that stands for "may set this firm's policy here".
 * Where a page's own controls are governed by something narrower — the matter-plan editor by
 * `tasks:managePlans`, the intake editor by `intake:manageProcedures` — the page reads that key
 * from the session itself and this answer decides only the page's posture and the nav's "View" tag.
 * The two never contradict each other: the server refuses on the narrow key regardless, so the
 * worst a coarse yes can do is offer a control that is then honestly refused, and a coarse no never
 * hides a capability the member holds because every such page checks its own key.
 *
 * FALSE UNTIL THE READ LANDS, and false when it fails. A settings page that renders read-only for a
 * moment and then becomes editable is right; one that offers an edit and then refuses it is not.
 *
 * The firm ROSTER used to live here too, as a fixed cast of four invented colleagues. It does not
 * any more: the firm's own members are a real read (`$lib/members/firm-roster.svelte.ts` over
 * `GET /api/v1/members`), and a mock roster beside a real one is a second answer to who works here.
 */
import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";

/** Mirrors SettingsSection.editPermissionArea (settings-sections.ts). */
export type SettingsPermissionArea =
  | "firm"
  | "billing"
  | "documents"
  | "integrations"
  | "calendar"
  | "reports"
  | "meetings"
  | "ai"
  | "retention";

/**
 * The capability that stands for each area — what a firm grants when it means "you may set our
 * policy here". Each is a real registry key checked by the routes behind that area's pages.
 */
const AREA_PERMISSIONS: Readonly<Record<SettingsPermissionArea, string>> = {
  // The firm administering itself: who is a member, and what they hold. The Firm group's other
  // pages carry narrower rights of their own and read them directly.
  firm: "firm:manageMembers",
  // The firm's billing arrangements, tax rates, numbering and account-role map.
  billing: "billing:configure",
  // What uploads are allowed to do — the per-firm scan policy behind File Safety.
  documents: "firm:manageScanPolicy",
  // Integration credentials live in the per-firm encrypted secret store, so the right to manage
  // that store is the right to connect the firm to anything.
  integrations: "firm:manageSecrets",
  calendar: "calendar:manage",
  reports: "firm:manageReportPolicy",
  // Whether the firm's meetings may be recorded, captioned and summarized at all. Its own key rather
  // than meetings:record: recording one meeting is a practitioner's act, deciding that every
  // meeting may be recorded is the firm's.
  meetings: "meetings:manageSettings",
  // Whether the firm's content may reach a model at all, and whether the assistant may send it.
  // Its own key rather than firm:manageMembers: consenting to privileged client content leaving
  // the platform is not an act of administering who works here.
  ai: "firm:manageAiSettings",
  // How long a closed matter's paper file is kept: the firm's policy, not a choice for whoever is
  // closing a matter.
  retention: "matters:manageRetention",
};

/** Whether the signed-in member may edit this firm area. False until the session read lands. */
export function canEditFirmSettings(area: SettingsPermissionArea): boolean {
  return sessionPermissions.holds(AREA_PERMISSIONS[area]);
}
