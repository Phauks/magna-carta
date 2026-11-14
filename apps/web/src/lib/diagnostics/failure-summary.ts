/*
 * The one line every failure leads with: which area of the app, which action, and what kind of
 * failure — so the screen itself says enough to identify the problem, and an Error ID is the way to
 * the rest rather than the only thing there is to go on.
 *
 * PURE, AND BUILT ONLY FROM CODE-SHAPED FACTS. The area comes from the first segment of a path, the
 * action from the route TEMPLATE the server matched (never the concrete path, which can carry a
 * matter number), the cause from the exception's kind. Nothing here can carry what a person typed or
 * what a record holds, which is what makes it safe to show, to copy and to paste.
 */
import type { Failure } from "$lib/api/problem.ts";

/**
 * The area a path's first segment belongs to, in the words the navigation uses. Shared by the API's
 * paths (/api/v1/<segment>/…) and the app's own routes (/<segment>/…), which mostly agree; where a
 * segment is absent the segment itself is shown, so a new area still says something true.
 */
const AREA_LABELS: Readonly<Record<string, string>> = {
  "address-lookup": "Address lookup",
  "ai-detection": "AI",
  billing: "Billing",
  calendar: "Calendar",
  "calendar-sync": "Calendar",
  "client-errors": "Diagnostics",
  communications: "Calls and texts",
  "community-board": "Community board",
  conflicts: "Conflicts",
  conversions: "Files and documents",
  costs: "Costs",
  custodian: "Custodian",
  custody: "Custodian",
  "custom-fields": "Custom fields",
  deadlines: "Calendar",
  decryption: "Files and documents",
  directory: "Directory",
  discovery: "Discovery",
  documents: "Files and documents",
  downloads: "Downloads",
  email: "Email",
  emails: "Email",
  "event-links": "Calendar",
  events: "Calendar",
  fees: "Fees",
  "file-integrity": "Files and documents",
  "file-repair": "Files and documents",
  "file-type": "Files and documents",
  "file-workbench": "Files and documents",
  files: "Files and documents",
  firm: "Firm settings",
  "firm-events": "Calendar",
  "firm-usage": "Firm usage",
  folders: "Files and documents",
  forms: "Forms",
  guest: "Meetings",
  home: "Home",
  incidents: "Diagnostics",
  integrations: "Integrations",
  intake: "Intake",
  "intake-procedure-steps": "Intake",
  "intake-procedures": "Intake",
  invitations: "Members",
  "legal-citations": "Legal citations",
  locations: "Custodian",
  magnus: "Magnus",
  "matter-asset-classes": "Matters",
  "matter-asset-types": "Matters",
  "matter-assets": "Matters",
  "matter-plan-steps": "Matters",
  "matter-plans": "Matters",
  matters: "Matters",
  me: "Your account",
  meetings: "Meetings",
  members: "Members",
  "merge-field-mappings": "Documents",
  "merge-fields": "Documents",
  messaging: "Messaging",
  meta: "System status",
  metadata: "Files and documents",
  "my-day": "Home",
  "narrative-templates": "Time",
  "non-billable-categories": "Time",
  "note-documents": "Notes",
  notes: "Notes",
  notifications: "Notifications",
  numbering: "Numbering",
  "numbering-scheme": "Numbering",
  "numbering-schemes": "Numbering",
  ocr: "Files and documents",
  platform: "System status",
  "rate-cards": "Billing",
  "record-custodians": "Discovery",
  registrations: "Sign-up",
  reports: "Reports",
  "resource-bookings": "Calendar",
  "review-sets": "Discovery",
  roles: "Members",
  "safe-browse": "Safe website viewer",
  "safe-website-viewer": "Safe website viewer",
  scan: "Files and documents",
  search: "Search",
  settings: "Settings",
  shipments: "Shipping",
  shipping: "Shipping",
  support: "Support",
  "task-checklist-items": "Tasks",
  "task-comments": "Tasks",
  "task-documents": "Tasks",
  "task-external-links": "Tasks",
  "task-links": "Tasks",
  "task-list-statuses": "Tasks",
  "task-lists": "Tasks",
  "task-teams": "Tasks",
  tasks: "Tasks",
  templates: "Documents",
  time: "Time",
  "time-entries": "Time",
  timer: "Time",
  tools: "Tools",
  trust: "Trust",
  updates: "Updates",
  uploads: "Uploads",
  "utbms-codes": "Billing",
  whois: "WHOIS lookup",
  "whois-lookup": "WHOIS lookup",
};

/** The path's segments with the API prefix, a SvelteKit group and the method removed. */
function segmentsOf(path: string): string[] {
  const withoutMethod = path.replace(/^[A-Z]+\s+/, "");
  const withoutQuery = withoutMethod.split("?")[0] ?? withoutMethod;
  return withoutQuery
    .replace(/^\/?api\/v1\//, "/")
    .split("/")
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
}

function sentenceCase(words: string): string {
  return words.length === 0 ? words : words[0]!.toUpperCase() + words.slice(1);
}

/** The area of the app a path belongs to: "Meetings", "Trust". Null where the path names none. */
export function areaForPath(path: string): string | null {
  const first = segmentsOf(path)[0];
  if (first === undefined || first.startsWith(":") || first.startsWith("[")) return null;
  return AREA_LABELS[first] ?? sentenceCase(first.replace(/-/g, " "));
}

function isParameter(segment: string): boolean {
  // A route template's parameter (":meetingId", "{meetingId}", "[meetingId]"), or a concrete
  // identifier in a path the app built itself ("mat_8QK2", "meeting_…", a number).
  return (
    /^[:{[]/.test(segment) ||
    /^[a-z]+_[A-Za-z0-9]+$/.test(segment) ||
    /^\d+$/.test(segment) ||
    /^[0-9a-f-]{16,}$/i.test(segment)
  );
}

function singular(noun: string): string {
  if (noun.endsWith("ies")) return `${noun.slice(0, -3)}y`;
  if (noun.endsWith("ses") || noun.endsWith("ches") || noun.endsWith("shes")) {
    return noun.slice(0, -2);
  }
  if (noun.endsWith("s") && !noun.endsWith("ss")) return noun.slice(0, -1);
  return noun;
}

const METHOD_VERBS: Readonly<Record<string, string>> = {
  GET: "Read",
  POST: "Create",
  PUT: "Change",
  PATCH: "Change",
  DELETE: "Delete",
};

/**
 * The action a request line or route template names, in plain words: "POST /meetings/:id/join" is
 * "Join meeting", "PATCH /matters/:id" is "Change matter", "GET /costs" is "Read costs". Built from
 * the shape of the path, so it is approximate in wording and exact in what it points at; the request
 * itself is in the details.
 */
export function actionForRequest(requestLine: string): string | null {
  const method = /^([A-Z]+)\s/.exec(requestLine)?.[1];
  const segments = segmentsOf(requestLine);
  if (method === undefined || segments.length === 0) return null;
  const literals = segments.filter((segment) => !isParameter(segment));
  const last = segments[segments.length - 1]!;
  const lastLiteral = literals[literals.length - 1];
  if (lastLiteral === undefined) return null;
  const words = (segment: string) => segment.replace(/-/g, " ");

  // A singular literal that follows a parameter, on a write, is an action taken on that record:
  // POST /meetings/:id/join, POST /matters/:id/close. A plural one is a collection under the record
  // (POST /meetings/:id/polls), which reads as an ordinary create.
  const lastIndex = segments.lastIndexOf(lastLiteral);
  const before = segments[lastIndex - 1];
  const isCollection = singular(lastLiteral) !== lastLiteral;
  if (
    method !== "GET" &&
    !isCollection &&
    last === lastLiteral &&
    before !== undefined &&
    isParameter(before)
  ) {
    const owner = segments[lastIndex - 2];
    const object = owner === undefined || isParameter(owner) ? "" : ` ${words(singular(owner))}`;
    return sentenceCase(`${words(lastLiteral)}${object}`);
  }
  const verb = METHOD_VERBS[method] ?? method;
  const noun = isParameter(last) || method === "POST" ? singular(lastLiteral) : lastLiteral;
  return `${verb} ${words(noun)}`;
}

/** The kind of failure, as one short label. */
export function causeLabel(failure: Failure): string {
  const problem = failure.problem;
  if (failure.request.startsWith("PAGE ")) {
    const kind = failure.cause === undefined ? null : /^([A-Za-z]+)/.exec(failure.cause)?.[1];
    return kind === null || kind === undefined ? "App fault" : `App fault: ${kind}`;
  }
  if (problem === null) return "No answer from the server";
  if (problem.status >= 500) {
    const kind = problem.cause === undefined ? null : /^([A-Za-z]+)/.exec(problem.cause)?.[1];
    return kind === null || kind === undefined
      ? `Server fault (${String(problem.status)})`
      : `Server fault: ${kind}`;
  }
  return problem.title === undefined
    ? `Refused (${String(problem.status)})`
    : `Refused (${String(problem.status)}): ${problem.title}`;
}

/** The path the failure is about: the operation the server matched, or the request as made. */
export function failurePath(failure: Failure): string {
  return failure.problem?.operation ?? failure.request;
}

/** The summary line's parts, in reading order: area, action, kind of failure. */
export function failureSummary(failure: Failure): string[] {
  const path = failurePath(failure);
  const area = areaForPath(path);
  const action = failure.request.startsWith("PAGE ") ? null : actionForRequest(path);
  return [area, action, causeLabel(failure)].filter((part): part is string => part !== null);
}

/**
 * The summary a screen or a band leads with: the line above, then the Error ID itself. The ID stays
 * in sight because it is what a person quotes and what System Status looks up; the facts behind Show
 * details only add to it. A toast leaves it out, where Copy details carries it instead.
 */
export function failureSummaryWithId(failure: Failure): string[] {
  const errorId = failure.problem?.errorId;
  const summary = failureSummary(failure);
  return errorId === undefined || errorId === "" ? summary : [...summary, errorId];
}
