import type { Permission } from "@magna-carta/access-control/registry";

/*
 * One subject per group — the clusters the rail folds the tools into. They are named for what a
 * member is DOING rather than for the technology behind it ("Internet", not "web-domains"), and
 * they are deliberately few: eight groups over nine tools is a heading per tool, which is no
 * grouping at all.
 *
 * This order is the clusters' order in the rail. Within a cluster the tools sort ALPHABETICALLY by
 * name (select.ts), because a member looking for a named tool scans for its name — a catalog
 * insertion order is the author's convenience and nobody else's.
 */
export const SUBJECT_GROUP_ORDER = [
  "records", // public registers and record lookups — property, companies, licenses
  "internet", // the network and what is on it — WHOIS, an untrusted site, this connection
  "mailing", // what the firm sends — postage, labels, and printing
  "files", // a file that belongs to no matter — read, verify, repair, convert
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
}
