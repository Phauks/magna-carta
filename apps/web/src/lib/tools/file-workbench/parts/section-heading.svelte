<script lang="ts">
  import FieldLabel from "@magna-carta/design-system/field-label";
  /* The engraved rule a panel divides its findings with. One shape, so every panel divides alike. */
  let { children }: { children: import("svelte").Snippet } = $props();
</script>

<FieldLabel as="h3" class="m-0"
>
  {@render children()}
</FieldLabel>
