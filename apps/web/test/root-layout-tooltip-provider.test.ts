// @vitest-environment happy-dom
/*
 * Two things the root layout owes every route group, pinned against the day it owed neither.
 *
 * The one Tooltip.Provider lived inside the app shell, which only the signed-in (app) group mounts,
 * so when the version chip brought a tooltip onto the sign-in screen, clearing cookies and reloading
 * crashed the page before it drew. And the crash reached nobody: SvelteKit catches a failure in
 * `load`, not a throw while rendering, so the screen stayed blank and the error went to a console
 * nobody opens. This pins all three halves — that a bare tooltip really does throw (so the next test
 * is testing something), that the same tooltip renders beneath the root layout, and that a page
 * whose render throws beneath the root layout becomes the failure screen with a client Error ID.
 */
import { flushSync, mount, unmount, type Component, type MountOptions } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { breadcrumbs, clearBreadcrumbs } from "$lib/diagnostics/breadcrumbs.ts";
import { CRASH_MESSAGE } from "$lib/diagnostics/crash.ts";
import { page } from "./stubs/app-state.ts";
import BareTooltip from "./bare-tooltip.svelte";
import RootLayoutHarness from "./root-layout-harness.svelte";
import ThrowingPage from "./throwing-page.svelte";

// The failure screen reads the route off SvelteKit's page state, which vitest.config.ts aliases to
// a stub: the sign-in address, where the incident happened.
page.url = new URL("https://magna-carta.test/login");

function mountAndSettle<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  // The options type is conditional on whether the component takes props at all, which a generic
  // cannot settle; both shapes carry the same two fields.
  const instance = mount(component, { target, props } as MountOptions<Props>);
  flushSync();
  const rendered = target.cloneNode(true) as HTMLElement;
  void unmount(instance);
  flushSync();
  target.remove();
  return rendered;
}

afterEach(() => {
  clearBreadcrumbs();
  vi.restoreAllMocks();
});

describe("the root layout provides the tooltip context", () => {
  it("throws for a tooltip mounted with nothing above it — the defect the layout prevents", () => {
    expect(() => mountAndSettle(BareTooltip, {})).toThrow(/Tooltip\.Provider/u);
  });

  it("renders the same tooltip beneath the root layout, outside any route group", () => {
    const rendered = mountAndSettle(RootLayoutHarness, { Page: BareTooltip });
    expect(rendered.textContent).toContain("Build");
  });
});

describe("the root layout turns a render crash into the failure screen", () => {
  it("draws the screen with a client Error ID and leaves the breadcrumb, instead of throwing", () => {
    // Development mode writes the one console line; the assertion is on the screen, not the log.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const rendered = mountAndSettle(RootLayoutHarness, { Page: ThrowingPage });
    const text = rendered.textContent ?? "";

    expect(text).toContain(CRASH_MESSAGE);
    expect(text).toMatch(/client_[0-9A-HJKMNP-TV-Z]{8}/u);
    // The exception's own words never reach the screen (crash.ts says why).
    expect(text).not.toContain("Tooltip.Provider");
    // The request line waits behind Show details; the summary names the area instead.
    expect(text).toContain("Login");

    const crumb = breadcrumbs().find((entry) => entry.label.startsWith("crash client_"));
    expect(crumb?.category).toBe("failure");
    expect(crumb?.route).toBe("/login");
  });
});
