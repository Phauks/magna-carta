import type { Permission } from "@magna-carta/access-control/registry";
import {
  SUBJECT_GROUP_ORDER,
  type ContextTag,
  type SubjectGroup,
  type ToolManifest,
} from "./types.ts";

export interface GroupedTools {
  readonly group: SubjectGroup;
  readonly tools: ToolManifest[];
}

// A tool is visible iff the principal holds its permission. Both surfaces share this gate.
function permitted(tool: ToolManifest, permissions: ReadonlySet<Permission>): boolean {
  return permissions.has(tool.permission);
}

// The general (rail) surface: permitted tools grouped by subject, clusters in the fixed order,
// empty clusters omitted, tools ALPHABETICAL by name within a cluster.
//
// Alphabetical rather than catalog order, and it is the default rather than a setting: a member who
// comes to the rail for a tool comes with its name in mind, so the order that answers fastest is the
// one their eye can binary-search. Catalog order is the order rows were written, which is a fact
// about this repository and not about the firm. Comparison is locale-aware and case-insensitive
// (`undefined` locale = the runtime's), so "eDiscovery" sorts beside "Email" rather than ahead of
// every capital.
export function toolsByGroup(
  catalog: readonly ToolManifest[],
  permissions: ReadonlySet<Permission>,
): GroupedTools[] {
  const grouped: GroupedTools[] = [];
  for (const group of SUBJECT_GROUP_ORDER) {
    const tools = catalog
      .filter((tool) => tool.subjectGroup === group && permitted(tool, permissions))
      .toSorted((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
    if (tools.length > 0) grouped.push({ group, tools });
  }
  return grouped;
}

// The contextual surface: permitted tools that accept `tag`, in catalog order. A Location page calls
// toolsFor("address"); a Directory person calls toolsFor("person"); a new matching tool added to the
// catalog appears there with no change to the calling page.
export function toolsFor(
  catalog: readonly ToolManifest[],
  tag: ContextTag,
  permissions: ReadonlySet<Permission>,
): ToolManifest[] {
  return catalog.filter((tool) => tool.contextTags.includes(tag) && permitted(tool, permissions));
}
