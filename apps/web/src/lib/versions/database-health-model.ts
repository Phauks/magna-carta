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
  observedAt: string;
}

/** One rendered row: what it is called, how it reads, and the one line beneath it. */
export interface HealthRow {
  id: "firmDatabase" | "schema" | "membership" | "controlPlane";
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
    return {
      id: "firmDatabase",
      name: "Firm database",
      reading: "fault",
      status: "Not answering",
      detail: "The firm's database did not answer this request.",
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
  return [firmDatabaseRow(value), schemaRow(value), membershipRow(value), controlPlaneRow(value)];
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
export function collapsedHealthBadge(reading: HealthReading): string | null {
  switch (reading) {
    case "healthy":
      return null;
    case "attention":
      return "Needs attention";
    case "fault":
      return "Not working";
  }
}

/**
 * The one line a copy click puts on the clipboard for the whole section: every row's name and
 * status, plus the backlog when there is one, and the observation time. A member pasting this into
 * a bug report hands over the whole diagnosis rather than a screenshot of part of it.
 */
export function copyLineForDatabaseHealth(value: DatabaseHealthValue): string {
  const segments = databaseHealthRows(value).map((row) => `${row.name}: ${row.status}`);
  const backlog = describeProvisioningBacklog(value);
  if (backlog !== null) segments.push(backlog.sentence);
  segments.push(`observed ${value.observedAt}`);
  return segments.join(" · ");
}
