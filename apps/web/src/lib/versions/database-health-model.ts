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
 * four rows below separate the causes that sentence collapses — the connection, the schema, this
 * account's standing, and any provisioning still in flight — so the reader can tell a wait from a
 * fault from something to ask an administrator for.
 *
 * SEVERITY, NOT DECORATION. Each row resolves to one of three readings, and the section heading
 * carries the worst of them so a folded section can still be trusted (the same rule the fleet fold
 * keeps: folding may hide rows, never a fault).
 */
import { countPill, type SectionPill } from "./version-overlay-model.ts";

/** The three readings a row can have, worst last. The heading carries the worst row's. */
export type HealthReading = "healthy" | "attention" | "fault";

export interface DatabaseHealthValue {
  controlPlane: {
    state: "reachable" | "unreachable";
    bucketProvisioned: boolean;
  };
  firmDatabase: {
    state: "reachable" | "unreachable";
    roundTripMilliseconds: number | null;
    /** Why it is not answering, in the database's own words; null while it is. */
    fault: string | null;
  };
  schema: {
    state: "current" | "behind" | "unknown";
    appliedCount: number;
    appliedHead: string | null;
    expectedHead: string;
  };
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
  /**
   * The firm's file storage as this deployment serves it, and the last upload readiness check —
   * read from its audit row, never run here. `lastReadinessCheck` is null when nobody has run it.
   */
  fileStorage: {
    uploadPath: "direct-to-storage" | "through-the-application";
    provisioner: "cloudflare-rest" | "development";
    lastReadinessCheck: { at: string; ready: boolean; failed: string[] } | null;
    state: "read" | "unknown";
  };
  observedAt: string;
}

/** One rendered row: what it is called, how it reads, and the one line beneath it. */
export interface HealthRow {
  id: "firmDatabase" | "schema" | "membership" | "controlPlane" | "fileStorage";
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
  "Your firm's database reports its health once you are signed in.";

/** The header line while the health read is in flight, matching the version read's own. */
export const HEALTH_READ_IN_FLIGHT_NOTICE = "Checking the database";

/**
 * The firm's own database: the round trip that proves the connection, and what it cost. The number
 * is the point of the row — "reachable" with no measurement behind it is a claim, and the reader
 * opened this panel because something was not working.
 */
function firmDatabaseRow(value: DatabaseHealthValue): HealthRow {
  if (value.firmDatabase.state === "unreachable") {
    // The database's own words when it gave any. "Not answering" is the symptom the reader already
    // has; the sentence they need is the one underneath it, and the wire carries it now rather than
    // making them go to the logs for a fact this read already held.
    const fault = value.firmDatabase.fault;
    return {
      id: "firmDatabase",
      name: "Firm database",
      reading: "fault",
      status: "Not answering",
      detail:
        fault === null
          ? "The firm's database did not answer this request, and gave no reason."
          : `The firm's database did not answer this request: ${fault}`,
    };
  }
  const roundTrip = value.firmDatabase.roundTripMilliseconds;
  return {
    id: "firmDatabase",
    name: "Firm database",
    reading: "healthy",
    status: "Connected",
    detail:
      roundTrip === null ? "The firm's database answered." : `Answered in ${String(roundTrip)} ms.`,
  };
}

/**
 * The lineage the firm's database actually ran, against the one this build carries. "Behind" is not
 * a fault: a firm's database migrates itself when it next wakes, so a firm nobody has touched since
 * the deploy is legitimately a version back and will catch up on its own. It is worth saying
 * because it explains a screen whose table does not exist yet.
 */
function schemaRow(value: DatabaseHealthValue): HealthRow {
  switch (value.schema.state) {
    case "current":
      return {
        id: "schema",
        name: "Schema",
        reading: "healthy",
        status: "Up to date",
        detail: `${String(value.schema.appliedCount)} migrations applied.`,
      };
    case "behind":
      return {
        id: "schema",
        name: "Schema",
        reading: "attention",
        status: "Behind",
        detail:
          value.schema.appliedHead === null
            ? "The firm's database has applied no migrations yet."
            : `At ${value.schema.appliedHead}; this build expects ${value.schema.expectedHead}.`,
      };
    case "unknown":
      return {
        id: "schema",
        name: "Schema",
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
 * The control plane, and the one fact about the firm's record worth carrying: whether its storage
 * has been allocated. A firm without it is still being built — the state is honest and temporary,
 * and it explains a file upload that will not start.
 */
function controlPlaneRow(value: DatabaseHealthValue): HealthRow {
  if (value.controlPlane.state === "unreachable") {
    return {
      id: "controlPlane",
      name: "Control plane",
      reading: "fault",
      status: "Not answering",
      detail: "The platform's own database did not answer this request.",
    };
  }
  if (!value.controlPlane.bucketProvisioned) {
    return {
      id: "controlPlane",
      name: "Control plane",
      reading: "attention",
      status: "Still provisioning",
      detail: "The firm's file storage has not finished being allocated.",
    };
  }
  return {
    id: "controlPlane",
    name: "Control plane",
    reading: "healthy",
    status: "Connected",
    detail: "The firm's record and its file storage are in place.",
  };
}

/** Where the readiness check is run, said the same way everywhere it is pointed at. */
const READINESS_CHECK_LOCATION = "this panel (an Owner or Admin sees the check run here)";

/** The check ids in the reader's words — the file-safety screen's own labels, kept in step. */
const READINESS_CHECK_LABELS: Record<string, string> = {
  "bucket-recorded": "storage bucket recorded",
  "bucket-exists": "storage bucket exists",
  "event-notifications": "scanning is told of new files",
  "lifecycle-rules": "temporary artifacts expire",
  "cors-policy": "this site may write to storage",
  "key-can-sign": "the storage credential is honoured",
};

/*
 * The file-storage row: which way an upload travels, and whether anyone has proved it can. The
 * check that proves it acts on the bucket and is run by hand from the file-safety screen, so this
 * row only ever reports the last run — "not yet checked" is a fact about the firm, not a fault,
 * and earns no badge; a run that found something wrong is a fault, named by its first failed
 * precondition, which is the cause (the checks are ordered so that what follows is consequence).
 */
function fileStorageRow(value: DatabaseHealthValue): HealthRow {
  const { fileStorage } = value;
  if (fileStorage.uploadPath === "through-the-application") {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "healthy",
      status: "Through the application",
      detail: "Files go through the application to its bound storage in this deployment.",
    };
  }
  if (fileStorage.state === "unknown") {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "attention",
      status: "Not read",
      detail: "The record of the last upload readiness check could not be read.",
    };
  }
  const last = fileStorage.lastReadinessCheck;
  if (last === null) {
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "healthy",
      status: "Not yet checked",
      detail:
        "Files go from the browser straight to the firm's storage. Nobody has run the upload " +
        `readiness check; an administrator can, under ${READINESS_CHECK_LOCATION}.`,
    };
  }
  if (!last.ready) {
    const first = last.failed[0];
    const cause = first === undefined ? "a precondition" : (READINESS_CHECK_LABELS[first] ?? first);
    return {
      id: "fileStorage",
      name: "File storage",
      reading: "fault",
      status: "Not ready",
      detail:
        `The last upload readiness check found ${cause} not in place. An administrator can run it ` +
        `again under ${READINESS_CHECK_LOCATION}; its report names the fix.`,
    };
  }
  return {
    id: "fileStorage",
    name: "File storage",
    reading: "healthy",
    status: "Ready",
    detail:
      "Files go from the browser straight to the firm's storage; the last upload readiness check found every precondition in place.",
  };
}

/** Roles in one phrase, in the order the API returned them (which is by name). */
function formatRoles(roles: readonly string[]): string {
  return roles.length === 1 ? `Role: ${roles[0] ?? ""}` : `Roles: ${roles.join(", ")}`;
}

/**
 * The section's rows, in the order a reader works through a failure: the connection first, then
 * what is in the database, then where this account stands in it, then the platform behind all
 * three. Every row is always present — a row that disappears when it is healthy would make the
 * section's length a signal, and half of these states are normal.
 */
export function databaseHealthRows(value: DatabaseHealthValue): HealthRow[] {
  return [
    firmDatabaseRow(value),
    schemaRow(value),
    membershipRow(value),
    controlPlaneRow(value),
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
 * how much of it was affected — one row wrong out of four reads very differently from all four, and
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
