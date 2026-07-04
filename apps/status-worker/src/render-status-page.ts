// Pure renderer: PublishedSnapshot -> complete HTML document, no runtime dependencies.
//
// The page must be COMPLETE with zero JavaScript — a status page is consulted precisely when
// other things are broken, so nothing required for reading may depend on script or any external
// asset. A meta refresh keeps it current without script. The two small inline scripts are
// progressive enhancement only (a live countdown and the scheme toggle); everything they touch
// has a working static fallback. Every snapshot-sourced string is operator- or upstream-authored
// and is HTML-escaped here.
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
// brand

// The app's brand lockup is BrandMark (packages/design-system/src/lib/components/brand-mark):
// the letter "M" set in UnifrakturMaguntia 400 (the --mc-font-blackletter face, shipped via
// @fontsource/unifrakturmaguntia) beside the wordmark in Atkinson Hyperlegible Next, 0.75rem,
// semibold, uppercase, 0.125rem tracking. This page is self-contained, so the glyph is the exact
// "M" outline extracted from unifrakturmaguntia-latin-400-normal.woff2 as an inline SVG path
// (~1.5 KB — cheaper and sharper than a data-URI font subset), and the wordmark reproduces the
// casing/tracking/weight on the closest self-contained stack (system-ui approximating Atkinson
// Hyperlegible Next, which is itself a humanist sans).
const BRAND_GLYPH_SVG = `<svg class="brand-glyph" viewBox="51 -1436 2158 1467" aria-hidden="true" focusable="false"><path transform="scale(1 -1)" fill="currentColor" d="M564 553Q566 609 537.5 622.5Q509 636 417 615Q275 581 163.0 678.0Q51 775 51 967Q52 1158 190.0 1297.0Q328 1436 520 1436Q607 1436 709.0 1393.0Q811 1350 883 1265Q889 1257 896.0 1258.0Q903 1259 908 1267Q952 1339 1021.5 1388.0Q1091 1437 1206 1434Q1355 1427 1473 1250Q1479 1241 1488.0 1241.0Q1497 1241 1502 1251Q1544 1329 1608.0 1379.0Q1672 1429 1768 1429Q1891 1427 1971.0 1354.0Q2051 1281 2087 1109Q2109 990 2179 983Q2199 982 2200.5 966.0Q2202 950 2176 942Q1982 876 1909.0 730.5Q1836 585 1915 360Q1950 258 2015.5 216.5Q2081 175 2159 223Q2188 240 2202.5 222.5Q2217 205 2197 188Q2129 134 2062.5 80.5Q1996 27 1929 -26Q1918 -34 1908 -26Q1695 145 1651.5 354.0Q1608 563 1927 849Q1934 856 1933.5 863.0Q1933 870 1924 875Q1854 922 1821 1116Q1786 1308 1665 1310Q1579 1312 1519 1184Q1515 1177 1519 1170Q1558 1087 1575.5 985.0Q1593 883 1577 769Q1537 493 1458.5 352.5Q1380 212 1272 72Q1129 -107 1002 33Q966 73 926.5 85.0Q887 97 836 57Q817 41 803.5 53.5Q790 66 805 85Q933 263 1008.5 288.0Q1084 313 1156 246Q1215 191 1264.5 187.0Q1314 183 1342 261Q1396 411 1380.5 680.5Q1365 950 1271.5 1094.0Q1178 1238 1093.5 1263.5Q1009 1289 940 1219Q930 1209 939 1198Q1058 1033 1067 816Q1073 638 998.0 474.5Q923 311 805 161Q676 -3 560.5 -27.0Q445 -51 349 90Q265 216 178 121Q157 103 140.5 120.0Q124 137 145 159Q418 437 574 232Q599 198 621.5 169.0Q644 140 689 142Q747 144 811.0 269.0Q875 394 875 584Q873 833 745.0 1020.5Q617 1208 452 1226Q287 1243 192.0 1164.0Q97 1085 100 977Q103 867 158.5 801.0Q214 735 364 774Q653 848 615 561Q611 531 587.5 530.5Q564 530 564 553Z"/></svg>`;

// ---------------------------------------------------------------------------
// fragments

function renderTopBar(): string {
  // The whole link row lives in the header (the footer develops separately later). Every item
  // is a light-up seam shipped dead-but-honest with the Soon badge: swap the span for a real
  // anchor when its destination ships (help desk, forums, the marketing site), and enable the
  // subscribe button — the genre's prominent affordance (GitHub status leads with it) — when
  // notifications exist. The scheme toggle starts hidden and is revealed by the enhancement
  // script; no-JS readers rely on prefers-color-scheme.
  return `<header class="topbar"><div class="col">
<span class="mark">${BRAND_GLYPH_SVG}</span>
<span class="word">Magna Carta</span>
<span class="caps surface">Status</span>
<span class="right">
<span class="dead"><span class="dead-link">Help Desk</span><span class="soon">Soon</span></span>
<span class="dead"><span class="dead-link">Forums</span><span class="soon">Soon</span></span>
<span class="dead"><span class="dead-link">magna-carta.com</span><span class="soon">Soon</span></span>
<span class="dead"><button type="button" class="btn-subscribe" disabled>Subscribe to updates</button><span class="soon">Soon</span></span>
<button type="button" id="scheme-toggle" class="toggle" hidden aria-label="Switch color scheme">Dark</button>
</span>
</div></header>`;
}

// The countdown target: the derived snapshot is republished on a 10-minute cron cadence
// (apps/worker's status cron), so the next check lands at generatedAt + 10 minutes.
const CHECK_CADENCE_MS = 10 * 60_000;

function nextCheckIso(generatedAt: string): string | null {
  const generated = new Date(generatedAt).getTime();
  if (Number.isNaN(generated)) return null;
  return new Date(generated + CHECK_CADENCE_MS).toISOString();
}

function renderVerdictBand(snapshot: PublishedSnapshot): string {
  const verdict = VERDICT[snapshot.overall];
  const nextCheck = nextCheckIso(snapshot.generatedAt);
  // Static "Next check by HH:MM UTC" works with zero JavaScript; the enhancement script
  // upgrades the same element to a live mm:ss countdown via the data attribute.
  const nextCheckLine =
    nextCheck === null
      ? ""
      : `\n<div data-next-check="${escapeHtml(nextCheck)}">Next check by ${formatUtcTime(nextCheck)} UTC</div>`;
  return `<section class="band ${verdict.hue}">
<span class="lamp" aria-hidden="true"></span>
<h1>${escapeHtml(verdict.headline)}</h1>
<div class="sub num"><div class="big">Checked ${formatUtcDateTime(snapshot.generatedAt)}</div>${nextCheckLine}</div>
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

function providerStatusPageUrl(upstreamUrl: string): string | null {
  // The stored URL is the machine feed (…/api/v2/summary.json); its origin is the provider's
  // human status page, which is the link a reader wants — and the one destination that stays
  // reachable when that provider is the thing that broke.
  try {
    return new URL(upstreamUrl).origin;
  } catch {
    return null;
  }
}

function renderProviders(snapshot: PublishedSnapshot): string {
  if (snapshot.providers.length === 0) return "";
  const rows = snapshot.providers
    .map((provider: Provider) => {
      const presentation = STATUS_PRESENTATION[provider.status];
      const statusPage = providerStatusPageUrl(provider.upstreamUrl);
      const name =
        statusPage === null
          ? escapeHtml(provider.name)
          : `<a href="${escapeHtml(statusPage)}">${escapeHtml(provider.name)}</a>`;
      return `<span class="prov ${presentation.hue}-row"><span class="dot" aria-hidden="true"></span>${name} <span class="st">${escapeHtml(presentation.label)}</span></span>`;
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
  // Just the honesty paragraph, wrapping naturally across the measure — the footer develops
  // separately later; all site links live in the header.
  return `<footer class="foot">
<p class="notice">This page runs on infrastructure kept separate from the application, so it stays readable when the application is not. A green light means no known problem &mdash; services report by exception.</p>
</footer>`;
}

// ---------------------------------------------------------------------------
// progressive enhancement (the page is complete without either script)

// Applied before first paint so a persisted scheme choice does not flash the system scheme.
const SCHEME_BOOT_SCRIPT = `<script>try{var storedScheme=localStorage.getItem("mc-status-scheme");if(storedScheme==="dark"||storedScheme==="light"){document.documentElement.setAttribute("data-scheme",storedScheme);}}catch(error){}</script>`;

const ENHANCEMENT_SCRIPT = `<script>
(function () {
  var countdown = document.querySelector("[data-next-check]");
  if (countdown) {
    var due = Date.parse(countdown.getAttribute("data-next-check") || "");
    if (!isNaN(due)) {
      var tick = function () {
        var remainingMs = due - Date.now();
        if (remainingMs <= 0) {
          countdown.textContent = "Next check due";
          return;
        }
        var totalSeconds = Math.floor(remainingMs / 1000);
        var minutes = Math.floor(totalSeconds / 60);
        var seconds = totalSeconds % 60;
        countdown.textContent = "Next check in " + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
        window.setTimeout(tick, 1000);
      };
      tick();
    }
  }
  var toggle = document.getElementById("scheme-toggle");
  if (toggle) {
    var root = document.documentElement;
    var currentScheme = function () {
      var stamped = root.getAttribute("data-scheme");
      if (stamped === "dark" || stamped === "light") return stamped;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    var relabel = function () {
      toggle.textContent = currentScheme() === "dark" ? "Light" : "Dark";
    };
    toggle.hidden = false;
    relabel();
    toggle.addEventListener("click", function () {
      var nextScheme = currentScheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-scheme", nextScheme);
      try {
        localStorage.setItem("mc-status-scheme", nextScheme);
      } catch (error) {}
      relabel();
    });
  }
})();
</script>`;

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
${SCHEME_BOOT_SCRIPT}
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
${ENHANCEMENT_SCRIPT}
</body>
</html>`;
}
