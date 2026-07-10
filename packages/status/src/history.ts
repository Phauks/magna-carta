// The 90-day uptime record: pure functions over the cron-owned status:history document. The cron
// appends one sample per component per run (append); the read path turns the tally into per-component
// ticks and an uptime ratio (summarize).
//
// Uptime is SAMPLE-COUNTED, not day-summarized. Each 10-minute run increments the counter for the
// status it actually observed, so a partial-day incident costs a proportional slice of the ratio
// rather than the whole day, and a run that never happened is simply an uncounted sample — never a
// green one. Days with no samples at all render as no-data ticks, because a status page that paints
// unknown days green is worse than one that shows nothing.
import {
  HISTORY_SCHEMA_VERSION,
  HISTORY_WINDOW_DAYS,
  type ComponentHistory,
  type StatusHistory,
} from "./schema.ts";
import { COMPONENT_STATUS, type ComponentStatus, statusRank } from "./vocabulary.ts";

const MS_PER_DAY = 86_400_000;

// The UTC calendar day an instant falls in. UTC everywhere is the genre convention and the only
// timezone this page ever states.
export function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// The window's day keys, oldest first, ending on the day containing `now`. Deriving the keys by
// subtracting whole days from the instant (rather than walking a calendar) keeps month and
// year boundaries correct for free.
function windowDayKeys(now: string, windowDays: number): string[] {
  const end = Date.parse(now);
  const keys: string[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    keys.push(new Date(end - offset * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return keys;
}

function isComponentStatus(value: string): value is ComponentStatus {
  return (COMPONENT_STATUS as readonly string[]).includes(value);
}

// Records one observation per component into today's tally and drops days that have fallen out of
// the window. The cron is the document's only writer and runs every ten minutes, so this
// read-modify-write needs no coordination.
export function appendSample(
  history: StatusHistory,
  statuses: Record<string, ComponentStatus>,
  now: string,
): StatusHistory {
  const today = utcDayKey(now);
  const keep = new Set(windowDayKeys(now, HISTORY_WINDOW_DAYS));
  const days: StatusHistory["days"] = {};
  for (const [day, components] of Object.entries(history.days)) {
    if (keep.has(day)) days[day] = components;
  }

  const todayCounts = { ...days[today] };
  for (const [componentId, status] of Object.entries(statuses)) {
    const counts = { ...todayCounts[componentId] };
    counts[status] = (counts[status] ?? 0) + 1;
    todayCounts[componentId] = counts;
  }
  days[today] = todayCounts;

  return { schemaVersion: HISTORY_SCHEMA_VERSION, updatedAt: now, days };
}

// A day's tick is the worst status observed that day: one 10-minute outage sample colors the day,
// even though the ratio below charges it only its true share.
function worstOfDay(counts: Record<string, number> | undefined): ComponentStatus | null {
  if (counts === undefined) return null;
  let worst: ComponentStatus | null = null;
  for (const [status, count] of Object.entries(counts)) {
    if (count <= 0 || !isComponentStatus(status)) continue;
    if (worst === null || statusRank(status) > statusRank(worst)) worst = status;
  }
  return worst;
}

// Maintenance is excluded from BOTH sides of the ratio: planned work is not an availability failure,
// and charging it as downtime would punish doing it well. The day's tick still shows it happened.
function uptimeRatioFor(
  history: StatusHistory,
  componentId: string,
  dayKeys: readonly string[],
): number | null {
  let operational = 0;
  let countable = 0;
  for (const day of dayKeys) {
    const counts = history.days[day]?.[componentId];
    if (counts === undefined) continue;
    for (const [status, count] of Object.entries(counts)) {
      if (count <= 0 || !isComponentStatus(status) || status === "maintenance") continue;
      countable += count;
      if (status === "operational") operational += count;
    }
  }
  return countable === 0 ? null : operational / countable;
}

// Ticks run oldest-first so the bar reads left-to-right as time.
export function summarizeHistory(
  history: StatusHistory,
  componentIds: readonly string[],
  now: string,
  windowDays: number = HISTORY_WINDOW_DAYS,
): Record<string, ComponentHistory> {
  const dayKeys = windowDayKeys(now, windowDays);
  const summary: Record<string, ComponentHistory> = {};
  for (const componentId of componentIds) {
    summary[componentId] = {
      ticks: dayKeys.map((day) => worstOfDay(history.days[day]?.[componentId])),
      uptimeRatio: uptimeRatioFor(history, componentId, dayKeys),
    };
  }
  return summary;
}

// The dates the ticks correspond to, for the per-tick title attributes on the rendered bar.
export function historyDayKeys(now: string, windowDays: number = HISTORY_WINDOW_DAYS): string[] {
  return windowDayKeys(now, windowDays);
}
