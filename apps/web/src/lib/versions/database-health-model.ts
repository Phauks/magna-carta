/*
 * The Database section of the header panel: the wire shape of GET /api/v1/meta/database-health
 * (hand-written, mirroring apps/api-worker/openapi/openapi.json, like every surface's shapes — see
 * $lib/api/request.ts), and the reading the panel renders from it.
 *
 * The API carries states and numbers; every word a person sees is decided here, beside the panel
 * that shows it, on the same split the version overlay keeps. Kept free of Svelte so the node-pool
 * tests exercise each rule directly.
 *
 * WHAT THIS SECTION IS FOR. A member whose screens are answering "Your role does not grant this
 * action in this firm" is looking at a sentence about permissions that is true and useless: on a
 * newly created firm the cause is usually that their member record has not finished being written
 * into the firm's own database yet, which is a wait, not a permission somebody has to grant. The
 * rows below separate the causes that sentence collapses — the connections, the schemas, this
 * account's standing, and any provisioning still in flight — so the reader can tell a wait from a
 * fault from something to ask an administrator for.
 *
 * TWO DATABASES, READ AS TWO GROUPS OF THREE. Every request in this application uses both: the
 * control plane answers first, with the account, the session and the firm's own record, and the
 * firm's own database answers everything after that. So each gets the same pair of rows — is it
 * answering, and how fast; is its schema the one this build expects — followed by the one row that
 * belongs to it alone: this account's standing in the firm's database, and the firm's file storage
 * in the control plane. Naming both is what lets a reader say WHICH database is slow, rather than
 * reading a healthy firm row while the leg in front of it is the one failing them.
 *
 * SEVERITY, NOT DECORATION. Each row resolves to one of three readings, and the section heading
 * carries the worst of them so a folded section can still be trusted (the same rule the fleet fold
 * keeps: folding may hide rows, never a fault).
 */
import { countPill, type SectionPill } from "./version-overlay-model.ts";

/** The three readings a row can have, worst last. The heading carries the worst row's. */
export type HealthReading = "healthy" | "attention" | "fault";

/** What a database owes beyond "it answered": what the round trip cost, and why when it did not. */
export interface DatabaseConnectionValue {
  state: "reachable" | "unreachable";
  roundTripMilliseconds: number | null;
  /** Why it is not answering, in the database's own words; null while it is. */
  fault: string | null;
}

/** A database's applied lineage against the one this build carries. Both databases answer it. */
export interface DatabaseSchemaValue {
  state: "current" | "behind" | "unknown";
  appliedCount: number;
  appliedHead: string | null;
  expectedHead: string;
}

export interface DatabaseHealthValue {
  controlPlane: DatabaseConnectionValue & {
    bucketProvisioned: boolean;
  };
  controlPlaneSchema: DatabaseSchemaValue;
  firmDatabase: DatabaseConnectionValue;
  firmSchema: DatabaseSchemaValue;
  membership: {
    state: "active" | "missing" | "inactive" | "unknown";
    roles: string[];
    permissionCount: number;
  };
  provisioning: {
    state: "read" | "unknown";
    pending: number;
    deadLettered: number;
  };
  observedAt: string;
}

/** One rendered row: what it is called, how it reads, and the one line beneath it. */
export interface HealthRow {
  id:
    | "firmDatabase"
    | "firmSchema"
    | "membership"
    | "controlPlane"
    | "controlPlaneSchema"
    | "fileStorage";
  name: string;
  reading: HealthReading;
  /** The row's own two or three words — its state, said plainly. */
  status: string;
  /** The sentence under the name: what the state means, or what to do about it. Never empty. */
  detail: string;
}

/** The heading over the section, which is also its fold toggle's visible label. */
export const DATABASE_SECTION_LABEL = "Database";

/** The heading over the deployment section, now that it folds on the same terms. */
export const DEPLOYMENT_SECTION_LABEL = "Deployment";

/** The line a signed-out panel shows where the section would be. Same boundary, said the same way. */
export const SIGNED_OUT_DATABASE_NOTICE =
  "Magna Carta's database and your firm's own report their health once you are signed in.";

/** The header line while the health read is in flight, matching the version read's own. */
export const HEALTH_READ_IN_FLIGHT_NOTICE = "Checking the databases";

/**
 * A database's connection row: the round trip that proves it, and what it cost. The number is the
 * point of the row — "reachable" with no measurement behind it is a claim, and the reader opened
 * this panel because something was not working.
 *
 * ONE BUILDER FOR BOTH DATABASES, so the two rows a reader is comparing cannot drift apart in what
 * they measure or in how they say it. `subject` is how the sentences name the database; everything
 * else is identical, because the question being asked of each is identical.
 */
function connectionRow(input: {
  id: HealthRow["id"];
  name: string;
  subject: string;
  value: DatabaseConnectionValue;
}): HealthRow {
  const { id, name, subject, value } = input;
  if (value.state === "unreachable") {
    // The database's own words when it gave any. "Not answering" is the symptom the reader already
    // has; the sentence they need is the one underneath it, and the wire carries it now rather than
    // making them go to the logs for a fact this read already held.
    return {
      id,
      name,
      reading: "fault",
      status: "Not answering",
      detail:
        value.fault === null
          ? `${subject} did not answer this request, and gave no reason.`
          : `${subject} did not answer this request: ${value.fault}`,
    };
  }
  const roundTrip = value.roundTripMilliseconds;
  return {
    id,
    name,
    reading: "healthy",
    status: "Connected",
    detail: roundTrip === null ? `${subject} answered.` : `Answered in ${String(roundTrip)} ms.`,
  };
}

/**
 * The lineage a database actually ran, against the one this build carries. "Behind" is not a fault
 * on either database: a firm's database migrates itself when it next wakes, and the control plane's
 * lineage is applied by the platform's own scheduled applier, so a database a deploy has not
 * reached yet is legitimately a version back and catches up on its own. It is worth saying because
 * it explains a screen whose table does not exist yet.
 */
function schemaRow(input: {
  id: HealthRow["id"];
  name: string;
  subject: string;
  value: DatabaseSchemaValue;
}): HealthRow {
  const { id, name, subject, value } = input;
  switch (value.state) {
    case "current":
      return {
        id,
        name,
        reading: "healthy",
        status: "Up to date",
        detail: `${String(value.appliedCount)} migrations applied.`,
      };
    case "behind":
      return {
        id,
        name,
        reading: "attention",
        status: "Behind",
        detail:
          value.appliedHead === null
            ? `${subject} has applied no migrations yet.`
            : `At ${value.appliedHead}; this build expects ${value.expectedHead}.`,
      };
    case "unknown":
      return {
        id,
        name,
        reading: "attention",
        status: "Not read",
        detail: "The applied migrations could not be read.",
      };
  }
}

/**
 * This account's standing in this firm — the row that answers the 403s.
 *
 * The three failing states are three different jobs. No member record is a wait or a stuck queue,
 * and the provisioning row beside it says which. A member record with no role is an administrator's
 * grant. Roles that resolve to no permission at all is a firm whose role definitions never seeded,
 * which is neither of those and needs saying separately, because a reader told to "ask an
 * administrator" would be sent to somebody who cannot fix it either.
 */
function membershipRow(value: DatabaseHealthValue): HealthRow {
  const { membership } = value;
  switch (membership.state) {
    case "missing":
      return {
        id: "membership",
        name: "Your membership",
        reading: "fault",
        status: "Not in the database yet",
        detail:
          "Your account belongs to this firm, but its record has not reached the firm's database. " +
          "Until it does, screens that check a permission will refuse.",
      };
    case "inactive":
      return {
        id: "membership",
        name: "Your membership",
        reading: "fault",
        status: "Not active",
        detail: "Your member record in this firm is not active.",
      };
    case "unknown":
      return {
        id: "membership",
        name: "Your membership",
        reading: "attention",
        status: "Not read",
        detail: "Your member record could not be read.",
      };
    case "active":
      break;
  }
  if (membership.roles.length === 0) {
    return {
      id: "membership",
      name: "Your membership",
      reading: "fault",
      status: "No role",
      detail:
        "You are a member of this firm but hold no role, so nothing is permitted. An " +
        "administrator can assign one.",
    };
  }
  if (membership.permissionCount === 0) {
    return {
      id: "membership",
      name: "Your membership",
      reading: "fault",
      status: "No permissions",
      detail: `${formatRoles(membership.roles)} — held, but granting nothing in this firm.`,
    };
  }
  return {
    id: "membership",
    name: "Your membership",
    reading: "healthy",
    status: "Active",
    detail: `${formatRoles(membership.roles)} · ${String(membership.permissionCount)} permissions.`,
  };
}

/**
 * The firm's object storage, which is the one fact about its control-plane record worth a row of
 * its own. Storage that has not been allocated is a firm still being built — the state is honest
 * and temporary, and it explains a file upload that will not start.
 *
 * It answers even when the control plane's probe did not, because the fact comes from the firm
 * record the request was already resolved through rather than from a read of its own. Blanking a
 * row we can still answer would cost a reader the one line that explains their upload.
 */
function fileStorageRow(value: DatabaseHealthValue): HealthRow {
  if (!value.controlPlane.bucketProvisioned) {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "attention",
      status: "Still provisioning",
      detail: "The firm's file storage has not finished being allocated.",
    };
  }
  return {
    id: "fileStorage",
    name: "File storage",
    reading: "healthy",
    status: "Allocated",
    detail: "The firm's own storage bucket is in place.",
  };
}

/** Roles in one phrase, in the order the API returned them (which is by name). */
function formatRoles(roles: readonly string[]): string {
  return roles.length === 1 ? `Role: ${roles[0] ?? ""}` : `Roles: ${roles.join(", ")}`;
}

/**
 * The section's rows: two groups of three, one per database, each in the order a reader works
 * through a failure — the connection first, then what is in the database, then the one thing that
 * database alone can say about this session.
 *
 * The FIRM'S comes first because it is the one a member's screens are usually about, and Magna
 * Carta's follows because it is the leg underneath: a reader who finds the firm's group healthy has
 * somewhere to look next rather than a section that has run out of answers. Every row is always
 * present — a row that disappears when it is healthy would make the section's length a signal, and
 * half of these states are normal.
 */
export function databaseHealthRows(value: DatabaseHealthValue): HealthRow[] {
  return [
    connectionRow({
      id: "firmDatabase",
      name: "Firm database",
      subject: "The firm's database",
      value: value.firmDatabase,
    }),
    schemaRow({
      id: "firmSchema",
      name: "Firm schema",
      subject: "The firm's database",
      value: value.firmSchema,
    }),
    membershipRow(value),
    connectionRow({
      id: "controlPlane",
      name: "Magna Carta database",
      subject: "Magna Carta's own database",
      value: value.controlPlane,
    }),
    schemaRow({
      id: "controlPlaneSchema",
      name: "Magna Carta schema",
      subject: "Magna Carta's own database",
      value: value.controlPlaneSchema,
    }),
    fileStorageRow(value),
  ];
}

/**
 * What the provisioning backlog adds, said only when it has something to add. It is not a row: it
 * is the explanation for the membership row above it, and repeating "0 pending" on every healthy
 * firm would be an info line with nothing behind it.
 *
 * A dead-lettered mirror is the one state here that will not clear on its own, so it is said even
 * when a mirror is also still pending — the pending one may be a retry of nothing.
 */
export function describeProvisioningBacklog(value: DatabaseHealthValue): {
  reading: HealthReading;
  sentence: string;
} | null {
  const { provisioning } = value;
  if (provisioning.state === "unknown") return null;
  if (provisioning.deadLettered > 0) {
    return {
      reading: "fault",
      sentence:
        provisioning.deadLettered === 1
          ? "A member record for this firm failed to be written and will not retry on its own."
          : `${String(provisioning.deadLettered)} member records for this firm failed to be written and will not retry on their own.`,
    };
  }
  if (provisioning.pending > 0) {
    return {
      reading: "attention",
      sentence:
        provisioning.pending === 1
          ? "A member record for this firm is still being written. It usually lands within a few minutes."
          : `${String(provisioning.pending)} member records for this firm are still being written. They usually land within a few minutes.`,
    };
  }
  return null;
}

/** The worst reading among the values given — how a heading speaks for what it can hide. */
export function worstReading(readings: readonly HealthReading[]): HealthReading {
  if (readings.includes("fault")) return "fault";
  if (readings.includes("attention")) return "attention";
  return "healthy";
}

/**
 * The whole section's reading: every row, plus the backlog line when there is one. This is what the
 * collapsed heading wears, so a folded Database section still shows a fault at a glance.
 */
export function overallHealthReading(value: DatabaseHealthValue): HealthReading {
  const backlog = describeProvisioningBacklog(value);
  return worstReading([
    ...databaseHealthRows(value).map((row) => row.reading),
    ...(backlog === null ? [] : [backlog.reading]),
  ]);
}

/**
 * Database shut: how many checks it hides, and how many of them are not right.
 *
 * "Needs attention" and "Not working" named a MOOD and left the reader to open the section to learn
 * how much of it was affected — one row wrong out of six reads very differently from all six, and
 * the heading said the same thing either way. A count says which it is, and the section reports its
 * own health when everything passes rather than going silent.
 */
export function databaseSectionPills(value: DatabaseHealthValue): SectionPill[] {
  const rows = databaseHealthRows(value);
  const pills: SectionPill[] = [countPill(rows.length, "check")];
  const faulted = rows.filter((row) => row.reading === "fault").length;
  const attention = rows.filter((row) => row.reading === "attention").length;
  if (faulted > 0) {
    pills.push({ label: `${String(faulted)} not working`, variant: "danger" });
  }
  if (attention > 0) {
    pills.push({ label: `${String(attention)} needs attention`, variant: "warning" });
  }
  return pills;
}

/** The badge colour for a reading. Healthy earns no badge at all — see healthBadgeLabel. */
export function healthBadgeVariant(reading: HealthReading): "success" | "warning" | "danger" {
  switch (reading) {
    case "healthy":
      return "success";
    case "attention":
      return "warning";
    case "fault":
      return "danger";
  }
}

/**
 * The two words a collapsed Database heading carries, or null when there is nothing to raise. A
 * healthy section says nothing beside its heading: a badge on every panel is a badge nobody reads,
 * and the rows are one caret away.
 */

/**
 * The one line a copy click puts on the clipboard for the whole section: every row's name and
 * status, plus the backlog when there is one, and the observation time. A member pasting this into
 * a bug report hands over the whole diagnosis rather than a screenshot of part of it.
 */
export function copyLineForDatabaseHealth(value: DatabaseHealthValue): string {
  // A FAULTED row pastes its detail too, not just its status. "Firm database: Not answering" is the
  // symptom the reader already had; the sentence under it is the diagnosis, and a copy that carried
  // only the status handed over a report with the one useful fact stripped out of it. Healthy rows
  // keep to their status — their detail is a round-trip time and a reassurance, which is noise in a
  // bug report.
  const segments = databaseHealthRows(value).map((row) =>
    row.reading === "fault"
      ? `${row.name}: ${row.status} — ${row.detail}`
      : `${row.name}: ${row.status}`,
  );
  const backlog = describeProvisioningBacklog(value);
  if (backlog !== null) segments.push(backlog.sentence);
  segments.push(`observed ${value.observedAt}`);
  return segments.join("\n");
}
