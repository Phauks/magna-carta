/*
 * RecordWindow — the one window a record opens in, exported as a single component rather than the
 * house namespace shape. The namespace shape exists so a caller can compose a component's parts;
 * this one deliberately has no parts to compose. A record kind hands it snippets and a tab list,
 * and every window in the product is therefore the same window. tooling/lint-one-ui holds the line.
 */
export { default } from "./record-window.svelte";
export { default as RecordWindow } from "./record-window.svelte";
export type { RecordWindowTab } from "./types.ts";
