// @vitest-environment happy-dom
/*
 * The template library renders, and its masthead names what it creates.
 *
 * WHY A MOUNT TEST FOR ONE SCREEN. /documents shipped as a crash on 2026-09-18 and stayed one for
 * every visit until somebody reported it. Nothing was broken about the data: `CreateControl` refuses
 * a noun longer than its fixed width holds, `noun="Template"` was one character over, and the
 * refusal is a `throw` raised WHILE THE SCREEN RENDERS. The render boundary caught it and did
 * exactly its job — the whole page became the failure screen with an Error ID — which is why the
 * defect reached production looking like a server problem rather than a label that did not fit.
 *
 * Nothing before this point would have said so. The type-checker sees a string; the unit tests
 * around the column model and the registration ceremony never mounted a component; and the gate
 * that reads create nouns only read the matter section registry, which declares its nouns as data
 * (it reads a screen's markup too now — tooling/lint-matter-create-control/). This is the other
 * half: the screen is actually mounted, under the real root layout, and a render-time throw of any
 * kind — a missing context, a null the template did not expect, the next assertion a design-system
 * component adds — fails here rather than on the deployed site.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { CRASH_MESSAGE } from "$lib/diagnostics/crash.ts";
import { clearBreadcrumbs } from "$lib/diagnostics/breadcrumbs.ts";
import { page } from "./stubs/app-state.ts";
import DocumentsPage from "../src/routes/(app)/documents/+page.svelte";
import RootLayoutHarness from "./root-layout-harness.svelte";

page.url = new URL("https://magna-carta.test/documents");

afterEach(() => {
  clearBreadcrumbs();
  vi.restoreAllMocks();
});

it("draws the template library rather than the crash screen", () => {
  // The reads leave the machine and nothing answers them here; a listing that fails settles in the
  // cache as a failure and the register states it. That is the screen working, not the screen
  // crashing, and it is the whole distinction this test exists to hold.
  vi.spyOn(console, "error").mockImplementation(() => {});

  const target = document.createElement("div");
  document.body.append(target);
  const instance = mount(RootLayoutHarness, { target, props: { Page: DocumentsPage } });
  flushSync();
  const text = target.textContent ?? "";

  expect(text).not.toContain(CRASH_MESSAGE);
  expect(text).not.toMatch(/client_[0-9A-HJKMNP-TV-Z]{8}/u);
  expect(text).toContain("Documents");
  // The label the budget was widened for: the masthead says what a press makes.
  expect(text).toContain("New Template");

  void unmount(instance);
  flushSync();
  target.remove();
});
