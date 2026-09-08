/*
 * Permission keys, said in the firm's words.
 *
 * A permission is `<subsystem>:<action>` — `matters:renumber`, `trust:authorize` — which is exactly
 * right for the code that checks it and exactly wrong for the person deciding whether a paralegal
 * should hold it. This module turns a key into two readable halves: the area of the practice it
 * belongs to, and what it lets somebody do.
 *
 * DERIVED, NOT TRANSCRIBED. The alternative was a hand-written sentence per key, and there are
 * nearly two hundred keys — a table that size goes stale the first time a subsystem lands and
 * nobody remembers this file exists, and a stale sentence about what somebody may do is worse than
 * no sentence. So the area names are a curated map (they are proper nouns of the product, and there
 * are a few dozen), and the action is derived from the key itself. A namespace with no entry falls
 * back to its own name rather than disappearing, so a new subsystem's keys are readable the day
 * they land and merely unpolished until somebody names the area here.
 *
 * The key itself is always shown beside the words. A person granting a capability should be able to
 * see precisely what they are granting, and a humanized phrase is a summary of a key rather than a
 * replacement for one.
 */

/** The areas of the practice, by permission namespace. A namespace absent here reads as itself. */
const AREA_NAMES: Readonly<Record<string, string>> = {
  billing: "Billing and invoicing",
  calendar: "Calendar and deadlines",
  communications: "Calls and texts",
  conflicts: "Conflicts checking",
  costs: "Costs and disbursements",
  custody: "Safekeeping register",
  customFields: "Custom fields",
  diagnostics: "Diagnostics",
  directory: "Directory",
  discovery: "Discovery",
  documents: "Documents",
  downloads: "Downloads",
  emails: "Email filing",
  esign: "E-signature",
  files: "Files",
  firm: "The firm",
  incidents: "Incident reports",
  intake: "Intake",
  locations: "Offices",
  magnus: "Magnus",
  matterAssets: "Matter assets",
  matters: "Matters",
  notes: "Matter notes",
  notifications: "Notifications",
  reports: "Reports",
  search: "Search",
  shipping: "Shipping and postage",
  support: "Support access",
  tasks: "Tasks",
  templates: "Document templates",
  time: "Time tracking",
  tools: "Tools",
  trust: "Trust accounting",
};

/** The area a permission belongs to, in the firm's words. */
export function permissionAreaName(permission: string): string {
  const namespace = permission.split(":")[0] ?? permission;
  return AREA_NAMES[namespace] ?? namespace;
}

/**
 * What the permission lets somebody do, as a short phrase: `manageReportPolicy` becomes "manage
 * report policy". Acronyms the platform uses as words keep their casing, because "utbms" reads as
 * a typo where "UTBMS" reads as the code set it is.
 */
const KEPT_UPPERCASE: ReadonlySet<string> = new Set(["utbms", "pii", "sms", "ocr", "url"]);

export function permissionActionPhrase(permission: string): string {
  const action = permission.split(":")[1] ?? "";
  if (action === "") return permission;
  const words = action
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(" ");
  return words.map((word) => (KEPT_UPPERCASE.has(word) ? word.toUpperCase() : word)).join(" ");
}

/** One area and the permissions a role carries inside it. */
export interface PermissionArea {
  readonly name: string;
  readonly permissions: readonly string[];
}

/**
 * A role's permissions gathered into areas, areas in alphabetical order and permissions in
 * registry order inside each. Alphabetical rather than registry order across areas because a
 * reader scanning for "may they touch trust" is looking a name up, not reading a subsystem map.
 */
export function permissionsByArea(permissions: readonly string[]): readonly PermissionArea[] {
  const areas = new Map<string, string[]>();
  for (const permission of permissions) {
    const name = permissionAreaName(permission);
    const existing = areas.get(name);
    if (existing === undefined) areas.set(name, [permission]);
    else existing.push(permission);
  }
  return [...areas.entries()]
    .map(([name, keys]) => ({ name, permissions: keys }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}
