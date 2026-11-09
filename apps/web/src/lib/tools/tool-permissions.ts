/*
 * What the member is allowed to run: every tool in the rail, the File Workbench's capability tabs,
 * and the few destinations gated by a permission of their own.
 *
 * MOCK SEAM. Real grants arrive with role seeding; until then the managing partner sees everything,
 * so this returns every permission the app's tool surfaces declare. It is one function rather than
 * a set built per screen because two seams drift: the listing and the workbench would have granted
 * different things, and the difference would have looked like a permission bug.
 *
 * The catalog supplies the tools. The workbench's capability permissions are named explicitly here
 * rather than read off its capability registry: every capability module imports a Lucide icon, so
 * importing that registry from here would pull ten Svelte components (and the conversion format
 * graph behind Convert) into the chunk the plain /tools listing loads. The naming is held to the
 * registry by a test instead — file-workbench-capabilities.test.ts fails if a capability is gated
 * on a permission this seam does not grant.
 *
 * These ten used to arrive through the catalog, because each capability had a sibling tool manifest
 * declaring the same permission. Those manifests were retired into the tabs they had always been,
 * which took their permissions out of CATALOG with them and would have emptied the workbench of
 * every tab. They are listed here for that reason: the permissions outlived the rows.
 *
 * When real grants land, this is the one call site that changes.
 *
 * THE SESSION'S REAL GRANTS ARE UNIONED IN. A destination gated on a permission this seam does not
 * name — Meetings, on `meetings:join` — was filtered out of the rail and the palette for every
 * member, including the ones the server had granted it to, because the gate only ever asked this
 * list. The bootstrap session already carries the member's own permissions, so whatever the server
 * says the member holds is held here too. It only ever adds: the mock grants above stay until real
 * grants replace them, and a session that has not answered yet adds nothing, so a gated row
 * appears once the read lands rather than flashing in and out.
 */
import {
  assertPermission,
  isPermission,
  type Permission,
} from "@magna-carta/access-control/registry";
import { CATALOG } from "@magna-carta/tools/catalog";
import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";

export function grantedPermissions(): ReadonlySet<Permission> {
  return new Set<Permission>([
    ...CATALOG.map((tool) => tool.permission),
    // Firm Usage is no longer a tool — it is a Firm destination (navigation/destinations.ts), which
    // is where a firm reading its own consumption belongs. Its permission did not move with it into
    // CATALOG's map above, so it is named here: the row is gated exactly as it always was, and a
    // gate that quietly stopped applying would have been the worst of the two outcomes.
    assertPermission("tools:firmUsage"),
    // The bench itself, and the firm-wide scan its Malware Scan capability borrows.
    assertPermission("tools:fileWorkbench"),
    assertPermission("firm:scanFile"),
    // One per capability tab, in the registry's own order.
    assertPermission("tools:fileTypeVerifier"),
    assertPermission("tools:fileIntegrity"),
    assertPermission("tools:metadataScrubber"),
    assertPermission("tools:emailInspector"),
    assertPermission("tools:fileConverter"),
    assertPermission("tools:fileRepair"),
    assertPermission("tools:ocr"),
    assertPermission("tools:decryption"),
    assertPermission("tools:aiTextDetection"),
    ...(sessionPermissions.session?.permissions ?? []).filter(isPermission),
  ]);
}
