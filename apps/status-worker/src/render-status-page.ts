// Pure renderer: PublishedSnapshot -> complete HTML document, no runtime dependencies.
//
// The page must be readable with zero JavaScript — a status page is consulted precisely when
// other things are broken, so nothing may stand between the reader and the verdict: no script,
// no external asset, no client-side rendering. A meta refresh keeps it current without script.
// Every snapshot-sourced string is operator- or upstream-authored and is HTML-escaped here.
import type {
  ComponentStatus,
  EventImpact,
  PublishedSnapshot,
  Provider,
  ProviderStatus,
} from "@magna-carta/status";
import { PAGE_CSS } from "./page-styles.ts";

// The published schema exports the snapshot type; its member shapes are addressed from it so
// this renderer stays aligned with the schema without widening that package's export surface.
type PublishedComponent = PublishedSnapshot["components"][number];
type PublishedEvent = PublishedSnapshot["events"][number];

export interface RenderStatusPageOptions {
  // The render moment, used only for the "minutes ago" staleness copy; the verdict itself
  // comes entirely from the snapshot.
  now?: string;
}

// ---------------------------------------------------------------------------
// escaping

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] as string);
}

// ---------------------------------------------------------------------------
// vocabulary -> presentation

type Hue = "ok" | "warn" | "danger" | "gilt" | "neutral";

const STATUS_PRESENTATION: Record<ProviderStatus, { label: string; hue: Hue }> = {
  operational: { label: "Operational", hue: "ok" },
  maintenance: { label: "Maintenance", hue: "gilt" },
  degraded: { label: "Degraded", hue: "warn" },
  partial_outage: { label: "Partial outage", hue: "danger" },
  major_outage: { label: "Major outage", hue: "danger" },
  // An unreachable provider feed is honest uncertainty about THEM — it must never wear an
  // outage color, or a Cloudflare feed hiccup would read as our incident.
  status_unavailable: { label: "Status unavailable", hue: "neutral" },
};

const VERDICT: Record<ComponentStatus, { headline: string; hue: Hue }> = {
  operational: { headline: "All systems operational", hue: "ok" },
  maintenance: { headline: "Scheduled maintenance in progress", hue: "gilt" },
  degraded: { headline: "Degraded performance on some services", hue: "warn" },
  partial_outage: { headline: "Partial outage in effect", hue: "danger" },
  major_outage: { headline: "Major outage in effect", hue: "danger" },
};

const IMPACT_PRESENTATION: Record<EventImpact, { label: string; hue: Hue }> = {
  minor: { label: "Minor impact", hue: "warn" },
  major: { label: "Major impact", hue: "danger" },
  critical: { label: "Critical impact", hue: "danger" },
  maintenance: { label: "Maintenance", hue: "gilt" },
};

const LIFECYCLE_LABELS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

// Display headings for the registry's group names; unknown groups fall back to their own name
// so a future registry group renders without a code change here.
const GROUP_HEADINGS: Record<string, string> = {
  Core: "Core services",
  Engines: "Document & analysis engines",
};

// ---------------------------------------------------------------------------
// UTC formatting (the genre convention: one timezone, stated, everywhere)

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function padTwo(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatUtcDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  return `${padTwo(date.getUTCHours())}:${padTwo(date.getUTCMinutes())}`;
}

function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  return `${formatUtcDate(iso)}, ${formatUtcTime(iso)} UTC`;
}

function minutesBetween(earlierIso: string, laterIso: string): number | null {
  const earlier = new Date(earlierIso).getTime();
  const later = new Date(laterIso).getTime();
  if (Number.isNaN(earlier) || Number.isNaN(later) || later < earlier) return null;
  return Math.round((later - earlier) / 60_000);
}

// ---------------------------------------------------------------------------
// fragments

function renderTopBar(): string {
  return `<header class="topbar"><div class="col">
<span class="mark" aria-hidden="true">M</span>
<span class="word">MAGNA CARTA</span>
<span class="caps surface">Status</span>
<span class="right"><a href="/api/status.json">status.json</a></span>
</div></header>`;
}

function renderVerdictBand(snapshot: PublishedSnapshot): string {
  const verdict = VERDICT[snapshot.overall];
  return `<section class="band ${verdict.hue}">
<span class="lamp" aria-hidden="true"></span>
<h1>${escapeHtml(verdict.headline)}</h1>
<div class="sub num"><div class="big">Checked ${formatUtcDateTime(snapshot.generatedAt)}</div>
<div>Reviewed every 10 minutes &middot; this page refreshes every minute</div></div>
</section>`;
}

function renderStaleStrip(snapshot: PublishedSnapshot, now: string | undefined): string {
  if (!snapshot.stale) return "";
  const minutes = now === undefined ? null : minutesBetween(snapshot.generatedAt, now);
  const age =
    minutes === null ? `at ${formatUtcDateTime(snapshot.generatedAt)}` : `${minutes} minutes ago`;
  return `<div class="stale-strip num"><b>Note:</b> the last automatic review was ${age} &mdash; this snapshot may be stale.</div>`;
}

function componentNames(snapshot: PublishedSnapshot, componentIds: readonly string[]): string {
  // affectedComponentIds are unvalidated at the write edge; an unknown id falls back to the raw
  // (escaped) id rather than vanishing, so an operator typo stays visible instead of hiding scope.
  const byId = new Map(snapshot.components.map((component) => [component.id, component.name]));
  return componentIds.map((id) => escapeHtml(byId.get(id) ?? id)).join(", ");
}

function renderEventUpdates(event: PublishedEvent): string {
  // Newest first regardless of stored order — during an incident the latest word is the headline.
  const updates = [...event.updates].sort((a, b) => b.at.localeCompare(a.at));
  return updates
    .map(
      (update) => `<div class="update">
<span class="t num">${formatUtcDate(update.at) === formatUtcDate(event.startedAt) ? formatUtcTime(update.at) : `${formatUtcDate(update.at)}, ${formatUtcTime(update.at)}`}</span>
<span class="phase caps">${escapeHtml(LIFECYCLE_LABELS[update.lifecycle] ?? update.lifecycle)}</span>
<span>${escapeHtml(update.body)}</span>
</div>`,
    )
    .join("\n");
}

function renderActiveEvent(snapshot: PublishedSnapshot, event: PublishedEvent): string {
  const impact = IMPACT_PRESENTATION[event.impact];
  const affected =
    event.affectedComponentIds.length > 0
      ? ` &middot; ${componentNames(snapshot, event.affectedComponentIds)}`
      : "";
  return `<article class="live ${impact.hue}">
<h2>${escapeHtml(event.title)}</h2>
<div class="meta">
<span class="chip ${impact.hue}">${escapeHtml(LIFECYCLE_LABELS[event.lifecycle] ?? event.lifecycle)}</span>
<span class="chip">${escapeHtml(impact.label)}</span>
<span class="affected num">Started ${formatUtcDateTime(event.startedAt)}${affected}</span>
</div>
${renderEventUpdates(event)}
</article>`;
}

function renderComponentRow(component: PublishedComponent): string {
  const presentation = STATUS_PRESENTATION[component.status];
  const note =
    component.note === undefined || component.note === ""
      ? ""
      : `\n<div class="note">${escapeHtml(component.note)}</div>`;
  // Uptime-bar seam: a 90-day per-component history bar renders here once a history store
  // exists (the cron appending a per-day worst-status record to STATUS_KV). The snapshot
  // carries no history today, and fabricating ticks would be exactly the false greenness this
  // page exists to avoid — so the slot stays empty until the data is real.
  return `<div class="row ${presentation.hue}-row">
<div class="line"><span class="dot" aria-hidden="true"></span><span class="name">${escapeHtml(component.name)}</span><span class="st">${escapeHtml(presentation.label)}</span></div>${note}
</div>`;
}

function renderComponentGroups(snapshot: PublishedSnapshot): string {
  if (snapshot.components.length === 0) {
    return `<div class="group-head"><span class="caps">Services</span></div>
<p class="empty-note">No component data has been published yet.</p>`;
  }
  // Preserve the snapshot's group order (registry order: core first, engines after).
  const groupOrder: string[] = [];
  const grouped = new Map<string, PublishedComponent[]>();
  for (const component of snapshot.components) {
    if (!grouped.has(component.group)) {
      grouped.set(component.group, []);
      groupOrder.push(component.group);
    }
    grouped.get(component.group)?.push(component);
  }
  const legend = `<span class="legend">
<span><span class="dot" style="background: var(--ok-fg)"></span>Operational</span>
<span><span class="dot" style="background: var(--warn-fg)"></span>Degraded</span>
<span><span class="dot" style="background: var(--danger-fg)"></span>Outage</span>
<span><span class="dot" style="background: var(--gold-deep)"></span>Maintenance</span>
</span>`;
  return groupOrder
    .map((group, index) => {
      const heading = GROUP_HEADINGS[group] ?? group;
      const rows = (grouped.get(group) ?? []).map(renderComponentRow).join("\n");
      return `<div class="group-head"><span class="caps">${escapeHtml(heading)}</span>${index === 0 ? legend : ""}</div>
<div class="grid">
${rows}
</div>`;
    })
    .join("\n");
}

function renderProviders(snapshot: PublishedSnapshot): string {
  if (snapshot.providers.length === 0) return "";
  const rows = snapshot.providers
    .map((provider: Provider) => {
      const presentation = STATUS_PRESENTATION[provider.status];
      return `<span class="prov ${presentation.hue}-row"><span class="dot" aria-hidden="true"></span>${escapeHtml(provider.name)} <span class="st">${escapeHtml(presentation.label)}</span></span>`;
    })
    .join("\n");
  return `<div class="group-head"><span class="caps">Upstream providers</span></div>
<div class="providers">
${rows}
</div>
<p class="prov-note">&quot;Status unavailable&quot; means the provider&#39;s own status feed could not be reached; it never counts against this platform.</p>`;
}

function renderHistory(snapshot: PublishedSnapshot, resolvedEvents: PublishedEvent[]): string {
  const entries =
    resolvedEvents.length === 0
      ? `<div class="day"><div class="none">No past service events recorded.</div></div>`
      : resolvedEvents
          .map(
            (event) => `<div class="day">
<div class="d num">${formatUtcDate(event.startedAt)}</div>
<article class="hist">
<h3>${escapeHtml(event.title)}</h3>
<div class="meta">
<span class="chip ok">${event.impact === "maintenance" ? "Completed" : "Resolved"}</span>
<span class="chip">${escapeHtml(IMPACT_PRESENTATION[event.impact].label)}</span>
${event.affectedComponentIds.length > 0 ? `<span class="affected">Affected: ${componentNames(snapshot, event.affectedComponentIds)}</span>` : ""}
</div>
${renderEventUpdates(event)}
</article>
</div>`,
          )
          .join("\n");
  return `<h2 class="section">Past service events</h2>
<p class="section-sub">Updates newest first &middot; times UTC</p>
${entries}`;
}

function renderFooter(): string {
  return `<footer class="foot">
<p class="notice">This page runs on infrastructure kept separate from the application, so it stays
readable when the application is not. A green light means no known problem &mdash; services report
by exception. If this page is unreachable, see the
<a href="https://www.cloudflarestatus.com/">Cloudflare status page</a>.</p>
</footer>`;
}

// ---------------------------------------------------------------------------
// the page

export function renderStatusPage(
  snapshot: PublishedSnapshot,
  options: RenderStatusPageOptions = {},
): string {
  // Newest first in both lanes; an event is "live" until an operator marks it resolved.
  const activeEvents = snapshot.events
    .filter((event) => event.lifecycle !== "resolved")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const resolvedEvents = snapshot.events
    .filter((event) => event.lifecycle === "resolved")
    .sort((a, b) => (b.resolvedAt ?? b.startedAt).localeCompare(a.resolvedAt ?? a.startedAt));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Magna Carta &mdash; Service status</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${renderTopBar()}
<main class="col">
${renderVerdictBand(snapshot)}
${renderStaleStrip(snapshot, options.now)}
${activeEvents.map((event) => renderActiveEvent(snapshot, event)).join("\n")}
${renderComponentGroups(snapshot)}
${renderProviders(snapshot)}
${renderHistory(snapshot, resolvedEvents)}
${renderFooter()}
</main>
</body>
</html>`;
}
