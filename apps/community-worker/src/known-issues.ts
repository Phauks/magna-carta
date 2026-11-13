import { mergeSnapshot } from "@magna-carta/status/merge";
import { parseAuthored, parseDerived, parseHistory } from "@magna-carta/status/schema";
import { STATUS_KV_KEYS } from "@magna-carta/status";

// The board's Known Issues are the public status page's unresolved events, read from the same
// store and filtered by the same public merge, so the board can never say more than the status
// page does, or disagree with it. Only the authored events are read; the board shows no component
// grid and no uptime.

export interface KnownIssue {
  readonly id: string;
  readonly title: string;
  readonly impact: "minor" | "major" | "critical" | "maintenance";
  readonly lifecycle: "investigating" | "identified" | "monitoring" | "resolved";
  readonly startedAt: string;
  readonly latestUpdate: { readonly at: string; readonly body: string } | null;
}

export const STATUS_PAGE_URL = "https://status.magnacarta.esq";

export async function readKnownIssues(store: KVNamespace, now: string): Promise<KnownIssue[]> {
  const authored = await store.get(STATUS_KV_KEYS.authored);
  const snapshot = mergeSnapshot(
    parseDerived(null, now),
    parseAuthored(authored, now),
    parseHistory(null, now),
    {
      audience: "public",
      now,
      stalenessThresholdMs: Number.POSITIVE_INFINITY,
    },
  );
  return snapshot.events
    .filter((event) => event.resolvedAt === null && event.lifecycle !== "resolved")
    .map((event) => {
      const latest = event.updates.toSorted((left, right) => right.at.localeCompare(left.at))[0];
      return {
        id: event.id,
        title: event.title,
        impact: event.impact,
        lifecycle: event.lifecycle,
        startedAt: event.startedAt,
        latestUpdate: latest === undefined ? null : { at: latest.at, body: latest.body },
      };
    })
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}
