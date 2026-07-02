// CSP spike driver (bits-ui issue #1995) — run via `pnpm --filter @magna-carta/design-system run csp-spike`
// (the package script builds the probe app first, then runs this file).
//
// What it does:
//   1. Serves the statically built probe app (test/csp-spike/dist) from a tiny node:http server
//      that adds the strict header on every response:
//        Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'report-sample'
//      ('report-sample' adds the violating snippet to violation events; it allows nothing.)
//      A static build is used deliberately: Vite's dev server injects CSS via <style> elements and
//      needs 'unsafe-eval', both of which would confound the probe. This header is production-shaped.
//   2. Drives headless Chromium (and Firefox, if its Playwright build is installed) through the
//      Dialog, Popover and Tooltip probes, collecting securitypolicyviolation events and
//      per-mechanism style-write counts (both registered in main.ts before mount, so violations
//      and writes during component mount are attributed), and measures whether each behavior
//      still functions.
//   3. Prints a findings JSON block per browser, then asserts the documented verdict (VERDICT.md).
//      The assertions encode the OBSERVED upstream behavior — if a future bits-ui or Svelte
//      upgrade changes the CSP story, a re-run fails loudly and VERDICT.md must be re-evaluated.
//
// Deliberately NOT a vitest test: it needs its own server + headers and must never run in
// `vp test` or CI. Re-run on bits-ui/svelte upgrades via tools/run-csp-spike.cmd.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";

const spikeDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.join(spikeDirectory, "dist");

const contentSecurityPolicyHeader =
  "default-src 'self'; script-src 'self'; style-src 'self' 'report-sample'";

const contentTypeByExtension = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function startStrictServer() {
  const server = http.createServer(async (request, response) => {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const filePath = path.resolve(distDirectory, relativePath);
    // Constraint: never serve outside dist (trivial traversal guard for a local-only probe).
    if (!filePath.startsWith(distDirectory) || !existsSync(filePath)) {
      response.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeByExtension[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Security-Policy": contentSecurityPolicyHeader,
    });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

/** Violations + per-mechanism style-write counts collected in-page by main.ts (the ground truth). */
function readProbeState(page) {
  return page.evaluate(() => ({
    violations: window.__contentSecurityPolicyViolations,
    styleWriteCounts: { ...window.__styleWriteCounts },
  }));
}

/** Captures style mechanism + geometry for a floating part and the wrapper bits-ui positions. */
function measureFloatingPart(page, contentSelector, triggerSelector) {
  return page.evaluate(
    ({ contentSelector, triggerSelector }) => {
      const measureElement = (element) =>
        element
          ? {
              styleAttribute: element.getAttribute("style"),
              computedTransform: getComputedStyle(element).transform,
              computedPosition: getComputedStyle(element).position,
              rect: element.getBoundingClientRect().toJSON(),
            }
          : null;
      const contentElement = document.querySelector(contentSelector);
      return {
        content: measureElement(contentElement),
        // bits-ui positions a wrapper div around the content (the floating layer).
        wrapper: measureElement(contentElement?.parentElement ?? null),
        trigger: measureElement(document.querySelector(triggerSelector)),
      };
    },
    { contentSelector, triggerSelector },
  );
}

async function runProbe(browserType, browserName) {
  const { server, baseUrl } = await startStrictServer();
  const browser = await browserType.launch();
  const page = await browser.newPage();

  const consoleMessages = [];
  page.on("console", (message) =>
    consoleMessages.push({ type: message.type(), text: message.text() }),
  );
  page.on("pageerror", (error) => consoleMessages.push({ type: "pageerror", text: String(error) }));

  const findings = { browser: browserName };

  try {
    await page.goto(baseUrl);
    await page.waitForSelector("[data-testid=dialog-trigger]");
    const baselineState = await readProbeState(page);
    findings.baseline = {
      violationsOnMount: baselineState.violations,
      styleWriteCounts: baselineState.styleWriteCounts,
      bodyBackgroundMarkerApplied: await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor === "rgb(1, 2, 3)",
      ),
    };

    // ---- Popover: Floating UI positioning under strict style-src --------------------------
    let stateBefore = await readProbeState(page);
    await page.click("[data-testid=popover-trigger]");
    await page.waitForSelector("[data-popover-content]", { state: "visible" });
    await page.waitForTimeout(250); // let Floating UI settle (position is applied post-measure)
    let stateAfter = await readProbeState(page);
    findings.popover = {
      opened: true,
      measurement: await measureFloatingPart(
        page,
        "[data-popover-content]",
        "[data-testid=popover-trigger]",
      ),
      newViolations: stateAfter.violations.slice(stateBefore.violations.length),
      styleWriteCountsDelta: diffStyleWriteCounts(
        stateBefore.styleWriteCounts,
        stateAfter.styleWriteCounts,
      ),
    };
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-popover-content]", { state: "detached" });

    // ---- Tooltip: same question, second floating part -------------------------------------
    stateBefore = await readProbeState(page);
    await page.hover("[data-testid=tooltip-trigger]");
    await page.waitForSelector("[data-tooltip-content]", { state: "visible" });
    await page.waitForTimeout(250);
    stateAfter = await readProbeState(page);
    findings.tooltip = {
      opened: true,
      measurement: await measureFloatingPart(
        page,
        "[data-tooltip-content]",
        "[data-testid=tooltip-trigger]",
      ),
      newViolations: stateAfter.violations.slice(stateBefore.violations.length),
      styleWriteCountsDelta: diffStyleWriteCounts(
        stateBefore.styleWriteCounts,
        stateAfter.styleWriteCounts,
      ),
    };
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-tooltip-content]", { state: "detached" });
    await page.mouse.move(0, 0); // park the pointer so the tooltip cannot re-open

    // ---- Dialog: scroll lock (apply path), focus trap, then the restore path on close -----
    stateBefore = await readProbeState(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click("[data-testid=dialog-trigger]");
    await page.waitForSelector("[data-dialog-content]", { state: "visible" });
    await page.waitForTimeout(250); // scroll-lock applies pointer-events after a tick

    const bodyStateWhileOpen = await page.evaluate(() => ({
      computedOverflow: getComputedStyle(document.body).overflow,
      computedPointerEvents: getComputedStyle(document.body).pointerEvents,
      styleAttribute: document.body.getAttribute("style"),
    }));

    // Focus trap: Tab repeatedly; focus must stay inside the dialog content.
    const focusStaysInside = [];
    for (let tabPress = 0; tabPress < 4; tabPress += 1) {
      await page.keyboard.press("Tab");
      focusStaysInside.push(
        await page.evaluate(
          () => document.activeElement?.closest("[data-dialog-content]") !== null,
        ),
      );
    }

    // Scroll lock, empirically: wheel against the locked body.
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const scrollPositionWhileOpen = await page.evaluate(() => window.scrollY);

    stateAfter = await readProbeState(page);
    findings.dialogOpen = {
      bodyStateWhileOpen,
      newViolationsOnOpen: stateAfter.violations.slice(stateBefore.violations.length),
      styleWriteCountsDelta: diffStyleWriteCounts(
        stateBefore.styleWriteCounts,
        stateAfter.styleWriteCounts,
      ),
      focusStaysInside,
      scrollPositionAfterWheelWhileOpen: scrollPositionWhileOpen,
    };

    // Close: bits-ui resetBodyStyle restores the body style. With the Magna Carta patch
    // (patches/bits-ui@2.18.1.patch) this goes through document.body.style.cssText (CSSOM) —
    // the CSP-clean channel — instead of setAttribute("style", ...), which strict style-src
    // blocks. The cleanup runs ~24ms after close; wait it out.
    stateBefore = stateAfter;
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-dialog-content]", { state: "detached" });
    await page.waitForTimeout(400);

    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);

    stateAfter = await readProbeState(page);
    findings.dialogClose = {
      newViolationsOnClose: stateAfter.violations.slice(stateBefore.violations.length),
      styleWriteCountsDelta: diffStyleWriteCounts(
        stateBefore.styleWriteCounts,
        stateAfter.styleWriteCounts,
      ),
      bodyStateAfterClose: await page.evaluate(() => ({
        computedOverflow: getComputedStyle(document.body).overflow,
        computedPointerEvents: getComputedStyle(document.body).pointerEvents,
        styleAttribute: document.body.getAttribute("style"),
        // The CSSOM-set marker from main.ts: does it survive the blocked setAttribute restore?
        backgroundMarkerStillApplied:
          getComputedStyle(document.body).backgroundColor === "rgb(1, 2, 3)",
      })),
      scrollPositionAfterWheelAfterClose: await page.evaluate(() => window.scrollY),
    };

    findings.consoleMessages = consoleMessages;
  } finally {
    await browser.close();
    server.close();
  }
  return findings;
}

function diffStyleWriteCounts(before, after) {
  return {
    setAttributeStyle: after.setAttributeStyle - before.setAttributeStyle,
    cssTextAssignment: after.cssTextAssignment - before.cssTextAssignment,
    setPropertyCalls: after.setPropertyCalls - before.setPropertyCalls,
  };
}

// ---- Assertions: the documented verdict (VERDICT.md). A failure means upstream behavior
// ---- changed (e.g. a bits-ui fix for #1995, or a Svelte set_style change) — re-run the
// ---- analysis and update VERDICT.md before building further on the old verdict.
function assertVerdict(findings, failures) {
  const browserPrefix = `[${findings.browser}]`;
  function expectFinding(name, condition) {
    if (!condition) failures.push(`${browserPrefix} ${name}`);
  }

  expectFinding("no violations at mount", findings.baseline.violationsOnMount.length === 0);
  expectFinding(
    "floating positioning (Popover) produces NO violation — Svelte writes it via style.cssText (CSSOM), not setAttribute",
    findings.popover.newViolations.length === 0 &&
      findings.popover.styleWriteCountsDelta.cssTextAssignment > 0 &&
      findings.popover.styleWriteCountsDelta.setAttributeStyle === 0,
  );
  expectFinding(
    "popover IS positioned at its trigger (Floating UI transform applied under strict CSP)",
    findings.popover.measurement.wrapper?.computedTransform !== "none" &&
      findings.popover.measurement.wrapper?.computedPosition === "absolute",
  );
  expectFinding(
    "floating positioning (Tooltip) produces NO violation and is applied",
    findings.tooltip.newViolations.length === 0 &&
      findings.tooltip.measurement.wrapper?.computedTransform !== "none",
  );
  expectFinding(
    "scroll-lock APPLY path is pure CSSOM and survives strict CSP (overflow hidden, no violation)",
    findings.dialogOpen.bodyStateWhileOpen.computedOverflow === "hidden" &&
      findings.dialogOpen.newViolationsOnOpen.length === 0,
  );
  expectFinding(
    "scroll is actually locked while the dialog is open",
    findings.dialogOpen.scrollPositionAfterWheelWhileOpen === 0,
  );
  expectFinding(
    "focus stays trapped inside the dialog",
    findings.dialogOpen.focusStaysInside.every(Boolean),
  );
  // PATCHED verdict (patches/bits-ui@2.18.1.patch applied — see VERDICT.md "Post-patch re-run").
  // The restore path now writes through document.body.style.cssText (CSSOM), so it is CSP-clean
  // in every engine: no style-src violation on close, and the body genuinely recovers.
  expectFinding(
    "scroll-lock RESTORE path is CSP-clean (patched): NO style-src violation on close, restored via style.cssText not setAttribute",
    findings.dialogClose.newViolationsOnClose.every(
      (violation) => !violation.effectiveDirective.startsWith("style-src"),
    ) &&
      findings.dialogClose.styleWriteCountsDelta.setAttributeStyle === 0 &&
      findings.dialogClose.styleWriteCountsDelta.cssTextAssignment > 0,
  );
  // The AFTERMATH is now uniform across engines (observed post-patch 2026-06-15, see VERDICT.md):
  // the cssText restore replaces the inline declaration block cleanly, so the body recovers
  // (overflow + pointer-events released, scroll works) and pre-existing inline body styles are
  // preserved — in chromium, firefox and webkit alike.
  const bodyRecovered =
    findings.dialogClose.bodyStateAfterClose.computedOverflow !== "hidden" &&
    findings.dialogClose.bodyStateAfterClose.computedPointerEvents !== "none" &&
    findings.dialogClose.scrollPositionAfterWheelAfterClose > 0;
  expectFinding("patched-restore aftermath: body recovers (scrolls again)", bodyRecovered);
  expectFinding(
    "patched-restore aftermath: pre-existing inline body style survives the restore",
    findings.dialogClose.bodyStateAfterClose.backgroundMarkerStillApplied === true,
  );
}

async function main() {
  if (!existsSync(path.join(distDirectory, "index.html"))) {
    throw new Error(
      "dist/index.html missing — run via the `csp-spike` package script (it builds first).",
    );
  }

  // Chromium is required; Firefox and WebKit are probed when their Playwright builds are
  // present (pnpm exec playwright install firefox webkit). The cssText-vs-CSP question and
  // the blocked-setAttribute aftermath are exactly where engines diverge, so the cross-engine
  // matrix is load-bearing for the verdict.
  const browserMatrix = [{ browserType: chromium, browserName: "chromium" }];
  const optionalBrowsers = [
    { browserType: firefox, browserName: "firefox" },
    { browserType: webkit, browserName: "webkit" },
  ];
  for (const optionalBrowser of optionalBrowsers) {
    if (existsSync(optionalBrowser.browserType.executablePath())) {
      browserMatrix.push(optionalBrowser);
    } else {
      console.warn(
        `${optionalBrowser.browserName} build not installed — skipping (pnpm exec playwright install ${optionalBrowser.browserName})`,
      );
    }
  }

  const failures = [];
  for (const { browserType, browserName } of browserMatrix) {
    const findings = await runProbe(browserType, browserName);
    console.log(`\n==== CSP spike findings (${browserName}) ====`);
    console.log(JSON.stringify(findings, null, 2));
    assertVerdict(findings, failures);
  }

  if (failures.length > 0) {
    console.error("\nCSP spike: observed behavior DIVERGES from the documented verdict:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "Upstream (bits-ui/svelte) behavior likely changed — re-evaluate and update VERDICT.md.",
    );
    process.exitCode = 1;
  } else {
    console.log("\nCSP spike: all findings match the documented verdict (VERDICT.md).");
  }
}

await main();
