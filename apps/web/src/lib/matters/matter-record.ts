/*
 * The matter view model the matter chrome and its section pages read — and the two places a matter
 * can come from.
 *
 * A matter reaches this screen one of two ways. A LIVE matter is the firm's own record, read from
 * the API by its identifier; a SAMPLE matter is one of the in-repo fixtures, which exist so the
 * chrome's four lifecycle states (intake, consultation, open, closed) stay reviewable at a stable URL with
 * no firm data behind them. Both render the same chrome, and `source` says which is which — a
 * screen that shows firm data and a screen that shows invented data must never look identical, so
 * every surface that reads this record can mark the difference rather than guess.
 *
 * The live read fills what the matter record actually holds and leaves the rest absent. The names
 * of a matter's type, location, and responsible attorney are joins this endpoint does not carry,
 * and the per-section collections (files, time, costs) belong to their own surfaces — the Documents
 * page reads its rows from the file API, not from here. Absent is therefore the honest value, and
 * the sections that still render fixture collections say so on a live matter instead of showing an
 * empty table that reads as "nothing here".
 */
import {
  findMatterFixture,
  type CostFixtureRow,
  type FileFixtureRow,
  type MatterFixture,
  type TimeEntryFixtureRow,
} from "./fixtures.ts";

/** Where the matter on screen came from — the firm's record, or an in-repo sample. */
export type MatterRecordSource = "live" | "sample";

export interface MatterRecord {
  id: string;
  title: string;
  description: string | null;
  status: "intake" | "consultation" | "open" | "hold" | "closed";
  /** Null until open draws it; frozen thereafter. A consultation has none until it is opened. */
  matterNumber: string | null;
  /** The consultation's own tentative number, kept after opening rather than replaced by it. */
  consultationNumber: string | null;
  matterTypeName: string | null;
  locationName: string | null;
  /** Null on a live matter: the name is a directory join the matter read does not carry. */
  responsibleAttorneyName: string | null;
  clientDisplayName: string | null;
  clientCode: string | null;
  /** The directory entity linked as the client; null where the matter carries only a display name. */
  clientEntityId: string | null;
  /** Null on a live matter until the billing surface supplies it. */
  eBilling: boolean | null;
  openedAt: string | null;
  /** Set while the matter is on hold: when the pause began, and the firm's reason for it. */
  heldAt: string | null;
  holdReason: string | null;
  closedAt: string | null;
  createdAt: string | null;
  /**
   * The fixture collections. Empty on a live matter — each section reads its own rows from its own
   * endpoint, so a section that still renders these is showing sample data and must say so.
   */
  files: readonly FileFixtureRow[];
  timeEntries: readonly TimeEntryFixtureRow[];
  costs: readonly CostFixtureRow[];
  source: MatterRecordSource;
}

/** The subset of the matter read this screen uses. Widen it as the chrome learns to show more. */
interface MatterReadPayload {
  id: string;
  title: string;
  description: string | null;
  status: "intake" | "consultation" | "open" | "hold" | "closed";
  matterNumber: string | null;
  consultationNumber?: string | null;
  clientDisplayName: string | null;
  clientCode: string | null;
  clientEntityId?: string | null;
  // Optional on the wire, not in the contract. The contract requires all seven; a Worker deployed
  // before they landed answers without them, and this app is served from the same origin as one
  // specific Worker but is cached independently of it. Reading them as optional and defaulting to
  // null is what keeps a version skew rendering an honest gap instead of the string "undefined".
  eBilling?: boolean;
  openedAt?: string | null;
  heldAt?: string | null;
  holdReason?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  matterTypeName?: string | null;
  locationName?: string | null;
  responsibleMemberName?: string | null;
}

export function matterRecordFromFixture(fixture: MatterFixture): MatterRecord {
  return { ...fixture, eBilling: fixture.eBilling, source: "sample" };
}

export function matterRecordFromRead(payload: MatterReadPayload): MatterRecord {
  return {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    status: payload.status,
    matterNumber: payload.matterNumber,
    consultationNumber: payload.consultationNumber ?? null,
    matterTypeName: payload.matterTypeName ?? null,
    locationName: payload.locationName ?? null,
    responsibleAttorneyName: payload.responsibleMemberName ?? null,
    clientDisplayName: payload.clientDisplayName,
    clientCode: payload.clientCode,
    clientEntityId: payload.clientEntityId ?? null,
    eBilling: payload.eBilling ?? null,
    openedAt: payload.openedAt ?? null,
    heldAt: payload.heldAt ?? null,
    holdReason: payload.holdReason ?? null,
    closedAt: payload.closedAt ?? null,
    createdAt: payload.createdAt ?? null,
    // The three collections are NOT part of the matter read and never were. Each has its own list
    // endpoint on its own screen, so filling them here would mean three calls the Overview does not
    // need and a record that goes stale the moment one of those screens writes. They stay empty
    // until each section reads its own, the way Files and Parties already do.
    files: [],
    timeEntries: [],
    costs: [],
    source: "live",
  };
}

/**
 * Whether a payload from the matter read is shaped the way this screen needs. The endpoint is
 * contract-checked server-side, so this is not validation — it is the guard that keeps a surprising
 * body (a proxy's error page, a contract that moved) from rendering as a matter with blank fields.
 */
export function isMatterReadPayload(body: unknown): body is MatterReadPayload {
  if (body === null || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    (candidate.status === "intake" ||
      candidate.status === "consultation" ||
      candidate.status === "open" ||
      candidate.status === "hold" ||
      candidate.status === "closed")
  );
}

/**
 * Resolve the matter behind a `/matters/[id]` URL: the firm's record when the identifier names one,
 * otherwise the sample of that identifier, otherwise nothing.
 *
 * The live read is tried FIRST, and a fixture identifier is never sent to the API — the fixture ids
 * are not identifiers the platform can mint, so asking about one would spend a round trip to be told
 * what is already known. Any non-200 (no session, no such matter, or no Worker at all under a
 * frontend-only dev server) falls through to the fixtures, which is what keeps the three review URLs
 * reachable without a backend.
 */
export async function resolveMatterRecord(
  fetchImpl: typeof fetch,
  id: string,
): Promise<MatterRecord | undefined> {
  const fixture = findMatterFixture(id);
  if (fixture !== undefined) return matterRecordFromFixture(fixture);

  let response: Response;
  try {
    response = await fetchImpl(`/api/v1/matters/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  return isMatterReadPayload(body) ? matterRecordFromRead(body) : undefined;
}
