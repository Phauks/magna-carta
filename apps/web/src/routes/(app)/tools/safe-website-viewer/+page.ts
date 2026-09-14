/*
 * The viewer is one framed unit that takes the remaining height, with the screenshot scrolling
 * inside it — so the page owns the content column's scrolling rather than the Tools layout
 * (content-column.ts says how the layout reads this).
 */
import { PAGE_OWNS_SCROLLER } from "$lib/tools/content-column.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => PAGE_OWNS_SCROLLER;
