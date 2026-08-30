<script lang="ts">
  /*
   * How a safety verdict looks, in one place, so the Safety column, a folder's aggregate and the
   * details panel cannot end up with three answers to one question.
   *
   * A clean, typed file wears the bare mark and NO WORD: a column that says "Clean" on nine rows in
   * ten says nothing at all. Every other verdict wears the register's pale-tint chip with the
   * register's own word, and the meaning rides the hover rather than being printed beneath it.
   */
  import Badge from "@magna-carta/design-system/badge";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import {
    statusBadgeAttributes,
    statusEntry,
    statusMarkClasses,
  } from "@magna-carta/design-system/status-register";
  import type { SafetyKey } from "./file-manager-vocabulary.ts";

  let { verdict }: { verdict: SafetyKey } = $props();

  const entry = $derived(statusEntry(verdict));
</script>

{#if entry.presentation === "mark"}
  <CircleCheck class={statusMarkClasses()} aria-label={entry.label} />
{:else}
  <Badge {...statusBadgeAttributes(verdict)}>{entry.label}</Badge>
{/if}
