<script lang="ts">
  /*
   * Input — a styled native <input> (Tier 1: native element, no Bits UI).
   *
   * file-type-narrowing pattern: a file input binds `files` (a FileList) while a value-bearing
   * input binds `value`, so `type` discriminates a small union — { type: "file"; files? } vs
   * { type?: <non-file>; files?: undefined } — over the SHARED HTMLInputAttributes (Omit'd of
   * type, then intersected). This is the narrow shape, unlike the Button's button/anchor case
   * where unioning two FULL attribute interfaces tripped svelte-check's "union too complex";
   * here only the discriminant differs, so it type-checks cleanly. `value`/`files`/`ref` are
   * bindable. Styling is the mc-input recipe; `w-full` is the one layout default (a form control
   * fills its field) and is overridable via `class` since mergeClasses lets the caller win.
   */
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type NonFileInputType = Exclude<HTMLInputTypeAttribute, "file">;

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type"> &
      ({ type: "file"; files?: FileList } | { type?: NonFileInputType; files?: undefined }),
    HTMLInputElement
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    files = $bindable(),
    class: className,
    type,
    ...restProps
  }: Props = $props();
</script>

{#if type === "file"}
  <input
    bind:this={ref}
    type="file"
    bind:files
    bind:value
    class={mergeClasses("mc-input w-full", className)}
    {...restProps}
  />
{:else}
  <input
    bind:this={ref}
    {type}
    bind:value
    class={mergeClasses("mc-input w-full", className)}
    {...restProps}
  />
{/if}
