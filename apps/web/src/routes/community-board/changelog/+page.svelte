<script lang="ts">
  import ChangelogScreen from "$lib/community/changelog-screen.svelte";
  import { boardSession } from "$lib/community/board-session.svelte.ts";
  import { publicChangelogReleases } from "$lib/product-updates/public-changelog.ts";

  const board = boardSession();
  // Parsed once: the document is fixed for the life of the bundle.
  const releases = publicChangelogReleases();
</script>

<svelte:head>
  <title>Changelog · Magna Carta Community</title>
</svelte:head>

<ChangelogScreen
  {releases}
  viewerDisplayName={board.viewerDisplayName}
  signInUrl={board.session?.signInUrl ?? null}
  onSignOut={board.session?.signedIn === true ? () => void board.signOut() : undefined}
/>
