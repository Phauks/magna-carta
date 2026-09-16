<script lang="ts">
  /*
   * The Tools shell — a passthrough, deliberately.
   *
   * IT USED TO BE A TWO-SIDED SCREEN: every tool the member may open in a navigation column on the
   * left, the tool itself beside it. The owner's direction of 2026-09-16 ended that. Two reasons,
   * and the second is the one that decided it:
   *
   *   - The tools are not a family. A postage rate, a WHOIS record, a county recorder's site and a
   *     bandwidth measurement share a sentence in the catalog and nothing else, so a column listing
   *     the other eight beside the one you opened is a column of things you are not doing.
   *   - It cost every tool the width of that column, permanently. The surfaces that will carry the
   *     most use — mailing and postage first, where a label, a rate table and an address want to sit
   *     side by side — are exactly the ones that can least afford to give it up.
   *
   * So the tools were elevated into the global rail instead (navigation/tool-sidebar.ts): a tool is
   * one reach from wherever the reader is, and it opens onto the whole canvas. This layout stays as
   * the route's own node rather than being deleted, because /tools/<id> is still where a tool is
   * addressed — that address is the catalog's (toolRoute), and moving nine routes to shorten a URL
   * would break every link anybody has kept.
   *
   * THE WAY BACK STAYS ON EACH TOOL'S HEADER. `back="tools"` on a tool's ScreenHeader still reads
   * to the index at /tools, which is now what that screen is for: the descriptions and the search,
   * where a reader finds out what a tool does rather than where they go to open one.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
