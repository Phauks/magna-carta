import type { Permission } from "@magna-carta/access-control/registry";

// One subject per group. This order is the fixed render order of the Tools sidebar.
export const SUBJECT_GROUP_ORDER = [
  "property",
  "business-entities",
  "people-licenses",
  "mailing-shipping",
  "printing",
  "documents", // file utilities — e.g. the general file converter
  "diagnostics", // connectivity / system tests — no legal subject (e.g. a network speed test)
] as const;

export type SubjectGroup = (typeof SUBJECT_GROUP_ORDER)[number];

// What real-world input a tool acts on — drives contextual surfacing. `none` = general-only.
export type ContextTag = "address" | "person" | "company" | "matter" | "none";

// `library` = self-contained, no connection and no credential — a pure link generator OR an
// interactive client-side widget; the difference is purely UI, handled by the shell. `integration`
// names an integration category whose connection state the shell reflects; this package stores only
// the string and never touches the framework or credentials.
export type ToolBacking =
  | { readonly kind: "library" }
  | { readonly kind: "integration"; readonly category: string };

// Whether a tool's output/cost/audit attaches to a matter. A seam: the behaviour is decided per tool
// when its UI is built. Default "none".
export type MatterContext = "required" | "optional" | "none";

export interface ToolManifest {
  readonly id: string; // stable, kebab-case
  readonly name: string; // display label
  readonly icon: string; // Lucide icon name; the shell resolves it to a component
  readonly subjectGroup: SubjectGroup; // primary grouping in the sidebar
  readonly permission: Permission; // gates visibility on BOTH surfaces
  readonly contextTags: readonly ContextTag[]; // >=1; what the tool accepts
  readonly backing: ToolBacking;
  readonly matterContext: MatterContext;
}
