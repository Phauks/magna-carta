<script lang="ts">
  /*
   * DetailsPanel.Close — letting go of what is selected, which returns the panel to the face that
   * speaks for the whole matter.
   *
   * It is NOT a close control for the panel itself: the panel is shown and hidden by the surface's
   * own toggle, and a second control that looked like it closed the panel but only cleared the
   * selection would teach the wrong thing. The label says what it actually does, and the surface
   * supplies it because only the surface knows what its records are called.
   */
  import Button from "@magna-carta/design-system/button";
  import X from "@lucide/svelte/icons/x";

  let {
    label,
    onclick,
  }: {
    /** What letting go does here, e.g. "Let go of this cost and show the matter summary". */
    label: string;
    onclick: () => void;
  } = $props();
</script>

<Button variant="ghost" size="icon" title={label} aria-label={label} {onclick}>
  <X class="size-16" aria-hidden="true" />
</Button>
