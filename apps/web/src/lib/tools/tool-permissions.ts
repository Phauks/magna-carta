/*
 * What the member looking at the Tools area is allowed to use.
 *
 * MOCK SEAM. Real grants arrive with role seeding; until then the managing partner sees everything,
 * so this returns every permission the app's tool surfaces declare. It is one function rather than
 * a set built per screen because two seams drift: the listing and the workbench would have granted
 * different things, and the difference would have looked like a permission bug.
 *
 * The catalog supplies almost all of it, so a tool added there is granted here without this file
 * changing. The two that are not catalog tools are named explicitly rather than read off the
 * workbench's capability registry: that registry imports every capability panel, and importing it
 * from here would pull the whole workbench into the chunk the plain /tools listing loads. The
 * naming is held to the registry by a test instead — file-workbench-capabilities.test.ts fails if a
 * capability is gated on a permission this seam does not grant.
 *
 * When real grants land, this is the one call site that changes.
 */
import { assertPermission, type Permission } from "@magna-carta/access-control/registry";
import { CATALOG } from "@magna-carta/tools/catalog";

export function grantedPermissions(): ReadonlySet<Permission> {
  return new Set<Permission>([
    ...CATALOG.map((tool) => tool.permission),
    // The workbench's own surface, and the firm-wide scan its Malware Scan capability runs. Neither
    // is a catalog tool: the first gates the bench rather than a tool on it, and the second is a
    // firm capability the bench borrows.
    assertPermission("tools:fileWorkbench"),
    assertPermission("firm:scanFile"),
  ]);
}
