<script lang="ts">
  /*
   * A signer's document, from the link they were sent. Everything is in the component: this page
   * only hands it the token, so the whole of what a signer sees is reachable without a router.
   */
  import SignerPage from "$lib/signing/signer-page.svelte";
  import { linkSession } from "$lib/signing/signer-api.ts";

  let { data }: { data: { token: string } } = $props();
</script>

{#key data.token}
  <SignerPage session={linkSession(data.token)} />
{/key}
