/*
 * The keys of the record windows the Activity register can host.
 *
 * DOM-free on purpose: the fitness test pairs the contributions' `open` and `create` answers to
 * these keys without importing a Svelte component (the windows themselves pull the app's router
 * into a node test). windows.ts maps every key here to its component, and the type of that map
 * fails to compile the moment a key has no window or a window has no key.
 */
export const ACTIVITY_WINDOW_KEYS = ["note"] as const;
export type ActivityWindowKey = (typeof ACTIVITY_WINDOW_KEYS)[number];
