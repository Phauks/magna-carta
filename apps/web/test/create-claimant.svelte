<script lang="ts">
  /* A section page stand-in: claims the create control for its section while mounted. */
  import { claimMatterCreate } from "$lib/matters/create-action.svelte.ts";

  let { section }: { section: string } = $props();

  // Read once, as a route page reads its slug: the harness keys this component on the section.
  // svelte-ignore state_referenced_locally
  claimMatterCreate(section, () => ({ title: `New on ${section}`, run: () => {} }));
</script>

<p>{section}</p>
