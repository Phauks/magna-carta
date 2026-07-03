import { z } from "zod";
import { COMPONENT_STATUS, EVENT_IMPACT, EVENT_LIFECYCLE, PROVIDER_STATUS } from "./vocabulary.ts";

export const SCHEMA_VERSION = 1 as const;

// The two writers own separate KV keys; the read path merges them, so neither clobbers the other.
export const STATUS_KV_KEYS = {
  derived: "status:derived",
  authored: "status:authored",
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

// --- published (merge output; author identity stripped for the public audience) ---
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
  events: z.array(publishedEventSchema),
  stale: z.boolean(),
});

export type DerivedComponent = z.infer<typeof derivedComponentSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type DerivedSnapshot = z.infer<typeof derivedSnapshotSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type ServiceEvent = z.infer<typeof serviceEventSchema>;
export type ComponentOverride = z.infer<typeof componentOverrideSchema>;
export type AuthoredSnapshot = z.infer<typeof authoredSnapshotSchema>;
export type PublishedSnapshot = z.infer<typeof publishedSnapshotSchema>;

export function emptyDerived(now: string): DerivedSnapshot {
  return { schemaVersion: SCHEMA_VERSION, generatedAt: now, components: [], providers: [] };
}
export function emptyAuthored(now: string): AuthoredSnapshot {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now, events: [], overrides: [] };
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
