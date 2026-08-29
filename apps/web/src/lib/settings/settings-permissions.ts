/*
 * The settings permission seam — the one place settings pages ask "may this member edit this firm
 * area?". A pure function, no storage, no session: today it is still a mock (the member may edit
 * "billing" and nothing else), so every page posture stays demonstrable — Billing renders the
 * editable draft flow, Firm profile renders read-only. The real check reads the member's permission
 * grants when the settings areas map onto registry keys; callers keep the same call site.
 *
 * The firm ROSTER used to live here too, as a fixed cast of four invented colleagues. It does not
 * any more: the firm's own members are a real read (`$lib/members/firm-roster.svelte.ts` over
 * `GET /api/v1/members`), and a mock roster beside a real one is a second answer to who works here.
 *
 * What went with it is `administratorsForPermissionArea`, and its absence is deliberate rather than
 * pending. That function narrowed the invented roster by an invented field — which settings areas
 * each mock colleague could edit — and nothing on the server answers that question: the roster
 * carries a member's ROLES, not the settings surfaces their permissions reach. Keeping the name
 * over the real roster would have meant either returning everyone under a label that says
 * "administrators", or guessing from role names. The composer now offers the firm's colleagues with
 * each one's role beside their name and lets the person choose, which is true today; a real
 * narrowing lands when settings areas are expressed as registry permissions and the server can be
 * asked who holds one.
 */

/** Mirrors SettingsSection.editPermissionArea (settings-sections.ts). */
export type SettingsPermissionArea = "firm" | "billing" | "documents" | "integrations";

export function canEditFirmSettings(area: SettingsPermissionArea): boolean {
  return area === "billing";
}
