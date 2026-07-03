<script lang="ts">
  /* Form.Description — supplementary field help, associated with the control via aria-describedby
     (formsnap wires it). The mc-form-description recipe styles it as muted helper text. */
  import { Description as FormsnapDescription } from "formsnap";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let { class: className, ...restProps }: ComponentProps<typeof FormsnapDescription> = $props();
</script>

<FormsnapDescription class={mergeClasses("mc-form-description", className)} {...restProps} />
