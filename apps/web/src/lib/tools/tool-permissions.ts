/*
 * What the member looking at the Tools area is allowed to use.
 *
 * MOCK SEAM. Real grants arrive with role seeding; until then the managing partner sees everything,
 * so this returns every permission the app's tool surfaces declare. It is one function rather than
 * a set built per screen because two seams drift: the listing and the workbench would have granted
 * different things, and the difference would have looked like a permission bug.
 *
 * The set is derived from the declarations themselves — the catalog's tools and the workbench's
 * capabilities — so a tool or capability added anywhere is granted here without this file changing.
 * When real grants land, this is the one call site that changes.
 */
import { type Permission } from "@magna-carta/access-control/registry";
import { CATALOG } from "@magna-carta/tools/catalog";
import { CAPABILITIES } from "./file-workbench/capabilities.ts";
import { overviewCapability } from "./file-workbench/overview.ts";

export function grantedPermissions(): ReadonlySet<Permission> {
  return new Set<Permission>([
    ...CATALOG.map((tool) => tool.permission),
    // The workbench's capabilities are not all catalog tools: the malware scan is gated by the
    // firm-wide scan permission, and the Overview by the workbench's own.
    overviewCapability.permission,
    ...CAPABILITIES.map((capability) => capability.permission),
  ]);
}
