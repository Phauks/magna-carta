<script lang="ts">
  /*
   * "Powered by Google Translate", with a link to Google Translate itself. This line stands in for a
   * notice before first use (owner ruling, 2026-11-20). It sits beside every translation, so whoever
   * reads one can see which service produced it.
   *
   * The link opens Google Translate's own page empty. Nothing the member typed goes in the address:
   * a client's words do not belong in a URL that lands in browser history and Google's logs.
   */
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { GOOGLE_TRANSLATE_URL } from "./translation-api.ts";

  let { class: className = "" }: { class?: string } = $props();
</script>

<p class="text-xs text-text-muted {className}">
  Powered by
  <a
    class="inline-flex items-center gap-4 text-text-link underline-offset-2 hover:underline"
    href={GOOGLE_TRANSLATE_URL}
    {...opensBeside("external")}
  >
    Google Translate<ExternalLink class="size-12" aria-hidden="true" />
  </a>
</p>
