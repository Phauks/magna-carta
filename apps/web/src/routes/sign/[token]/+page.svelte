<script lang="ts">
  /*
   * A signer's document, from the link they were sent. Everything is in the component: this page
   * only hands it the token, so the whole of what a signer sees is reachable without a router.
   */
  import SignerPage from "$lib/signing/signer-page.svelte";

  let { data }: { data: { token: string } } = $props();
</script>

{#key data.token}
  <SignerPage token={data.token} />
{/key}
