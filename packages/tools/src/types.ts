import type { Permission } from "@magna-carta/access-control/registry";

// One subject per group. This order is the fixed render order of the Tools sidebar.
export const SUBJECT_GROUP_ORDER = [
  "property",
  "business-entities",
  "people-licenses",
  "mailing-shipping",
  "printing",
  "web-domains", // website/domain subjects — WHOIS lookup, safe website viewer
  "files", // file utilities — inspect / repair / convert / hash / verify a file, matter-free
  "diagnostics", // connectivity / system tests — no legal subject (e.g. a network speed test)
] as const;

export type SubjectGroup = (typeof SUBJECT_GROUP_ORDER)[number];

// What real-world input a tool acts on — drives contextual surfacing. `none` = general-only.
export type ContextTag = "address" | "person" | "company" | "matter" | "website" | "file" | "none";

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
  /**
   * Where the tool's surface lives, when it is not the usual `/tools/<id>`. Almost every tool is
   * reached inside the Tools area and derives its address from its id; a tool that has outgrown
   * that area and earned a sidebar destination of its own is addressed at the top level instead,
   * and says so here. The manifest row stays either way, because the contextual surfacing path
   * queries this catalog by context tag and a tool absent from it is a tool nothing can offer.
   */
  readonly route?: string;
}
