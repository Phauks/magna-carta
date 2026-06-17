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

// The general (sidebar) surface: permitted tools grouped by subject, groups in the fixed order,
// empty groups omitted, tools in catalog order within a group.
export function toolsByGroup(
  catalog: readonly ToolManifest[],
  permissions: ReadonlySet<Permission>,
): GroupedTools[] {
  const grouped: GroupedTools[] = [];
  for (const group of SUBJECT_GROUP_ORDER) {
    const tools = catalog.filter(
      (tool) => tool.subjectGroup === group && permitted(tool, permissions),
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
