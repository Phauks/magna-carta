// Pure renderer: PublishedSnapshot -> complete HTML document, no runtime dependencies.
//
// The page must be COMPLETE with zero JavaScript — a status page is consulted precisely when
// other things are broken, so nothing required for reading may depend on script. Everything the
// page loads (the stylesheet, the font) is served same-origin by this same worker at immutable
// /assets paths, so the 60-second meta refresh refetches only the HTML — and the bare HTML stays
// fully readable in sensible order if those requests ever fail. The small inline scripts are
// progressive enhancement only (countdown, scheme toggle, text size, the subscribe panel);
// everything a reader needs has a working static fallback. Every snapshot-sourced string is
// operator- or upstream-authored and is HTML-escaped here.
import type {
  ComponentHistory,
  ComponentStatus,
  EventImpact,
  PublishedSnapshot,
  Provider,
  ProviderStatus,
  UpstreamAdvisory,
} from "@magna-carta/status";
import { historyDayKeys } from "@magna-carta/status";
import {
  COUNTRY_DIAL_CODES,
  examplePlaceholderFor,
  formatNationalDigits,
  nationalNumberShapeFor,
} from "./country-dial-codes.ts";
import { STYLES_ASSET_PATH } from "./page-styles.ts";

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

// "info" is the calm blue reserved for maintenance — planned, informational, deliberately
// outside the red/green/yellow severity family and away from the brand golds.
type Hue = "ok" | "warn" | "danger" | "info" | "neutral";

const STATUS_PRESENTATION: Record<ProviderStatus, { label: string; hue: Hue }> = {
  operational: { label: "Operational", hue: "ok" },
  maintenance: { label: "Maintenance", hue: "info" },
  degraded: { label: "Degraded", hue: "warn" },
  partial_outage: { label: "Partial outage", hue: "danger" },
  major_outage: { label: "Major outage", hue: "danger" },
  // An unreachable provider feed is honest uncertainty about THEM — it must never wear an
  // outage color, or a Cloudflare feed hiccup would read as our incident.
  status_unavailable: { label: "Status unavailable", hue: "neutral" },
};

const VERDICT: Record<ComponentStatus, { headline: string; hue: Hue }> = {
  operational: { headline: "All systems operational", hue: "ok" },
  maintenance: { headline: "Scheduled maintenance in progress", hue: "info" },
  degraded: { headline: "Degraded performance on some services", hue: "warn" },
  partial_outage: { headline: "Partial outage in effect", hue: "danger" },
  major_outage: { headline: "Major outage in effect", hue: "danger" },
};

const IMPACT_PRESENTATION: Record<EventImpact, { label: string; hue: Hue }> = {
  minor: { label: "Minor impact", hue: "warn" },
  major: { label: "Major impact", hue: "danger" },
  critical: { label: "Critical impact", hue: "danger" },
  maintenance: { label: "Maintenance", hue: "info" },
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

// Lucide-style outline icons, inlined (self-containment law: no icon font, no sprite fetch).
const BELL_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
const SUN_ICON_SVG = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
const MOON_ICON_SVG = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
const TYPE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>`;

// ---------------------------------------------------------------------------
// fragments

function renderTopBar(activeEvent: PublishedEvent | null): string {
  // One header row: the brand lockup (a plain home anchor back to this page), then the links,
  // then the bell and the scheme icon. Every
  // dead item is a light-up seam shipped honest: muted ink, no pointer cursor, a title attribute
  // as the accessibility baseline, and a CSS-only hover "Soon" reveal (no JS required). Swap the
  // span for a real anchor when its destination ships — "Magna Carta" is the future marketing
  // site. The bell opens the subscribe panel (renderSubscribeControl below); the text-size and
  // scheme buttons start hidden and are revealed by the enhancement script — no-JS readers rely
  // on prefers-color-scheme and the browser's own zoom (the CSS swaps the toggle's sun/moon icon
  // by scheme, so the script never touches button contents).
  return `<header class="topbar"><div class="col">
<a href="/" class="home"><span class="mark">${BRAND_GLYPH_SVG}</span><span class="word">Magna Carta <span class="word-status">Status</span></span></a>
<span class="right">
<span class="dead"><span class="dead-link" title="Help Desk — soon">Help Desk</span></span>
<span class="dead"><span class="dead-link" title="Forums — soon">Forums</span></span>
<span class="dead"><span class="dead-link" title="Magna Carta — soon">Magna Carta</span></span>
${renderSubscribeControl(activeEvent)}
<button type="button" id="text-size" class="icon-button" hidden aria-label="Change text size" title="Text size: standard">${TYPE_ICON_SVG}</button>
<button type="button" id="scheme-toggle" class="icon-button toggle" hidden aria-label="Switch color scheme">${SUN_ICON_SVG}${MOON_ICON_SVG}</button>
</span>
</div></header>`;
}

function renderCountryOptions(): string {
  // United States carries the static selected attribute (a sensible no-script default for the
  // current audience); when scripts run, the enhancement script re-selects from the browser
  // locale's region, so most readers land on their own country without touching the list.
  // Each option carries its national-number shape (data-groups / data-max) plus its example
  // placeholder, which is rendered through the SAME formatter as live typing
  // (country-dial-codes.ts examplePlaceholderFor), so the example beside the country can never
  // disagree with what typing produces.
  return COUNTRY_DIAL_CODES.map((country) => {
    const shape = nationalNumberShapeFor(country);
    const groupsAttribute =
      shape.groups === undefined ? "" : ` data-groups="${shape.groups.join("-")}"`;
    return `<option value="${escapeHtml(country.dial)}" data-region="${escapeHtml(country.region)}"${groupsAttribute} data-max="${shape.maxDigits}" data-placeholder="${escapeHtml(examplePlaceholderFor(country))}"${country.region === "US" ? " selected" : ""}>${escapeHtml(country.name)} (${escapeHtml(country.dial)})</option>`;
  }).join("\n");
}

// The static placeholder for the no-script baseline comes from the same example pipeline.
const US_COUNTRY = COUNTRY_DIAL_CODES.find((country) => country.region === "US");
const DEFAULT_PHONE_PLACEHOLDER = US_COUNTRY === undefined ? "" : examplePlaceholderFor(US_COUNTRY);

function renderSubscribeControl(activeEvent: PublishedEvent | null): string {
  // The subscribe front door: the bell opens a real panel in its final anatomy, but nothing here
  // can fake a subscription; the dead backend stays isolated in the submit, which keeps the
  // hover-Soon treatment. Anatomy, top to bottom:
  // - SCOPE (native radio group): everything, or only the current issue — the second means one
  //   notice when THIS incident resolves, then done. With no live incident it stays visible but
  //   disabled ("No active issue"), so the anatomy still teaches what subscribing can do.
  // - CHANNEL (two-segment toggle, aria-pressed buttons): a subscription needs ONE channel, so
  //   the toggle chooses which single field shows. It is presentation and works today. Both
  //   field blocks share the same one-label-one-control-row shape so swapping never resizes the
  //   panel.
  // - The phone field pairs a full ITU dial-code control (country-dial-codes.ts) with a
  //   national-number input. The no-JS baseline is the plain select below (full country names;
  //   only its closed state truncates — the static title is accurate only for the untouched
  //   default selection, since without script nothing can update it; the enhancement path keeps
  //   its own label current);
  //   the enhancement script replaces it with a compact listbox — closed control shows only
  //   "ISO dial" (for example "US +1") so nothing overflows, the open list shows full names at
  //   content width. Flag artwork is deliberately NOT shipped: an accurate all-countries SVG
  //   set is megabytes of vendored artwork against a page currently ~50 KB total, so the ISO
  //   code carries the identity; if real flags are ever wanted, vendor a license-checked set as
  //   a lazily fetched same-origin sprite in its own change. The input accepts digits only
  //   (paste is digit-stripped) and groups them in the selected country's typical national
  //   pattern from the option's data attributes — presentational convenience only; countries
  //   with irregular plans get digit-limiting without grouping, and the backend owns real
  //   validation when the subscribe endpoint lands (the app's future PhoneInput compound owns
  //   the heavy version).
  // Light-up seam: enable the submit and wire the write when the notifications machinery ships —
  // the payload will carry scope ("all" or the incident id, which auto-expires at resolution by
  // the backend's contract), the CHOSEN channel, and its address (email, or the E.164-combined
  // number: dial code + national digits). The bell (like the other header enhancements) starts
  // hidden and is revealed by the script — without JavaScript the panel cannot open, and a
  // live-looking dead control would be dishonest.
  const currentIssueDetail =
    activeEvent === null
      ? `<span class="scope-detail">No active issue</span>`
      : `<span class="scope-detail">${escapeHtml(activeEvent.title)} (one notice when it resolves)</span>`;
  return `<span class="subscribe-wrap">
<button type="button" id="subscribe-bell" class="icon-button" hidden aria-haspopup="dialog" aria-expanded="false" aria-controls="subscribe-panel" aria-label="Subscribe to updates" title="Subscribe to updates">${BELL_ICON_SVG}</button>
<div id="subscribe-panel" class="subscribe-panel" role="dialog" aria-labelledby="subscribe-title" hidden>
<h2 id="subscribe-title">Subscribe to updates</h2>
<p class="subscribe-note">Email and text-message updates on service events are designed but not yet wired &mdash; delivery arrives with the notifications machinery.</p>
<fieldset class="scope-group">
<legend class="subscribe-label">What to receive</legend>
<label class="scope-option"><input type="radio" name="subscribe-scope" value="all" checked><span>All status updates</span></label>
<label class="scope-option${activeEvent === null ? " is-disabled" : ""}"><input type="radio" name="subscribe-scope" value="current"${activeEvent === null ? " disabled" : ` data-event-id="${escapeHtml(activeEvent.id)}"`}><span>Only the current issue${currentIssueDetail}</span></label>
</fieldset>
<div class="channel-toggle" role="group" aria-label="Delivery channel">
<button type="button" id="channel-email-button" class="channel-segment" aria-pressed="true">Email</button>
<button type="button" id="channel-phone-button" class="channel-segment" aria-pressed="false">Text messages</button>
</div>
<div class="channel-field" id="subscribe-field-email">
<label class="subscribe-label" for="subscribe-email">Email address</label>
<input id="subscribe-email" class="subscribe-input" type="email" name="email" autocomplete="email" placeholder="you@example.com">
</div>
<div class="channel-field" id="subscribe-field-phone" hidden>
<label class="subscribe-label" for="subscribe-phone">Phone number</label>
<div class="phone-row">
<select id="subscribe-country" class="subscribe-country" aria-label="Country code" title="United States (+1)">
${renderCountryOptions()}
</select>
<input id="subscribe-phone" class="subscribe-input" type="tel" name="phone" autocomplete="tel-national" inputmode="tel" pattern="[0-9 ]{4,17}" placeholder="${escapeHtml(DEFAULT_PHONE_PLACEHOLDER)}">
</div>
</div>
<span class="dead"><button type="button" class="subscribe-submit" disabled title="Subscribe — soon">Subscribe</button></span>
</div>
</span>`;
}

// The countdown target: the derived snapshot is republished on a 10-minute cron cadence
// (apps/worker's status cron), so the next check lands at generatedAt + 10 minutes.
const CHECK_CADENCE_MS = 10 * 60_000;

function nextCheckIso(generatedAt: string): string | null {
  const generated = new Date(generatedAt).getTime();
  if (Number.isNaN(generated)) return null;
  return new Date(generated + CHECK_CADENCE_MS).toISOString();
}

function renderNextCheckLine(snapshot: PublishedSnapshot, now: string | undefined): string {
  // The next-check instant is SERVER-derived from the snapshot's generatedAt and must be
  // identical across refreshes; a page load never starts a fresh window. Two honesty branches:
  // - When no derived snapshot exists yet, the parse fallback stamps generatedAt with the
  //   request moment (packages/status parseDerived), which would otherwise read as a live
  //   10-minute window that resets on every refresh. That fallback is detectable exactly by
  //   generatedAt equaling the render moment, and the truthful line is that the first check is
  //   still pending — no countdown, no data attribute.
  // - When the fixed target is already in the past, say so ("Next check due", the same wording
  //   the script uses) instead of presenting a stale future.
  const nextCheck = nextCheckIso(snapshot.generatedAt);
  if (nextCheck === null) return "";
  if (now !== undefined && snapshot.generatedAt === now) {
    return `\n<div>First check pending</div>`;
  }
  if (now !== undefined && nextCheck <= now) {
    return `\n<div data-next-check="${escapeHtml(nextCheck)}">Next check due</div>`;
  }
  // Static "Next check by HH:MM UTC" works with zero JavaScript; the enhancement script
  // upgrades the same element to a live countdown toward the same fixed instant.
  return `\n<div data-next-check="${escapeHtml(nextCheck)}">Next check by ${formatUtcTime(nextCheck)} UTC</div>`;
}

function renderVerdictBand(snapshot: PublishedSnapshot, now: string | undefined): string {
  const verdict = VERDICT[snapshot.overall];
  return `<section class="band ${verdict.hue}">
<span class="lamp" aria-hidden="true"><span class="lamp-halo"></span><span class="lamp-dot"></span></span>
<h1>${escapeHtml(verdict.headline)}</h1>
<div class="sub num"><div class="big">Checked ${formatUtcDateTime(snapshot.generatedAt)}</div>${renderNextCheckLine(snapshot, now)}</div>
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

// The uptime figure. A ratio short of a perfect record can never round up to "100%" — a page that
// rounds away its only outage is worse than one that shows no number at all. Percentages carry two
// decimals, the genre convention, so a single 10-minute sample in ninety days stays visible.
function formatUptime(uptimeRatio: number | null): string | null {
  if (uptimeRatio === null) return null;
  if (uptimeRatio >= 1) return "100% uptime";
  const percent = Math.min(uptimeRatio * 100, 99.99);
  return `${percent.toFixed(2)}% uptime`;
}

// The day-by-day record as sentences, for a reader who cannot see the bar. Ninety individually
// announced ticks would be unusable, and a hover-only title is not an answer at all — so
// consecutive days sharing a state collapse into one run ("2 June 2026 to 4 August 2026 — No
// data"). Every day in the window falls in exactly one run, so this is the complete per-day record,
// not a summary of it, and it is typically a handful of phrases rather than ninety.
export function describeHistoryRuns(
  ticks: readonly (ComponentStatus | null)[],
  dayKeys: readonly string[],
): string[] {
  const labelAt = (index: number): string => {
    const status = ticks[index];
    return status === null || status === undefined ? "No data" : STATUS_PRESENTATION[status].label;
  };
  const dayAt = (index: number): string => {
    const day = dayKeys[index];
    return day === undefined ? `day ${index + 1}` : formatUtcDate(day);
  };
  const runs: string[] = [];
  let runStart = 0;
  for (let index = 1; index <= ticks.length; index += 1) {
    if (index < ticks.length && labelAt(index) === labelAt(runStart)) continue;
    const last = index - 1;
    const span = runStart === last ? dayAt(runStart) : `${dayAt(runStart)} to ${dayAt(last)}`;
    runs.push(`${span} — ${labelAt(runStart)}`);
    runStart = index;
  }
  return runs;
}

// One tick per day in the window, oldest first, colored by the worst status observed that day; a day
// with no samples is a no-data tick, never a green one. The ticks themselves are decoration to
// assistive technology (each carries a title for the sighted reader's hover); the state they encode
// reaches a screen reader as real text — the labelled summary on the bar, the run-length record
// immediately after it, and the visible uptime figure on the axis. Nothing needs hovering.
function renderUptimeBar(
  component: PublishedComponent,
  history: ComponentHistory | undefined,
  dayKeys: readonly string[],
): string {
  if (history === undefined || history.ticks.length === 0) return "";
  const uptime = formatUptime(history.uptimeRatio);
  const summary = uptime === null ? "no uptime data yet" : uptime;
  const ticks = history.ticks
    .map((status, index) => {
      const hue = status === null ? "nodata" : STATUS_PRESENTATION[status].hue;
      const label = status === null ? "No data" : STATUS_PRESENTATION[status].label;
      const day = dayKeys[index];
      const title = day === undefined ? label : `${formatUtcDate(day)} — ${label}`;
      return `<span class="tick t-${hue}" title="${escapeHtml(title)}" aria-hidden="true"></span>`;
    })
    .join("");
  const record = describeHistoryRuns(history.ticks, dayKeys).join("; ");
  return `
<div class="bar" role="img" aria-label="${escapeHtml(`${component.name}: ${summary} over the last ${history.ticks.length} days`)}">${ticks}</div>
<p class="offscreen">Daily record for ${escapeHtml(component.name)}, oldest first: ${escapeHtml(record)}.</p>
<div class="bar-axis"><span>${history.ticks.length} days ago</span><span class="uptime num">${escapeHtml(uptime ?? "No data")}</span><span>Today</span></div>`;
}

function renderComponentRow(
  component: PublishedComponent,
  history: ComponentHistory | undefined,
  dayKeys: readonly string[],
): string {
  const presentation = STATUS_PRESENTATION[component.status];
  const note =
    component.note === undefined || component.note === ""
      ? ""
      : `\n<div class="note">${escapeHtml(component.note)}</div>`;
  return `<div class="row ${presentation.hue}-row">
<div class="line"><span class="dot" aria-hidden="true"></span><span class="name">${escapeHtml(component.name)}</span><span class="st">${escapeHtml(presentation.label)}</span></div>${note}${renderUptimeBar(component, history, dayKeys)}
</div>`;
}

// The page's one color key. Deliberately a single legend, right-aligned on the first component
// section rule — the genre convention (GitHub keeps its key adjacent to the component list), and
// one well-placed key beats two competing ones. The dot colors are the same custom properties
// the rows use, so the key stays truthful in both light and dark schemes automatically. The two
// outage severities share the danger hue, so one "Outage" entry covers both. "No data" shares
// --nodata-fg with every no-data row (a provider whose feed is unreachable today; any future
// component without data), so the key and the rows it explains cannot drift apart.
const COLOR_KEY_HTML = `<span class="legend" role="note" aria-label="Color key">
<span><span class="dot" style="background: var(--ok-fg)"></span>Operational</span>
<span><span class="dot" style="background: var(--warn-fg)"></span>Degraded</span>
<span><span class="dot" style="background: var(--danger-fg)"></span>Outage</span>
<span><span class="dot" style="background: var(--info-fg)"></span>Maintenance</span>
<span><span class="dot" style="background: var(--nodata-fg)"></span>No data</span>
</span>`;

function renderComponentGroups(snapshot: PublishedSnapshot, dayKeys: readonly string[]): string {
  if (snapshot.components.length === 0) {
    return `<div class="group-head"><span class="caps">Services</span>${COLOR_KEY_HTML}</div>
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
  return groupOrder
    .map((group, index) => {
      const heading = GROUP_HEADINGS[group] ?? group;
      const rows = (grouped.get(group) ?? [])
        .map((component) =>
          renderComponentRow(component, snapshot.history.components[component.id], dayKeys),
        )
        .join("\n");
      return `<div class="group-head"><span class="caps">${escapeHtml(heading)}</span>${index === 0 ? COLOR_KEY_HTML : ""}</div>
<div class="grid">
${rows}
</div>`;
    })
    .join("\n");
}

function providerStatusPageUrl(provider: Provider): string | null {
  // The provider row carries the human status page explicitly when it differs from the feed's
  // origin (Cloudflare serves its API from one host and publishes the page readers should visit at
  // another). Otherwise the feed URL is the machine endpoint (…/api/v2/summary.json) and its origin
  // is the page — the link a reader wants, and the one destination that stays reachable when that
  // provider is the thing that broke.
  if (provider.statusPageUrl !== undefined && provider.statusPageUrl !== "") {
    return provider.statusPageUrl;
  }
  try {
    return new URL(provider.upstreamUrl).origin;
  } catch {
    return null;
  }
}

// What a provider is reporting, as a phrase that completes "X is reporting ___". The status LABELS
// ("Degraded", "Partial outage") are column headings, not sentence fragments — dropping one into
// prose reads as a stutter. Only the statuses that can raise an advisory appear: an operational
// provider raises nothing, and an unreachable feed is uncertainty about them, not a report by them.
const ADVISORY_PHRASE: Partial<Record<ProviderStatus, string>> = {
  degraded: "degraded performance",
  partial_outage: "a partial outage",
  major_outage: "a major outage",
  maintenance: "scheduled maintenance",
};

// The upstream advisory: a provider in trouble is context, never a verdict about this platform. It
// gets its own surface in neutral ink — deliberately outside the warn/danger family the verdict band
// owns, so a Cloudflare incident can never be mistaken for a Magna Carta one — carrying the
// provider's own severity dot and a link to the status page that is actually authoritative for it.
function renderUpstreamAdvisory(advisory: UpstreamAdvisory | null): string {
  if (advisory === null) return "";
  const clauses = advisory.providers.map((provider: Provider) => {
    const statusPage = providerStatusPageUrl(provider);
    const name =
      statusPage === null
        ? escapeHtml(provider.name)
        : `<a href="${escapeHtml(statusPage)}">${escapeHtml(provider.name)}</a>`;
    const phrase = ADVISORY_PHRASE[provider.status] ?? "a problem";
    return `${name} is reporting ${escapeHtml(phrase)}`;
  });
  // "A is reporting X" / "A is reporting X and B is reporting Y" / "…, B …, and C …"
  const sentence =
    clauses.length === 1
      ? (clauses[0] as string)
      : clauses.length === 2
        ? clauses.join(" and ")
        : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  const plural = advisory.providers.length > 1;
  return `<section class="advisory" role="note" aria-label="Upstream provider advisory">
<span class="dot ${STATUS_PRESENTATION[advisory.worst].hue}-dot" aria-hidden="true"></span>
<div>
<div class="advisory-head caps">Upstream advisory</div>
<p>${sentence} on ${plural ? "their own status pages" : "its own status page"}. This is ${plural ? "their" : "the provider&#39;s"} status, not ours &mdash; our own services report separately below, and you may still see slowness while ${plural ? "they recover" : "it recovers"}.</p>
</div>
</section>`;
}

function renderProviders(snapshot: PublishedSnapshot): string {
  if (snapshot.providers.length === 0) return "";
  const rows = snapshot.providers
    .map((provider: Provider) => {
      const presentation = STATUS_PRESENTATION[provider.status];
      const statusPage = providerStatusPageUrl(provider);
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
<p class="prov-note">These are the platforms this service is built on, reporting their own status. A provider&#39;s status never sets the verdict above &mdash; only our own checks do. &quot;Status unavailable&quot; means the provider&#39;s own status feed could not be reached.</p>`;
}

// The archive covers the same window as the uptime bars, so the two tell one story. Only days that
// had an event are listed; the remainder is accounted for in a single line rather than in dozens of
// empty rows. The count comes from the days actually covered, never from a blanket "89" — a page
// three weeks old must not claim ninety quiet days it never observed.
function renderHistory(
  snapshot: PublishedSnapshot,
  resolvedEvents: PublishedEvent[],
  dayKeys: readonly string[],
): string {
  const windowDays = snapshot.history.windowDays;
  const inWindow = new Set(dayKeys);
  const windowed = resolvedEvents.filter((event) =>
    inWindow.has((event.resolvedAt ?? event.startedAt).slice(0, 10)),
  );
  const eventDays = new Set(windowed.map((event) => event.startedAt.slice(0, 10)));
  const quietDays = Math.max(windowDays - eventDays.size, 0);
  const quietLine =
    windowed.length === 0
      ? `<div class="day"><div class="none">No service events recorded in the last ${windowDays} days.</div></div>`
      : `<p class="quiet-note">No incidents reported on the other ${quietDays} ${quietDays === 1 ? "day" : "days"}.</p>`;
  const entries =
    windowed.length === 0
      ? ""
      : windowed
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
<p class="section-sub">Last ${windowDays} days &middot; newest first &middot; times UTC</p>
${entries}
${quietLine}`;
}

// No footer: the owner removed the closing paragraph outright; the footer region develops
// separately in a later round.

// ---------------------------------------------------------------------------
// progressive enhancement (the page is complete without any script)

// Applied before first paint so persisted choices (scheme, text size) do not flash defaults.
const BOOT_SCRIPT = `<script>try{var storedScheme=localStorage.getItem("mc-status-scheme");if(storedScheme==="dark"||storedScheme==="light"){document.documentElement.setAttribute("data-scheme",storedScheme);}var storedText=localStorage.getItem("mc-status-text");if(storedText==="large"||storedText==="larger"){document.documentElement.setAttribute("data-text",storedText);}}catch(error){}</script>`;

const ENHANCEMENT_SCRIPT = `<script>
(function () {
  var root = document.documentElement;

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
    var currentScheme = function () {
      var stamped = root.getAttribute("data-scheme");
      if (stamped === "dark" || stamped === "light") return stamped;
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    // The button holds both sun and moon SVGs; CSS shows the right one per scheme, so this
    // handler only stamps the scheme — it never rewrites the button's contents. The label and
    // title announce the current scheme and the action on every toggle (the text-size button's
    // relabel pattern), so assistive tech hears state, not just "switch".
    var relabelScheme = function () {
      var scheme = currentScheme();
      var nextScheme = scheme === "dark" ? "light" : "dark";
      toggle.setAttribute("aria-label", "Color scheme: " + scheme + " (switch to " + nextScheme + ")");
      toggle.title = "Color scheme: " + scheme + " (switch to " + nextScheme + ")";
    };
    toggle.hidden = false;
    relabelScheme();
    toggle.addEventListener("click", function () {
      var nextScheme = currentScheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-scheme", nextScheme);
      try {
        localStorage.setItem("mc-status-scheme", nextScheme);
      } catch (error) {}
      relabelScheme();
    });
  }

  var textButton = document.getElementById("text-size");
  if (textButton) {
    var textSteps = ["standard", "large", "larger"];
    var currentText = function () {
      return root.getAttribute("data-text") || "standard";
    };
    var relabelText = function () {
      textButton.title = "Text size: " + currentText();
      textButton.setAttribute("aria-label", "Change text size (now " + currentText() + ")");
    };
    textButton.hidden = false;
    relabelText();
    textButton.addEventListener("click", function () {
      var next = textSteps[(textSteps.indexOf(currentText()) + 1) % textSteps.length];
      if (next === "standard") {
        root.removeAttribute("data-text");
      } else {
        root.setAttribute("data-text", next);
      }
      try {
        localStorage.setItem("mc-status-text", next);
      } catch (error) {}
      relabelText();
    });
  }

  var bell = document.getElementById("subscribe-bell");
  var panel = document.getElementById("subscribe-panel");
  if (bell && panel) {
    var closePanel = function (returnFocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
      if (returnFocus) bell.focus();
    };
    bell.hidden = false;
    bell.addEventListener("click", function () {
      if (panel.hidden) {
        panel.hidden = false;
        bell.setAttribute("aria-expanded", "true");
        var visibleInput = panel.querySelector(".channel-field:not([hidden]) .subscribe-input");
        if (visibleInput) visibleInput.focus();
      } else {
        closePanel(true);
      }
    });
    document.addEventListener("keydown", function (keyboardEvent) {
      if (keyboardEvent.key === "Escape") closePanel(true);
    });
    document.addEventListener("click", function (pointerEvent) {
      if (!panel.hidden && !panel.contains(pointerEvent.target) && !bell.contains(pointerEvent.target)) {
        closePanel(false);
      }
    });

    var emailButton = document.getElementById("channel-email-button");
    var phoneButton = document.getElementById("channel-phone-button");
    var emailField = document.getElementById("subscribe-field-email");
    var phoneField = document.getElementById("subscribe-field-phone");
    if (emailButton && phoneButton && emailField && phoneField) {
      var chooseChannel = function (channel) {
        emailField.hidden = channel !== "email";
        phoneField.hidden = channel !== "phone";
        emailButton.setAttribute("aria-pressed", channel === "email" ? "true" : "false");
        phoneButton.setAttribute("aria-pressed", channel === "phone" ? "true" : "false");
      };
      emailButton.addEventListener("click", function () {
        chooseChannel("email");
      });
      phoneButton.addEventListener("click", function () {
        chooseChannel("phone");
      });
    }

    // Preselect the dial code from the browser locale's region; the static markup already
    // selects United States for readers without script.
    var countrySelect = document.getElementById("subscribe-country");
    if (countrySelect && navigator.language) {
      var localeRegion = (navigator.language.split("-")[1] || "").toUpperCase();
      if (localeRegion) {
        for (var optionIndex = 0; optionIndex < countrySelect.options.length; optionIndex += 1) {
          if (countrySelect.options[optionIndex].getAttribute("data-region") === localeRegion) {
            countrySelect.selectedIndex = optionIndex;
            break;
          }
        }
      }
    }

    // Digits-only national number, grouped for EVERY country: the table's national shape where
    // known, the generic readability fallback otherwise. The formatter below is the exact
    // unit-tested function from country-dial-codes.ts, injected verbatim.
    var formatNationalDigits = ${formatNationalDigits.toString()};
    var phoneInput = document.getElementById("subscribe-phone");
    var formatPhone = function () {
      if (!phoneInput || !countrySelect) return;
      var selected = countrySelect.options[countrySelect.selectedIndex];
      var maxDigits = parseInt((selected && selected.getAttribute("data-max")) || "12", 10);
      var digits = phoneInput.value.replace(/\\D/g, "").slice(0, maxDigits);
      phoneInput.value = formatNationalDigits(digits, selected && selected.getAttribute("data-groups"));
      // The example follows the same formatter (stamped server-side from the same function),
      // so the placeholder can never disagree with live typing.
      var placeholder = selected && selected.getAttribute("data-placeholder");
      if (placeholder) phoneInput.placeholder = placeholder;
    };
    if (phoneInput && countrySelect) {
      phoneInput.addEventListener("input", formatPhone);
      countrySelect.addEventListener("change", formatPhone);
      // Align value and placeholder with the (possibly locale-preselected) country at load.
      formatPhone();
    }

    // The country control upgrades to a compact listbox: the CLOSED control shows only
    // "ISO dial" (nothing overflows at any text size); the OPEN list shows full names at
    // content width, scrolling, with arrow keys, Enter/Escape, and type-to-jump. The native
    // select stays in the DOM as the data store and the no-JS baseline.
    if (countrySelect) {
      var phoneRow = countrySelect.parentNode;
      var countryButton = document.createElement("button");
      countryButton.type = "button";
      countryButton.id = "subscribe-country-button";
      countryButton.className = "country-button";
      countryButton.setAttribute("aria-haspopup", "listbox");
      countryButton.setAttribute("aria-expanded", "false");
      var countryList = document.createElement("div");
      countryList.id = "subscribe-country-listbox";
      countryList.className = "country-listbox";
      countryList.setAttribute("role", "listbox");
      countryList.setAttribute("aria-label", "Country codes");
      countryList.tabIndex = -1;
      countryList.hidden = true;
      var countryRows = [];
      for (var buildIndex = 0; buildIndex < countrySelect.options.length; buildIndex += 1) {
        var sourceOption = countrySelect.options[buildIndex];
        var row = document.createElement("div");
        row.setAttribute("role", "option");
        row.id = "country-option-" + buildIndex;
        row.className = "country-option";
        row.setAttribute("data-index", String(buildIndex));
        row.textContent = sourceOption.textContent;
        countryList.appendChild(row);
        countryRows.push(row);
      }
      var relabelCountry = function () {
        var selected = countrySelect.options[countrySelect.selectedIndex];
        countryButton.textContent = selected.getAttribute("data-region") + " " + selected.value;
        countryButton.setAttribute("aria-label", "Country code: " + selected.textContent);
        for (var rowIndex = 0; rowIndex < countryRows.length; rowIndex += 1) {
          countryRows[rowIndex].setAttribute(
            "aria-selected",
            rowIndex === countrySelect.selectedIndex ? "true" : "false",
          );
        }
        countryList.setAttribute("aria-activedescendant", "country-option-" + countrySelect.selectedIndex);
      };
      var closeCountryList = function (returnFocus) {
        if (countryList.hidden) return;
        countryList.hidden = true;
        countryButton.setAttribute("aria-expanded", "false");
        if (returnFocus) countryButton.focus();
      };
      var openCountryList = function () {
        countryList.hidden = false;
        countryButton.setAttribute("aria-expanded", "true");
        relabelCountry();
        countryList.focus();
        var current = countryRows[countrySelect.selectedIndex];
        if (current && current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
      };
      var chooseCountry = function (index) {
        countrySelect.selectedIndex = index;
        countrySelect.title = countrySelect.options[index].textContent;
        relabelCountry();
        formatPhone();
        closeCountryList(true);
      };
      countryButton.addEventListener("click", function () {
        if (countryList.hidden) openCountryList();
        else closeCountryList(true);
      });
      countryList.addEventListener("click", function (clickEvent) {
        var target = clickEvent.target;
        while (target && target !== countryList && !target.getAttribute("data-index")) {
          target = target.parentNode;
        }
        if (target && target !== countryList) chooseCountry(parseInt(target.getAttribute("data-index"), 10));
      });
      var typeahead = "";
      var typeaheadClearTimer = 0;
      countryList.addEventListener("keydown", function (keyboardEvent) {
        var index = countrySelect.selectedIndex;
        if (keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowUp") {
          keyboardEvent.preventDefault();
          index += keyboardEvent.key === "ArrowDown" ? 1 : -1;
          index = Math.max(0, Math.min(countryRows.length - 1, index));
          countrySelect.selectedIndex = index;
          relabelCountry();
          countryRows[index].scrollIntoView({ block: "nearest" });
        } else if (keyboardEvent.key === "Home" || keyboardEvent.key === "End") {
          keyboardEvent.preventDefault();
          index = keyboardEvent.key === "Home" ? 0 : countryRows.length - 1;
          countrySelect.selectedIndex = index;
          relabelCountry();
          countryRows[index].scrollIntoView({ block: "nearest" });
        } else if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          chooseCountry(index);
        } else if (keyboardEvent.key === "Escape") {
          keyboardEvent.preventDefault();
          // Close ONLY the listbox: without this, the document-level Escape handler would also
          // close the whole subscribe panel in the same keystroke.
          keyboardEvent.stopPropagation();
          closeCountryList(true);
        } else if (keyboardEvent.key.length === 1 && keyboardEvent.key !== " ") {
          // Type-to-jump on the visible names.
          typeahead += keyboardEvent.key.toLowerCase();
          window.clearTimeout(typeaheadClearTimer);
          typeaheadClearTimer = window.setTimeout(function () {
            typeahead = "";
          }, 700);
          for (var searchIndex = 0; searchIndex < countryRows.length; searchIndex += 1) {
            if (countryRows[searchIndex].textContent.toLowerCase().indexOf(typeahead) === 0) {
              countrySelect.selectedIndex = searchIndex;
              relabelCountry();
              countryRows[searchIndex].scrollIntoView({ block: "nearest" });
              break;
            }
          }
        }
      });
      document.addEventListener("click", function (pointerEvent) {
        if (!countryList.hidden && !countryList.contains(pointerEvent.target) && !countryButton.contains(pointerEvent.target)) {
          closeCountryList(false);
        }
      });
      countrySelect.hidden = true;
      phoneRow.insertBefore(countryButton, countrySelect);
      phoneRow.insertBefore(countryList, countrySelect);
      relabelCountry();
    }
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

  // The tick dates. The window ends at the render moment when one is supplied, and otherwise at the
  // snapshot's own generatedAt, so the bars stay aligned with the data they describe rather than
  // with a clock the snapshot never saw.
  const dayKeys = historyDayKeys(options.now ?? snapshot.generatedAt, snapshot.history.windowDays);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Magna Carta Status</title>
<link rel="stylesheet" href="${STYLES_ASSET_PATH}">
${BOOT_SCRIPT}
</head>
<body>
${renderTopBar(activeEvents[0] ?? null)}
<main class="col">
${renderVerdictBand(snapshot, options.now)}
${renderStaleStrip(snapshot, options.now)}
${renderUpstreamAdvisory(snapshot.upstreamAdvisory)}
${activeEvents.map((event) => renderActiveEvent(snapshot, event)).join("\n")}
${renderComponentGroups(snapshot, dayKeys)}
${renderProviders(snapshot)}
${renderHistory(snapshot, resolvedEvents, dayKeys)}
</main>
${ENHANCEMENT_SCRIPT}
</body>
</html>`;
}
