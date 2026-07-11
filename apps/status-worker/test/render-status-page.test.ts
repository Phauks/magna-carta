import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import {
  HISTORY_WINDOW_DAYS,
  STATUS_KV_KEYS,
  type ComponentStatus,
  type PublishedSnapshot,
} from "@magna-carta/status";
import {
  COUNTRY_DIAL_CODES,
  examplePlaceholderFor,
  formatNationalNumber,
} from "../src/country-dial-codes.ts";
import { FONT_ASSET_PATH, PAGE_CSS, STYLES_ASSET_PATH } from "../src/page-styles.ts";
import { renderStatusPage } from "../src/render-status-page.ts";

const GENERATED_AT = "2026-07-03T14:20:00.000Z";

// A full window of operational ticks with a perfect ratio, unless a test says otherwise.
function componentHistory(
  ticks: (ComponentStatus | null)[] = Array(HISTORY_WINDOW_DAYS).fill("operational"),
  uptimeRatio: number | null = 1,
) {
  return { ticks, uptimeRatio };
}

function historyFor(componentIds: string[]): PublishedSnapshot["history"] {
  return {
    windowDays: HISTORY_WINDOW_DAYS,
    components: Object.fromEntries(componentIds.map((id) => [id, componentHistory()])),
  };
}

function snapshotFixture(overrides: Partial<PublishedSnapshot> = {}): PublishedSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    overall: "operational",
    components: [
      { id: "api", name: "Application API", group: "Core", status: "operational" },
      {
        id: "control-plane-database",
        name: "Control-plane database",
        group: "Core",
        status: "operational",
      },
      { id: "collabora", name: "Document editing", group: "Engines", status: "operational" },
      { id: "libreoffice", name: "Document conversion", group: "Engines", status: "operational" },
    ],
    providers: [
      {
        id: "cloudflare",
        name: "Cloudflare",
        status: "operational",
        upstreamUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
        fetchedAt: GENERATED_AT,
        reachable: true,
      },
    ],
    upstreamAdvisory: null,
    events: [],
    history: historyFor([
      "api",
      "control-plane-database",
      "collabora",
      "libreoffice",
      "tantivy",
      "ocr",
    ]),
    stale: false,
    ...overrides,
  };
}

describe("renderStatusPage", () => {
  test("operational steady state: verdict, both groups, providers, header anatomy", () => {
    const html = renderStatusPage(snapshotFixture());
    expect(html).toContain("All systems operational");
    expect(html).toContain('class="band ok"');
    expect(html).toContain("Core services");
    expect(html).toContain("Document &amp; analysis engines");
    expect(html).toContain("Application API");
    expect(html).toContain("Document conversion");
    expect(html).toContain("Checked 3 July 2026, 14:20 UTC");
    // No footer: the owner removed the closing paragraph; the region develops separately later.
    expect(html).not.toContain("<footer");
    // The Cloudflare provider row keeps its link-out (reachable exactly when it matters).
    expect(html).toContain('<a href="https://www.cloudflarestatus.com">Cloudflare</a>');
    // Complete with zero JavaScript: static countdown text plus the meta refresh; the inline
    // scripts only enhance. The stylesheet is a same-origin content-hashed asset so the
    // 60-second refresh refetches only the HTML.
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
    expect(html).toContain(`<link rel="stylesheet" href="${STYLES_ASSET_PATH}">`);
    expect(html).toContain("Next check by 14:30 UTC");
    expect(html).toContain('data-next-check="2026-07-03T14:30:00.000Z"');
    expect(html).not.toContain("Reviewed every 10 minutes");
    // The machine feed is unadvertised (still served; just not linked).
    expect(html).not.toContain(">status.json<");
    // The brand lockup is the app's, with "Status" joined into the same wordmark treatment,
    // and the whole lockup is a plain home anchor back to this page.
    expect(html).toContain('<a href="/" class="home">');
    expect(html).toContain('class="brand-glyph"');
    expect(html).toContain(
      '<span class="word">Magna Carta <span class="word-status">Status</span></span>',
    );
    // Header link row, all dead-but-honest until their slices ship: quiet at rest (no badge
    // text), title attribute as the accessibility baseline, CSS hover reveal of "Soon".
    expect(html).toContain('title="Help Desk — soon"');
    expect(html).toContain('title="Forums — soon"');
    expect(html).toContain('title="Magna Carta — soon"');
    expect(html).not.toContain("magna-carta.com");
    expect(html).not.toContain('class="soon"');
    expect(html).not.toContain(">Soon<");
    // Text-size button: a hidden enhancement cycling a rem-based root ladder (the no-JS
    // baseline is browser zoom; the persisted step is applied pre-paint by the boot script).
    expect(html).toContain('id="text-size"');
    expect(html).toMatch(/id="text-size"[^>]*hidden/);
    expect(html).toContain("mc-status-text");
    const bandIndex = html.indexOf('class="band');
    expect(html.indexOf("Help Desk")).toBeLessThan(bandIndex);
    expect(html.indexOf('id="subscribe-bell"')).toBeLessThan(bandIndex);
    // The lamp: static solid dot over the breathing halo, both markup children present.
    expect(html).toContain('<span class="lamp-halo"></span><span class="lamp-dot"></span>');
    // The page's single color key sits on the first component section rule, No data included.
    expect(html).toContain('aria-label="Color key"');
    expect((html.match(/aria-label="Color key"/g) ?? []).length).toBe(1);
    expect(html).toContain(">No data</span>");
    expect(html).toContain('style="background: var(--nodata-fg)"');
    // Scheme and channel controls exist for the enhancement script to reveal/wire; the toggle
    // announces its current scheme and the action on every flip.
    expect(html).toContain('id="scheme-toggle"');
    expect(html).toMatch(/id="scheme-toggle"[^>]*hidden/);
    expect(html).toContain('class="icon-sun"');
    expect(html).toContain('class="icon-moon"');
    expect(html).toContain("relabelScheme");
    expect(html).toContain('"Color scheme: " + scheme');
    // No live-event card and an explicitly empty archive in the steady state.
    expect(html).not.toContain('class="live');
    expect(html).toContain("No service events recorded in the last 90 days.");
    // A calm upstream raises no advisory.
    expect(html).not.toContain('class="advisory"');
  });

  test("subscribe panel: scope choice, working channel toggle wiring, dial-code select", () => {
    const html = renderStatusPage(snapshotFixture());
    // Bell: a real toggle now (no Soon treatment on the bell itself), aria wired both ways.
    expect(html).toContain('id="subscribe-bell"');
    expect(html).toMatch(/id="subscribe-bell"[^>]*aria-expanded="false"/);
    expect(html).toContain('title="Subscribe to updates"');
    expect(html).not.toContain('title="Subscribe to updates — soon"');
    expect(html).toMatch(/<div id="subscribe-panel"[^>]*role="dialog"[^>]*hidden/);
    expect(html).toContain('aria-labelledby="subscribe-title"');
    // Scope: native radio group, "all" default; with no live incident the current-issue option
    // stays visible but disabled with the quiet note.
    expect(html).toContain("What to receive");
    expect(html).toMatch(/name="subscribe-scope" value="all" checked/);
    expect(html).toMatch(/name="subscribe-scope" value="current" disabled/);
    expect(html).toContain("No active issue");
    // Channel toggle: two aria-pressed segments, email field visible, phone field hidden, and
    // the enhancement script carries the field-swap hook for both buttons.
    expect(html).toMatch(/id="channel-email-button"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/id="channel-phone-button"[^>]*aria-pressed="false"/);
    expect(html).toContain('<div class="channel-field" id="subscribe-field-email">');
    expect(html).toContain('<div class="channel-field" id="subscribe-field-phone" hidden>');
    expect(html).toContain("chooseChannel");
    expect((html.match(/chooseChannel\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Phone structures: full dial-code select (US statically selected; script re-selects from
    // the browser locale), light sanity validation only on the national number.
    expect(html).toContain('id="subscribe-country"');
    expect(html).toMatch(/data-region="US"[^>]*selected>United States \(\+1\)/);
    expect(html).toContain("United Kingdom (+44)");
    expect(html).toContain("Japan (+81)");
    expect((html.match(/<option /g) ?? []).length).toBeGreaterThan(200);
    expect(html).toMatch(/id="subscribe-phone"[^>]*type="tel"/);
    expect(html).toMatch(/id="subscribe-phone"[^>]*inputmode="tel"/);
    expect(html).toMatch(/id="subscribe-phone"[^>]*pattern=/);
    // Format-as-you-type metadata rides on the options (NANP 3-3-4 for the US; digit caps
    // everywhere), and the script carries the digit filter plus the listbox upgrade whose
    // closed control is the compact "ISO dial" form.
    expect(html).toMatch(/data-region="US"[^>]*data-groups="3-3-4" data-max="10"/);
    expect(html).toMatch(/data-region="DE"[^>]*data-max="11"/);
    expect(html).toContain("formatPhone");
    expect(html).toContain('replace(/\\D/g, "")');
    expect(html).toContain("subscribe-country-button");
    expect(html).toContain('setAttribute("role", "listbox")');
    expect(html).toContain('setAttribute("aria-label", "Country codes")');
    // Home/End jump the listbox; Escape closes ONLY the listbox (stopPropagation keeps the
    // document-level handler from also closing the subscribe panel).
    expect(html).toContain('keyboardEvent.key === "Home"');
    expect(html).toContain("stopPropagation");
    // The no-JS select keeps a readable title for its truncated closed state.
    expect(html).toMatch(/id="subscribe-country"[^>]*title="United States \(\+1\)"/);
    // The submit is the only Soon left in the panel.
    expect(html).toMatch(/class="subscribe-submit"[^>]*disabled[^>]*title="Subscribe — soon"/);
    expect(html).toContain("not yet wired");
  });

  test("degraded: warn band, component note, active event pinned with updates newest first", () => {
    const html = renderStatusPage(
      snapshotFixture({
        overall: "degraded",
        components: [
          { id: "api", name: "Application API", group: "Core", status: "operational" },
          {
            id: "libreoffice",
            name: "Document conversion",
            group: "Engines",
            status: "degraded",
            note: "Large conversions are queuing longer than usual.",
          },
        ],
        events: [
          {
            id: "serviceEvent_1",
            title: "Document conversion is running slowly",
            impact: "minor",
            lifecycle: "identified",
            affectedComponentIds: ["libreoffice"],
            startedAt: "2026-07-03T13:41:00.000Z",
            resolvedAt: null,
            // Stored oldest-first on purpose: the renderer must re-sort newest-first.
            updates: [
              {
                at: "2026-07-03T13:41:00.000Z",
                lifecycle: "investigating",
                body: "Older update body.",
              },
              {
                at: "2026-07-03T14:05:00.000Z",
                lifecycle: "identified",
                body: "Newest update body.",
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Degraded performance on some services");
    expect(html).toContain('class="band warn"');
    expect(html).toContain("Large conversions are queuing longer than usual.");
    expect(html).toContain('class="live warn"');
    expect(html).toContain("Minor impact");
    expect(html).toContain("Identified");
    // The affected id resolves to the component's display name.
    expect(html).toContain("Document conversion");
    expect(html.indexOf("Newest update body.")).toBeLessThan(html.indexOf("Older update body."));
    // With a live incident, the current-issue subscribe scope is enabled and names it.
    expect(html).toMatch(/name="subscribe-scope" value="current" data-event-id="serviceEvent_1"/);
    expect(html).toContain("(one notice when it resolves)");
    expect(html).not.toContain("No active issue");
  });

  test("major outage: danger band transformation and outage status labels", () => {
    const html = renderStatusPage(
      snapshotFixture({
        overall: "major_outage",
        components: [
          { id: "api", name: "Application API", group: "Core", status: "major_outage" },
          {
            id: "control-plane-database",
            name: "Control-plane database",
            group: "Core",
            status: "partial_outage",
          },
        ],
        events: [
          {
            id: "serviceEvent_2",
            title: "The application is unavailable",
            impact: "critical",
            lifecycle: "investigating",
            affectedComponentIds: ["api"],
            startedAt: "2026-07-03T09:12:00.000Z",
            resolvedAt: null,
            updates: [
              {
                at: "2026-07-03T09:12:00.000Z",
                lifecycle: "investigating",
                body: "All application requests are failing.",
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Major outage in effect");
    expect(html).toContain('class="band danger"');
    expect(html).toContain('class="live danger"');
    expect(html).toContain("Critical impact");
    expect(html).toContain(">Major outage<");
    expect(html).toContain(">Partial outage<");
  });

  test("maintenance: informational blue band, maintenance status label", () => {
    const html = renderStatusPage(
      snapshotFixture({
        overall: "maintenance",
        components: [
          { id: "tantivy", name: "Search indexing", group: "Engines", status: "maintenance" },
        ],
        events: [
          {
            id: "serviceEvent_3",
            title: "Scheduled maintenance: search index rebuild",
            impact: "maintenance",
            lifecycle: "monitoring",
            affectedComponentIds: ["tantivy"],
            startedAt: "2026-07-03T03:00:00.000Z",
            resolvedAt: null,
            updates: [
              {
                at: "2026-07-03T03:00:00.000Z",
                lifecycle: "monitoring",
                body: "Search indexing is paused while the index is rebuilt.",
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Scheduled maintenance in progress");
    // Maintenance wears the calm informational blue — never the severity family or the golds.
    expect(html).toContain('class="band info"');
    expect(html).toContain('class="live info"');
    expect(html).toContain(">Maintenance<");
    expect(html).toContain('class="row info-row"');
  });

  test("the next-check target is fixed to generatedAt, never the page load", () => {
    // A fresh page load against the same snapshot must show the same target (no reset): the
    // static text is derived only from generatedAt.
    const firstLoad = renderStatusPage(snapshotFixture(), { now: "2026-07-03T14:22:00.000Z" });
    const laterLoad = renderStatusPage(snapshotFixture(), { now: "2026-07-03T14:27:00.000Z" });
    expect(firstLoad).toContain('data-next-check="2026-07-03T14:30:00.000Z"');
    expect(laterLoad).toContain('data-next-check="2026-07-03T14:30:00.000Z"');
    // Past-due target: say so instead of presenting a stale future.
    const overdue = renderStatusPage(snapshotFixture(), { now: "2026-07-03T15:01:00.000Z" });
    expect(overdue).toContain("Next check due");
    expect(overdue).not.toContain("Next check by");
    // No derived snapshot yet (the parse fallback stamps generatedAt with the request moment):
    // the truthful line is a pending first check, not an invented 10-minute window.
    const pendingNow = "2026-07-03T16:00:00.000Z";
    const pending = renderStatusPage(snapshotFixture({ generatedAt: pendingNow }), {
      now: pendingNow,
    });
    expect(pending).toContain("First check pending");
    // No countdown attribute in the MARKUP (the enhancement script's selector string for it is
    // always present, so match the attribute form).
    expect(pending).not.toContain('data-next-check="');
  });

  test("stale snapshot: the strip appears with the age; absent when fresh", () => {
    const stale = renderStatusPage(snapshotFixture({ stale: true }), {
      now: "2026-07-03T15:01:00.000Z",
    });
    expect(stale).toContain("this snapshot may be stale");
    expect(stale).toContain("41 minutes ago");

    const fresh = renderStatusPage(snapshotFixture({ stale: false }));
    expect(fresh).not.toContain("may be stale");
  });

  test("provider feed unreachable renders neutral, never as an outage", () => {
    const html = renderStatusPage(
      snapshotFixture({
        providers: [
          {
            id: "github",
            name: "GitHub",
            status: "status_unavailable",
            upstreamUrl: "https://www.githubstatus.com/api/v2/summary.json",
            fetchedAt: GENERATED_AT,
            reachable: false,
          },
        ],
      }),
    );
    expect(html).toContain("Status unavailable");
    expect(html).toContain('class="prov neutral-row"');
    expect(html).not.toContain('class="prov danger-row"');
    expect(html).toContain("never sets the verdict above");
    // An unreachable feed is uncertainty about them, not an advisory about us.
    expect(html).not.toContain('class="advisory"');
  });

  test("an upstream provider in trouble raises an advisory and never touches the verdict", () => {
    const html = renderStatusPage(
      snapshotFixture({
        // The verdict stays operational: our own components are all green.
        overall: "operational",
        upstreamAdvisory: {
          worst: "degraded",
          providers: [
            {
              id: "cloudflare",
              name: "Cloudflare",
              status: "degraded",
              upstreamUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
              fetchedAt: GENERATED_AT,
              reachable: true,
            },
          ],
        },
      }),
    );
    // The verdict band is untouched: green, and never the warn hue the provider wears.
    expect(html).toContain("All systems operational");
    expect(html).toContain('class="band ok"');
    expect(html).not.toContain('class="band warn"');
    // The advisory is its own surface, naming whose status it reports and linking there.
    expect(html).toContain('class="advisory"');
    expect(html).toContain("Upstream advisory");
    expect(html).toContain('<a href="https://www.cloudflarestatus.com">Cloudflare</a>');
    // The status is spoken as a phrase, not as a column heading dropped into prose.
    expect(html).toContain("is reporting degraded performance on its own status page");
    expect(html).not.toContain("reporting Degraded");
    expect(html).toContain("not ours");
    // The severity lives only in the dot, never in the card.
    expect(html).toContain('class="dot warn-dot"');
    // The advisory sits above the components it disclaims.
    expect(html.indexOf('class="advisory"')).toBeLessThan(html.indexOf("Core services"));
    expect(html.indexOf('class="band')).toBeLessThan(html.indexOf('class="advisory"'));
  });

  test("two troubled providers read as a plural advisory carrying the worst severity", () => {
    const html = renderStatusPage(
      snapshotFixture({
        upstreamAdvisory: {
          worst: "major_outage",
          providers: [
            {
              id: "cloudflare",
              name: "Cloudflare",
              status: "degraded",
              upstreamUrl: "https://www.cloudflarestatus.com/api/v2/summary.json",
              fetchedAt: GENERATED_AT,
              reachable: true,
            },
            {
              id: "github",
              name: "GitHub",
              status: "major_outage",
              upstreamUrl: "https://www.githubstatus.com/api/v2/summary.json",
              fetchedAt: GENERATED_AT,
              reachable: true,
            },
          ],
        },
      }),
    );
    expect(html).toContain(
      'is reporting degraded performance and <a href="https://www.githubstatus.com">GitHub</a> is reporting a major outage on their own status pages',
    );
    expect(html).toContain("This is their status, not ours");
    expect(html).toContain('class="dot danger-dot"');
    expect(html).toContain("All systems operational");
  });

  describe("uptime bars", () => {
    test("a full operational window renders 90 ticks and a 100% figure", () => {
      const html = renderStatusPage(snapshotFixture(), { now: GENERATED_AT });
      expect((html.match(/class="tick t-ok"/g) ?? []).length).toBe(HISTORY_WINDOW_DAYS * 4);
      expect(html).toContain("100% uptime");
      expect(html).toContain('aria-label="Application API: 100% uptime over the last 90 days"');
      expect(html).toContain(">90 days ago</span>");
      expect(html).toContain(">Today</span>");
      // Ticks carry their date and status for hover, and are hidden from the bar's one label.
      expect(html).toContain('title="3 July 2026 — Operational" aria-hidden="true"');
      expect(html).toContain('role="img"');
    });

    test("a day with no samples is a no-data tick, never a green one", () => {
      const ticks: (ComponentStatus | null)[] = Array(HISTORY_WINDOW_DAYS).fill(null);
      const html = renderStatusPage(
        snapshotFixture({
          components: [
            { id: "api", name: "Application API", group: "Core", status: "operational" },
          ],
          history: {
            windowDays: HISTORY_WINDOW_DAYS,
            components: { api: componentHistory(ticks, null) },
          },
        }),
      );
      expect((html.match(/class="tick t-nodata"/g) ?? []).length).toBe(HISTORY_WINDOW_DAYS);
      expect(html).not.toContain('class="tick t-ok"');
      // No data must never present as a perfect record.
      expect(html).not.toContain("100% uptime");
      expect(html).toContain(">No data</span>");
      expect(html).toContain(
        'aria-label="Application API: no uptime data yet over the last 90 days"',
      );
    });

    test("an imperfect record never rounds up to 100%", () => {
      const ticks: (ComponentStatus | null)[] = Array(HISTORY_WINDOW_DAYS).fill("operational");
      ticks[10] = "major_outage";
      const html = renderStatusPage(
        snapshotFixture({
          components: [
            { id: "api", name: "Application API", group: "Core", status: "operational" },
          ],
          history: {
            windowDays: HISTORY_WINDOW_DAYS,
            // One bad sample in 100000: honest rounding must not erase it.
            components: { api: componentHistory(ticks, 0.999999) },
          },
        }),
      );
      expect(html).toContain("99.99% uptime");
      expect(html).not.toContain("100% uptime");
      expect(html).toContain('class="tick t-danger"');
    });

    test("a maintenance day colors its tick in the calm blue", () => {
      const ticks: (ComponentStatus | null)[] = Array(HISTORY_WINDOW_DAYS).fill("operational");
      ticks[HISTORY_WINDOW_DAYS - 1] = "maintenance";
      const html = renderStatusPage(
        snapshotFixture({
          components: [
            { id: "api", name: "Application API", group: "Core", status: "operational" },
          ],
          // Maintenance is excluded from the ratio, so a perfect record stands beside a blue tick.
          history: {
            windowDays: HISTORY_WINDOW_DAYS,
            components: { api: componentHistory(ticks, 1) },
          },
        }),
      );
      expect(html).toContain('class="tick t-info"');
      expect(html).toContain("100% uptime");
    });
  });

  test("resolved events render as history, with maintenance closed as Completed", () => {
    const html = renderStatusPage(
      snapshotFixture({
        events: [
          {
            id: "serviceEvent_4",
            title: "Document editing sessions were slow to open",
            impact: "minor",
            lifecycle: "resolved",
            affectedComponentIds: ["collabora"],
            startedAt: "2026-06-28T15:07:00.000Z",
            resolvedAt: "2026-06-28T16:42:00.000Z",
            updates: [
              { at: "2026-06-28T16:42:00.000Z", lifecycle: "resolved", body: "Back to normal." },
              {
                at: "2026-06-28T15:07:00.000Z",
                lifecycle: "investigating",
                body: "Looking into it.",
              },
            ],
          },
          {
            id: "serviceEvent_5",
            title: "Scheduled maintenance: malware-scanning rule refresh",
            impact: "maintenance",
            lifecycle: "resolved",
            affectedComponentIds: [],
            startedAt: "2026-06-14T03:00:00.000Z",
            resolvedAt: "2026-06-14T03:24:00.000Z",
            updates: [
              { at: "2026-06-14T03:24:00.000Z", lifecycle: "resolved", body: "Completed early." },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Past service events");
    expect(html).toContain("Last 90 days");
    expect(html).toContain("28 June 2026");
    expect(html).toContain(">Resolved<");
    expect(html).toContain(">Completed<");
    // Two event days in the window; the quiet remainder is accounted for in one line.
    expect(html).toContain("No incidents reported on the other 88 days.");
    // Resolved events are history, not live incidents.
    expect(html).not.toContain('class="live');
    // Resolved events do not enable the current-issue subscribe scope.
    expect(html).toMatch(/name="subscribe-scope" value="current" disabled/);
    // Newest history entry first.
    expect(html.indexOf("Document editing sessions were slow to open")).toBeLessThan(
      html.indexOf("Scheduled maintenance: malware-scanning rule refresh"),
    );
  });

  test("the archive covers the same window as the bars: older events fall out of it", () => {
    const html = renderStatusPage(
      snapshotFixture({
        events: [
          {
            id: "serviceEvent_8",
            title: "An event from before the window",
            impact: "minor",
            lifecycle: "resolved",
            affectedComponentIds: [],
            startedAt: "2026-01-02T10:00:00.000Z",
            resolvedAt: "2026-01-02T11:00:00.000Z",
            updates: [{ at: "2026-01-02T11:00:00.000Z", lifecycle: "resolved", body: "Done." }],
          },
        ],
      }),
    );
    expect(html).not.toContain("An event from before the window");
    expect(html).toContain("No service events recorded in the last 90 days.");
  });

  test("operator-authored text is HTML-escaped everywhere it renders", () => {
    const hostile = `<script>alert(1)</script>`;
    const html = renderStatusPage(
      snapshotFixture({
        components: [
          { id: "api", name: hostile, group: "Core", status: "degraded", note: hostile },
        ],
        providers: [
          {
            id: "hostile-provider",
            name: hostile,
            status: "operational",
            // Not a parseable URL, so the provider renders unlinked — and still escaped.
            upstreamUrl: "not a url",
            fetchedAt: GENERATED_AT,
            reachable: true,
          },
        ],
        events: [
          {
            id: "serviceEvent_6",
            title: hostile,
            impact: "minor",
            lifecycle: "investigating",
            affectedComponentIds: ["not-a-component-<b>"],
            startedAt: GENERATED_AT,
            resolvedAt: null,
            updates: [
              { at: GENERATED_AT, lifecycle: "investigating", body: hostile },
              // An unparseable timestamp falls back to rendering the raw string — escaped.
              { at: "<b>not-a-date</b>", lifecycle: "investigating", body: "Fallback date." },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // An unknown affected id stays visible (escaped) instead of silently vanishing.
    expect(html).toContain("not-a-component-&lt;b&gt;");
    // The date-fallback path escapes too.
    expect(html).not.toContain("<b>not-a-date</b>");
    expect(html).toContain("&lt;b&gt;not-a-date&lt;/b&gt;");
  });
});

describe("formatNationalNumber (the exact function injected into the page script)", () => {
  test("every country formats: national shapes where known, generic fallback otherwise", () => {
    // Table-known national groupings.
    expect(formatNationalNumber("US", "2025550123")).toBe("202 555 0123");
    expect(formatNationalNumber("FR", "0612345678")).toBe("06 12 34 56 78");
    expect(formatNationalNumber("AU", "412345678")).toBe("412 345 678");
    expect(formatNationalNumber("JP", "09012345678")).toBe("090 1234 5678");
    expect(formatNationalNumber("IN", "9876543210")).toBe("98765 43210");
    expect(formatNationalNumber("MX", "5512345678")).toBe("55 1234 5678");
    expect(formatNationalNumber("BR", "11987654321")).toBe("11 98765 4321");
    // Irregular-plan countries get the generic readability fallback (threes with a two-to-four
    // final group), never an unbroken wall.
    expect(formatNationalNumber("GB", "2079460958")).toBe("207 946 0958");
    expect(formatNationalNumber("DE", "15123456789")).toBe("151 234 567 89");
    // A country outside the shape table entirely still formats via the fallback.
    expect(formatNationalNumber("IS", "5551234")).toBe("555 1234");
    // Digit cap and non-digit stripping.
    expect(formatNationalNumber("US", "202-555-0123-9999")).toBe("202 555 0123");
    expect(formatNationalNumber("US", "")).toBe("");
  });

  test("placeholders come from the same formatter, so example and typing cannot disagree", () => {
    const byRegion = new Map(COUNTRY_DIAL_CODES.map((country) => [country.region, country]));
    const unitedStates = byRegion.get("US");
    const france = byRegion.get("FR");
    const germany = byRegion.get("DE");
    if (!unitedStates || !france || !germany) throw new Error("registry entry missing");
    // NANP keeps the classic fictional 555 pattern; others are sequential shape-length runs.
    expect(examplePlaceholderFor(unitedStates)).toBe("555 010 0123");
    expect(examplePlaceholderFor(france)).toBe("12 34 56 78 90");
    expect(examplePlaceholderFor(germany)).toBe("123 456 789 01");
    // Every country produces a grouped, non-empty example.
    for (const country of COUNTRY_DIAL_CODES) {
      const placeholder = examplePlaceholderFor(country);
      expect(placeholder.length).toBeGreaterThan(0);
      expect(placeholder).toContain(" ");
    }
  });
});

describe("stylesheet (served as its own asset)", () => {
  test("carries the scheme system, motion rules, ladder, and the true reading face", () => {
    // The real Atkinson Hyperlegible Next, self-served, with the system stack behind it.
    expect(PAGE_CSS).toContain('font-family: "Atkinson Hyperlegible Next"');
    expect(PAGE_CSS).toContain(`src: url("${FONT_ASSET_PATH}")`);
    expect(PAGE_CSS).toContain("font-display: swap");
    expect(PAGE_CSS).toContain('"Atkinson Hyperlegible Next", system-ui');
    // CSS-first dark scheme; the data-scheme stamp wins in both directions.
    expect(PAGE_CSS).toContain("prefers-color-scheme: dark");
    expect(PAGE_CSS).toContain('[data-scheme="dark"]');
    // Text-size ladder steps.
    expect(PAGE_CSS).toContain('[data-text="large"]');
    expect(PAGE_CSS).toContain('[data-text="larger"]');
    // Rounded band, no gold hairline, halo breath with static dot, reduced-motion suppression.
    expect(PAGE_CSS).toContain("border-radius: 8px");
    expect(PAGE_CSS).not.toContain(".band::after");
    expect(PAGE_CSS).toContain("halo-breathe");
    expect(PAGE_CSS).not.toContain("lamp-breathe");
    expect(PAGE_CSS).toContain("prefers-reduced-motion: reduce");
    // Hover-Soon reveal for dead affordances; the no-data gray shared by legend and rows.
    expect(PAGE_CSS).toContain('content: "Soon"');
    expect(PAGE_CSS).toContain("--nodata-fg");
    expect(PAGE_CSS).toContain(".neutral-row .dot { background: var(--nodata-fg); }");
    // The content-hashed path derives from this exact stylesheet.
    expect(STYLES_ASSET_PATH).toMatch(/^\/assets\/styles\.[0-9a-f]{8}\.css$/);
  });
});

describe("GET / (served page)", () => {
  beforeEach(async () => {
    await env.STATUS_KV.delete(STATUS_KV_KEYS.derived);
    await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
    await env.STATUS_KV.delete(STATUS_KV_KEYS.history);
  });

  test("serves the rendered page from the merged snapshot with no operator identity", async () => {
    const now = "2026-07-02T00:00:00.000Z";
    await env.STATUS_KV.put(
      STATUS_KV_KEYS.derived,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: now,
        components: [
          {
            id: "api",
            name: "Application API",
            group: "Core",
            status: "operational",
            source: "probe",
            lastChange: now,
          },
        ],
        providers: [],
      }),
    );
    await env.STATUS_KV.put(
      STATUS_KV_KEYS.authored,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: now,
        events: [
          {
            id: "serviceEvent_7",
            title: "A live event title",
            impact: "minor",
            lifecycle: "investigating",
            affectedComponentIds: ["api"],
            authorUserId: "usr_secret",
            startedAt: now,
            resolvedAt: null,
            updates: [
              {
                at: now,
                lifecycle: "investigating",
                body: "An update body.",
                authorUserId: "usr_secret",
              },
            ],
          },
        ],
        overrides: [],
      }),
    );
    const response = await SELF.fetch("https://status.example.com/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("A live event title");
    expect(html).toContain("Application API");
    // A seeded (old) snapshot renders the overdue wording, never an invented future window.
    expect(html).toContain("Next check due");
    // The public page must never carry an operator identity.
    expect(html).not.toContain("usr_secret");
  });

  test("an empty store still serves a readable operational page (no 500)", async () => {
    const response = await SELF.fetch("https://status.example.com/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("All systems operational");
    expect(html).toContain("No component data has been published yet.");
    // No derived snapshot yet: a pending first check, not a fresh window anchored to page load.
    expect(html).toContain("First check pending");
  });

  test("serves the stylesheet and font as immutable same-origin assets", async () => {
    const stylesResponse = await SELF.fetch(`https://status.example.com${STYLES_ASSET_PATH}`);
    expect(stylesResponse.status).toBe(200);
    expect(stylesResponse.headers.get("content-type")).toContain("text/css");
    expect(stylesResponse.headers.get("cache-control")).toContain("immutable");
    expect(await stylesResponse.text()).toBe(PAGE_CSS);

    const fontResponse = await SELF.fetch(`https://status.example.com${FONT_ASSET_PATH}`);
    expect(fontResponse.status).toBe(200);
    expect(fontResponse.headers.get("content-type")).toBe("font/woff2");
    expect(fontResponse.headers.get("cache-control")).toContain("immutable");
    // The bundled latin variable file (weights 200-800) as copied from the app's font package.
    expect((await fontResponse.arrayBuffer()).byteLength).toBe(33996);
  });
});
