import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { STATUS_KV_KEYS, type PublishedSnapshot } from "@magna-carta/status";
import { renderStatusPage } from "../src/render-status-page.ts";

const GENERATED_AT = "2026-07-03T14:20:00.000Z";

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
    events: [],
    stale: false,
    ...overrides,
  };
}

describe("renderStatusPage", () => {
  test("operational steady state: verdict, both groups, providers, footer", () => {
    const html = renderStatusPage(snapshotFixture());
    expect(html).toContain("All systems operational");
    expect(html).toContain('class="band ok"');
    expect(html).toContain("Core services");
    expect(html).toContain("Document &amp; analysis engines");
    expect(html).toContain("Application API");
    expect(html).toContain("Document conversion");
    expect(html).toContain("Checked 3 July 2026, 14:20 UTC");
    // Fate-isolation honesty in the footer, and the exception-based-green explanation. The dead
    // "if this page is unreachable" advice is gone (a reader who cannot reach the page cannot
    // read it), and the notice is a single naturally-wrapping paragraph.
    expect(html).toContain("kept separate from the application");
    expect(html).toContain("services report by exception");
    expect(html).not.toContain("If this page is unreachable");
    // The Cloudflare provider row keeps its link-out (reachable exactly when it matters).
    expect(html).toContain('<a href="https://www.cloudflarestatus.com">Cloudflare</a>');
    // Complete with zero JavaScript: static countdown text plus the meta refresh; the inline
    // scripts only enhance (live countdown, scheme toggle).
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
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
    expect(html).toContain('content: "Soon"');
    // The bell opens the subscribe panel: real anatomy and aria wiring, honest inert submit —
    // nothing fakes a subscription until the notifications machinery ships.
    expect(html).toContain('class="icon-bell"');
    expect(html).toContain('id="subscribe-bell"');
    expect(html).toMatch(/id="subscribe-bell"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/<div id="subscribe-panel"[^>]*role="dialog"[^>]*hidden/);
    expect(html).toContain('aria-labelledby="subscribe-title"');
    expect(html).toContain("Subscribe to updates");
    expect(html).toContain('id="subscribe-email"');
    expect(html).toMatch(/class="subscribe-submit"[^>]*disabled[^>]*title="Subscribe — soon"/);
    expect(html).toContain("not yet wired");
    // Text-size button: a hidden enhancement cycling a rem-based root ladder (the no-JS
    // baseline is browser zoom; the persisted step is applied pre-paint by the boot script).
    expect(html).toContain('id="text-size"');
    expect(html).toMatch(/id="text-size"[^>]*hidden/);
    expect(html).toContain('[data-text="large"]');
    expect(html).toContain('[data-text="larger"]');
    expect(html).toContain("mc-status-text");
    const bandIndex = html.indexOf('class="band');
    expect(html.indexOf("Help Desk")).toBeLessThan(bandIndex);
    expect(html.indexOf('class="icon-bell"')).toBeLessThan(bandIndex);
    expect(html).not.toContain("foot-links");
    // The band is a rounded block with no gold hairline beneath it, and its lamp breathes —
    // a calm, constant-period, compositor-only pulse, suppressed under reduced motion.
    expect(html).toContain("border-radius: 8px");
    expect(html).not.toContain(".band::after");
    expect(html).toContain("lamp-breathe");
    expect(html).toContain("prefers-reduced-motion: reduce");
    // The page's single color key sits on the first component section rule.
    expect(html).toContain('aria-label="Color key"');
    expect((html.match(/aria-label="Color key"/g) ?? []).length).toBe(1);
    // Scheme support: CSS-first dark scheme plus the hidden icon toggle the script reveals
    // (sun and moon both present; CSS shows the right one per scheme).
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('[data-scheme="dark"]');
    expect(html).toContain('id="scheme-toggle"');
    expect(html).toMatch(/id="scheme-toggle"[^>]*hidden/);
    expect(html).toContain('class="icon-sun"');
    expect(html).toContain('class="icon-moon"');
    // No live-event card and an explicitly empty history in the steady state.
    expect(html).not.toContain('class="live');
    expect(html).toContain("No past service events recorded.");
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
    expect(html).toContain("never counts against this platform");
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
    expect(html).toContain("28 June 2026");
    expect(html).toContain(">Resolved<");
    expect(html).toContain(">Completed<");
    // Resolved events are history, not live incidents.
    expect(html).not.toContain('class="live');
    // Newest history entry first.
    expect(html.indexOf("Document editing sessions were slow to open")).toBeLessThan(
      html.indexOf("Scheduled maintenance: malware-scanning rule refresh"),
    );
  });

  test("operator-authored text is HTML-escaped everywhere it renders", () => {
    const hostile = `<script>alert(1)</script>`;
    const html = renderStatusPage(
      snapshotFixture({
        components: [
          { id: "api", name: hostile, group: "Core", status: "degraded", note: hostile },
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
            updates: [{ at: GENERATED_AT, lifecycle: "investigating", body: hostile }],
          },
        ],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // An unknown affected id stays visible (escaped) instead of silently vanishing.
    expect(html).toContain("not-a-component-&lt;b&gt;");
  });
});

describe("GET / (served page)", () => {
  beforeEach(async () => {
    await env.STATUS_KV.delete(STATUS_KV_KEYS.derived);
    await env.STATUS_KV.delete(STATUS_KV_KEYS.authored);
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
    // The public page must never carry an operator identity.
    expect(html).not.toContain("usr_secret");
  });

  test("an empty store still serves a readable operational page (no 500)", async () => {
    const response = await SELF.fetch("https://status.example.com/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("All systems operational");
    expect(html).toContain("No component data has been published yet.");
  });
});
