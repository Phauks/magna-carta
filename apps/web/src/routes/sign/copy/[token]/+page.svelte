<script lang="ts">
  /*
   * A signer's signed copy, from the link in the completion email. Everything is in the component:
   * this page only hands it the token.
   */
  import SignedCopyPage from "$lib/signing/signed-copy-page.svelte";

  let { data }: { data: { token: string } } = $props();
</script>

{#key data.token}
  <SignedCopyPage token={data.token} />
{/key}
