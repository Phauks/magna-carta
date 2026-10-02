<script lang="ts">
  /*
   * A guest's meeting, from the link they were sent. Everything is in the component: this page only
   * hands it the token, so the whole of what a guest sees is reachable from a test without a router.
   */
  import GuestMeeting from "$lib/meetings/guest-meeting.svelte";

  let { data }: { data: { token: string } } = $props();
</script>

{#key data.token}
  <GuestMeeting token={data.token} />
{/key}
