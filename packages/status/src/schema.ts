import { z } from "zod";
import { COMPONENT_STATUS, EVENT_IMPACT, EVENT_LIFECYCLE, PROVIDER_STATUS } from "./vocabulary.ts";

export const SCHEMA_VERSION = 1 as const;

// The history document versions independently of the two live snapshots: it is a different shape
// with a different writer and a different lifetime, and coupling it to SCHEMA_VERSION would mean a
// history change fail-parses the live derived/authored documents and blanks the page for a cycle.
export const HISTORY_SCHEMA_VERSION = 1 as const;

// The number of days the uptime record covers, and the number of ticks a bar renders.
export const HISTORY_WINDOW_DAYS = 90;

// The writers own separate KV keys; the read path merges them, so none clobbers another.
// status:derived and status:history are both cron-owned; status:authored is operator-owned.
export const STATUS_KV_KEYS = {
  derived: "status:derived",
  authored: "status:authored",
  history: "status:history",
} as const;

const componentStatusEnum = z.enum(COMPONENT_STATUS);
const providerStatusEnum = z.enum(PROVIDER_STATUS);
const lifecycleEnum = z.enum(EVENT_LIFECYCLE);
const impactEnum = z.enum(EVENT_IMPACT);

// --- derived (cron-owned) ---
export const derivedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  status: componentStatusEnum,
  source: z.enum(["probe", "telemetry"]),
  lastChange: z.string(),
  note: z.string().optional(),
});
export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: providerStatusEnum,
  upstreamUrl: z.string(),
  fetchedAt: z.string(),
  reachable: z.boolean(),
});
export const derivedSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  components: z.array(derivedComponentSchema),
  providers: z.array(providerSchema),
});

// --- authored (operator-owned) ---
export const eventUpdateSchema = z.object({
  at: z.string(),
  lifecycle: lifecycleEnum,
  body: z.string(),
  authorUserId: z.string(),
});
export const serviceEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: impactEnum,
  lifecycle: lifecycleEnum,
  affectedComponentIds: z.array(z.string()),
  authorUserId: z.string(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(eventUpdateSchema),
});
export const componentOverrideSchema = z.object({
  componentId: z.string(),
  status: componentStatusEnum,
  note: z.string(),
  setAt: z.string(),
  authorUserId: z.string(),
});
export const authoredSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: z.string(),
  events: z.array(serviceEventSchema),
  overrides: z.array(componentOverrideSchema),
});

// --- history (cron-owned) ---
// days: { "YYYY-MM-DD": { componentId: { status: sampleCount } } }. The status keys are typed as
// plain strings rather than the status enum so a value written by a future vocabulary (or a corrupt
// one) survives the parse and is filtered at read time instead of voiding the whole document.
const dayCountsSchema = z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()));
export const statusHistorySchema = z.object({
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  updatedAt: z.string(),
  days: z.record(z.string(), dayCountsSchema),
});

// --- published (merge output; author identity stripped for the public audience) ---

// Upstream providers never set this platform's verdict; when one reports trouble the merge raises
// this advisory instead, so the page can say whose status it is reporting. A provider whose own feed
// is unreachable (status_unavailable) is honest uncertainty about THEM and raises nothing.
export const upstreamAdvisorySchema = z.object({
  providers: z.array(providerSchema),
  worst: providerStatusEnum,
});

// A tick is null on a day with no samples — no data, never a green day. uptimeRatio is null when
// nothing countable was recorded, so the page reads "No data" rather than a fabricated 100%.
export const componentHistorySchema = z.object({
  ticks: z.array(componentStatusEnum.nullable()),
  uptimeRatio: z.number().nullable(),
});
export const publishedHistorySchema = z.object({
  windowDays: z.number().int().positive(),
  components: z.record(z.string(), componentHistorySchema),
});

export const publishedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  status: componentStatusEnum,
  note: z.string().optional(),
});
export const publishedEventUpdateSchema = z.object({
  at: z.string(),
  lifecycle: lifecycleEnum,
  body: z.string(),
  authorUserId: z.string().optional(),
});
export const publishedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: impactEnum,
  lifecycle: lifecycleEnum,
  affectedComponentIds: z.array(z.string()),
  authorUserId: z.string().optional(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(publishedEventUpdateSchema),
});
export const publishedSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  overall: componentStatusEnum,
  components: z.array(publishedComponentSchema),
  providers: z.array(providerSchema),
  upstreamAdvisory: upstreamAdvisorySchema.nullable(),
  events: z.array(publishedEventSchema),
  history: publishedHistorySchema,
  stale: z.boolean(),
});

export type DerivedComponent = z.infer<typeof derivedComponentSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type DerivedSnapshot = z.infer<typeof derivedSnapshotSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type ServiceEvent = z.infer<typeof serviceEventSchema>;
export type ComponentOverride = z.infer<typeof componentOverrideSchema>;
export type AuthoredSnapshot = z.infer<typeof authoredSnapshotSchema>;
export type StatusHistory = z.infer<typeof statusHistorySchema>;
export type UpstreamAdvisory = z.infer<typeof upstreamAdvisorySchema>;
export type ComponentHistory = z.infer<typeof componentHistorySchema>;
export type PublishedHistory = z.infer<typeof publishedHistorySchema>;
export type PublishedSnapshot = z.infer<typeof publishedSnapshotSchema>;

export function emptyDerived(now: string): DerivedSnapshot {
  return { schemaVersion: SCHEMA_VERSION, generatedAt: now, components: [], providers: [] };
}
export function emptyAuthored(now: string): AuthoredSnapshot {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, events: [], overrides: [] };
}
export function emptyHistory(now: string): StatusHistory {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, updatedAt: now, days: {} };
}

// A corrupt or absent KV value must degrade to an empty doc, never a thrown 500 on the read path.
export function parseDerived(text: string | null, now: string): DerivedSnapshot {
  if (text === null) return emptyDerived(now);
  try {
    const parsed = derivedSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyDerived(now);
  } catch {
    return emptyDerived(now);
  }
}
export function parseAuthored(text: string | null, now: string): AuthoredSnapshot {
  if (text === null) return emptyAuthored(now);
  try {
    const parsed = authoredSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyAuthored(now);
  } catch {
    return emptyAuthored(now);
  }
}
export function parseHistory(text: string | null, now: string): StatusHistory {
  if (text === null) return emptyHistory(now);
  try {
    const parsed = statusHistorySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : emptyHistory(now);
  } catch {
    return emptyHistory(now);
  }
}
