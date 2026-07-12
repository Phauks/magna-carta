# Task 2 review package

Range: 41985e113c9e8f8a917cbfd35da98863c7ae2f4b..b73385c014711055b730a87bdcb68618f9f86802

## Commits

b73385c feat(tools): persisted tiles/list view preference

## Diff --stat

.../src/lib/tools/tools-view-preference.svelte.ts | 51 ++++++++++++++++++++++
apps/web/src/lib/tools/tools-view-preference.ts | 16 +++++++
apps/web/test/tools-view-preference.test.ts | 24 ++++++++++
3 files changed, 91 insertions(+)

## Full diff (-U10)

```diff
diff --git a/apps/web/src/lib/tools/tools-view-preference.svelte.ts b/apps/web/src/lib/tools/tools-view-preference.svelte.ts
new file mode 100644
index 0000000..749a5ba
--- /dev/null
+++ b/apps/web/src/lib/tools/tools-view-preference.svelte.ts
@@ -0,0 +1,51 @@
+/*
+ * The reactive Tools view preference — a per-browser choice, stored in localStorage and synced
+ * across tabs by the storage event (the sidebar-preferences pattern). SSR/prerender-safe: module
+ * init never assumes a browser. Reads and writes go through parseToolsView so a stale value
+ * normalizes on read.
+ */
+import {
+  DEFAULT_VIEW,
+  TOOLS_VIEW_STORAGE_KEY,
+  parseToolsView,
+  type ToolsView,
+} from "./tools-view-preference.ts";
+
+function readStored(): ToolsView {
+  if (typeof localStorage === "undefined") return DEFAULT_VIEW;
+  try {
+    return parseToolsView(localStorage.getItem(TOOLS_VIEW_STORAGE_KEY));
+  } catch {
+    return DEFAULT_VIEW;
+  }
+}
+
+function persist(view: ToolsView): void {
+  if (typeof localStorage === "undefined") return;
+  try {
+    localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, view);
+  } catch {
+    // Storage unavailable; the live preference still works for the session.
+  }
+}
+
+const state = $state<{ view: ToolsView }>({ view: readStored() });
+
+// Follow the choice across same-origin tabs. `event.key === null` is storage.clear().
+if (typeof window !== "undefined") {
+  window.addEventListener("storage", (event) => {
+    if (event.key !== null && event.key !== TOOLS_VIEW_STORAGE_KEY) return;
+    state.view = readStored();
+  });
+}
+
+/** Read reactively in markup. */
+export function toolsView(): ToolsView {
+  return state.view;
+}
+
+export function setToolsView(view: ToolsView): void {
+  if (state.view === view) return;
+  state.view = view;
+  persist(view);
+}
diff --git a/apps/web/src/lib/tools/tools-view-preference.ts b/apps/web/src/lib/tools/tools-view-preference.ts
new file mode 100644
index 0000000..6410505
--- /dev/null
+++ b/apps/web/src/lib/tools/tools-view-preference.ts
@@ -0,0 +1,16 @@
+/*
+ * The Tools page's view choice — a card grid ("tiles") or a dense list ("list"). This pure
+ * module holds the shape, the default, the storage key, and the read-time validation; the rune
+ * store beside it (tools-view-preference.svelte.ts) owns the reactive state and localStorage.
+ * The split keeps this logic unit-testable under the plugin-less web test config.
+ */
+export type ToolsView = "tiles" | "list";
+
+export const DEFAULT_VIEW: ToolsView = "tiles";
+
+export const TOOLS_VIEW_STORAGE_KEY = "mc-tools-view";
+
+/** Normalize a stored value: only the two known views survive; everything else is the default. */
+export function parseToolsView(raw: string | null): ToolsView {
+  return raw === "tiles" || raw === "list" ? raw : DEFAULT_VIEW;
+}
diff --git a/apps/web/test/tools-view-preference.test.ts b/apps/web/test/tools-view-preference.test.ts
new file mode 100644
index 0000000..3a7ba4e
--- /dev/null
+++ b/apps/web/test/tools-view-preference.test.ts
@@ -0,0 +1,24 @@
+/*
+ * The view-preference PARSE rule, pinned: only the two known views survive a read; anything
+ * else (null, a stale/hand-edited value) falls back to the default. The rune store and its
+ * localStorage/cross-tab wiring are browser-verified — this pins the one branch worth a unit.
+ */
+import { describe, expect, it } from "vitest";
+import { DEFAULT_VIEW, parseToolsView } from "../src/lib/tools/tools-view-preference.ts";
+
+describe("parseToolsView", () => {
+  it("keeps a valid stored view", () => {
+    expect(parseToolsView("tiles")).toBe("tiles");
+    expect(parseToolsView("list")).toBe("list");
+  });
+
+  it("falls back to the default for null or unknown values", () => {
+    expect(parseToolsView(null)).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("grid")).toBe(DEFAULT_VIEW);
+    expect(parseToolsView("")).toBe(DEFAULT_VIEW);
+  });
+
+  it("defaults to tiles", () => {
+    expect(DEFAULT_VIEW).toBe("tiles");
+  });
+});
```
