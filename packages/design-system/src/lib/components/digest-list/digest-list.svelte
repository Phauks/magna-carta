<script lang="ts">
  /*
   * DigestList — a file's fingerprints, one algorithm per row.
   *
   * ONE RECIPE FOR EVERY DIGEST WE SHOW. Digests were being drawn twice: the matter file's
   * inspector had its own definition list, and the workbench grew a second one with different
   * spacing, a different pending state and a copy button somewhere else. They are the same reading,
   * so they are the same component; a surface supplies the rows and their order and nothing else.
   *
   * EVERY ROW IS ON SCREEN BEFORE ITS VALUE IS. A digest that has not been computed keeps its row
   * and says so, and a digest being computed keeps its row and shows the wait. The list never grows
   * as answers land, so nothing under it moves while a reader is looking at it.
   *
   * THE VALUE IS THE COPY CONTROL. Where a surface passes `onCopy`, the digest itself is the button
   * — a copy icon beside it would be a second target for the same act. The confirmation is the
   * control filling for a moment and never a glyph appearing: a glyph changes the control's width,
   * and on a row whose whole content is one long value, a width change reads as the value changing.
   *
   * Full values, wrapped rather than truncated. A digest is checked character by character against
   * one someone sent you, and an abbreviated one cannot be. Abbreviation belongs in a summary line
   * that points here, not here.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import Skeleton from "../skeleton/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { DigestEntry } from "./types.ts";

  let {
    digests,
    pending = false,
    absentText = "Not computed yet",
    onCopy = undefined,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    digests: readonly DigestEntry[];
    /** A run is in flight: rows without a value show the wait rather than the absence. */
    pending?: boolean;
    /** What a row says when there is no value and none is being computed. */
    absentText?: string;
    /** Makes each value its own copy control. Omitted, the values are plain text. */
    onCopy?: (entry: DigestEntry) => void;
  } = $props();

  // Which row is confirming, by algorithm. One at a time: a second copy moves the confirmation
  // rather than lighting two rows that were not both just pressed.
  let copied = $state<string | null>(null);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  function copy(entry: DigestEntry): void {
    onCopy?.(entry);
    copied = entry.algorithm;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => (copied = null), 1000);
  }

  $effect(() => () => clearTimeout(clearTimer));
</script>

<dl bind:this={ref} class={mergeClasses("mc-digest-list", className)} {...restProps}>
  {#each digests as entry (entry.algorithm)}
    <div class="mc-digest-list-row">
      <dt class="mc-digest-list-algorithm">{entry.algorithm}</dt>
      <dd class="mc-digest-list-value">
        {#if entry.value !== null && onCopy !== undefined}
          <button
            type="button"
            class="mc-digest-list-copy w-full"
            class:mc-digest-list-copied={copied === entry.algorithm}
            aria-label="Copy the {entry.algorithm} digest"
            onclick={() => copy(entry)}
          >
            {entry.value}
          </button>
        {:else if entry.value !== null}
          <span class="mc-digest-list-digest">{entry.value}</span>
        {:else if pending}
          <Skeleton class="mc-digest-list-pending w-full" />
        {:else}
          <span class="mc-digest-list-absent">{absentText}</span>
        {/if}
      </dd>
    </div>
  {/each}
</dl>
