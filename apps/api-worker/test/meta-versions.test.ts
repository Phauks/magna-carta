/*
 * The aggregate version read's resolution rules: every rostered service binding lands in exactly
 * one honest state — reported (its own answer), unbound (no binding here), unreachable (bound but
 * failing or timing out), or unreported (answering, but with no version route) — and the brief
 * per-isolate cache returns the same observation, with its original observedAt, instead of
 * re-probing on every call.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectServiceVersions,
  readServiceVersionsThroughCache,
  resetServiceVersionsCache,
  SERVICE_VERSION_ROSTER,
  type ServiceVersionBindings,
} from "../src/routes/platform/meta-versions.ts";

const REPORTED_IDENTITY = {
  commit: "abc1234",
  commitTime: "2026-08-29T10:00:00Z",
  buildTime: "2026-08-29T10:05:00Z",
};

function answeringFetcher(body: unknown, status = 200): Fetcher {
  return {
    fetch: () => Promise.resolve(Response.json(body, { status })),
  } as unknown as Fetcher;
}

function throwingFetcher(): Fetcher {
  return {
    fetch: () => Promise.reject(new Error("connection refused")),
  } as unknown as Fetcher;
}

// Honors the abort signal and otherwise never answers — how a hung worker looks to the probe.
function hangingFetcher(): Fetcher {
  return {
    fetch: (_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  } as unknown as Fetcher;
}

function reportFor(services: Awaited<ReturnType<typeof collectServiceVersions>>, id: string) {
  const report = services.find((service) => service.id === id);
  if (report === undefined) throw new Error(`no report for service ${id}`);
  return report;
}

beforeEach(() => {
  resetServiceVersionsCache();
});

describe("collectServiceVersions", () => {
  it("reports every rostered service exactly once, in roster order", async () => {
    const services = await collectServiceVersions({});
    expect(services.map((service) => service.id)).toEqual(
      SERVICE_VERSION_ROSTER.map((entry) => entry.id),
    );
  });

  it("an absent binding is unbound, never probed and never invented", async () => {
    const services = await collectServiceVersions({});
    for (const service of services) {
      expect(service.state).toBe("unbound");
      expect(service.commit).toBeNull();
      // Never asked, so there is nothing to time. A zero would read as an instant answer, which is
      // the opposite of what "not wired here" means.
      expect(service.latencyMilliseconds).toBeNull();
    }
  });

  it("times what the probe cost, so a worker close to the timeout is visible before it flips", async () => {
    // The number was being paid for and thrown away: every probe is raced against a fixed timeout,
    // so "reported" and "unreachable" are two ends of one measurement with nothing in between.
    const services = await collectServiceVersions({
      SCAN_SERVICE: answeringFetcher(REPORTED_IDENTITY),
    } as ServiceVersionBindings);
    const scan = reportFor(services, "scan");
    expect(scan.state).toBe("reported");
    expect(scan.latencyMilliseconds).not.toBeNull();
    expect(scan.latencyMilliseconds ?? -1).toBeGreaterThanOrEqual(0);
  });

  it("times a probe that failed too — a timeout is the slowest answer there is", async () => {
    const services = await collectServiceVersions(
      { SCAN_SERVICE: hangingFetcher() } as ServiceVersionBindings,
      20,
    );
    const scan = reportFor(services, "scan");
    expect(scan.state).toBe("unreachable");
    // Stated rather than null: it distinguishes a worker that ran out of time from one that
    // refused immediately, and both arrive here as "unreachable".
    expect(scan.latencyMilliseconds).not.toBeNull();
  });

  it("a bound service answering the version route is reported with its own identity", async () => {
    const services = await collectServiceVersions({
      SCAN_SERVICE: answeringFetcher(REPORTED_IDENTITY),
    });
    expect(reportFor(services, "scan")).toMatchObject({
      state: "reported",
      service: "magna-carta-scan",
      ...REPORTED_IDENTITY,
    });
  });

  it("every row names the Cloudflare Worker it reports on, never an invented product name", async () => {
    const services = await collectServiceVersions({});
    for (const service of services) {
      expect(service.service).toMatch(/^magna-carta-/);
    }
  });

  it("a 200 whose body is not JSON is unreported — the assets-only worker's index.html fallback", async () => {
    const htmlFetcher = {
      fetch: () =>
        Promise.resolve(
          new Response("<!doctype html><html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        ),
    } as unknown as Fetcher;
    const services = await collectServiceVersions({ WEB_SERVICE: htmlFetcher });
    expect(reportFor(services, "web").state).toBe("unreported");
  });

  it("a bound service without the version route (404) is unreported", async () => {
    const services = await collectServiceVersions({
      OCR_SERVICE: answeringFetcher("Not Found", 404),
    });
    expect(reportFor(services, "ocr").state).toBe("unreported");
  });

  it("an answer in the wrong shape is unreported, never a garbled version", async () => {
    const services = await collectServiceVersions({
      SIGN_SERVICE: answeringFetcher({ version: "1.2.3" }),
    });
    expect(reportFor(services, "sign").state).toBe("unreported");
  });

  it("a bound service failing with a server error is unreachable", async () => {
    const services = await collectServiceVersions({
      CONVERT: answeringFetcher({ error: "boom" }, 503),
    });
    expect(reportFor(services, "convert").state).toBe("unreachable");
  });

  it("a bound service whose transport throws is unreachable", async () => {
    const services = await collectServiceVersions({
      DISCOVERY_SERVICE: throwingFetcher(),
    });
    expect(reportFor(services, "discovery").state).toBe("unreachable");
  });

  it("a hung service is cut off by the probe timeout and read as unreachable", async () => {
    const services = await collectServiceVersions(
      { SEARCH_SERVICE: hangingFetcher() },
      25, // a short timeout so the test does not wait out the real one
    );
    expect(reportFor(services, "search").state).toBe("unreachable");
  });

  it("one dead worker does not take down the others' answers", async () => {
    const services = await collectServiceVersions({
      SCAN_SERVICE: answeringFetcher(REPORTED_IDENTITY),
      BUNDLE_SERVICE: throwingFetcher(),
    });
    expect(reportFor(services, "scan").state).toBe("reported");
    expect(reportFor(services, "bundle").state).toBe("unreachable");
    expect(reportFor(services, "recovery").state).toBe("unbound");
  });
});

describe("the brief aggregate cache", () => {
  it("a second read within the window reuses the observation and its observedAt", async () => {
    let probeCount = 0;
    const env: ServiceVersionBindings = {
      SCAN_SERVICE: {
        fetch: () => {
          probeCount += 1;
          return Promise.resolve(Response.json(REPORTED_IDENTITY));
        },
      } as unknown as Fetcher,
    };
    const first = await readServiceVersionsThroughCache(env);
    const second = await readServiceVersionsThroughCache(env);
    expect(probeCount).toBe(1);
    expect(second.observedAt).toBe(first.observedAt);
    expect(second.services).toEqual(first.services);
  });

  it("a forced read re-probes inside the window and becomes the observation later reads serve", async () => {
    let probeCount = 0;
    const env: ServiceVersionBindings = {
      SCAN_SERVICE: {
        fetch: () => {
          probeCount += 1;
          return Promise.resolve(Response.json(REPORTED_IDENTITY));
        },
      } as unknown as Fetcher,
    };
    await readServiceVersionsThroughCache(env);
    // The panel's explicit Refresh gesture: the member asked what is running NOW, so the cache is
    // skipped — and the probe just paid for replaces it, so a following cached read serves the
    // fresh observation rather than the older one.
    const forced = await readServiceVersionsThroughCache(env, { forceFresh: true });
    expect(probeCount).toBe(2);
    const after = await readServiceVersionsThroughCache(env);
    expect(probeCount).toBe(2);
    expect(after.observedAt).toBe(forced.observedAt);
  });
});
