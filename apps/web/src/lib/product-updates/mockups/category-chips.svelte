<script lang="ts">
  import Button from "@magna-carta/design-system/button";
  import type { ChangelogEntry } from "../changelog-entries.ts";

  let {
    entries,
    selected = $bindable("all"),
  }: { entries: readonly ChangelogEntry[]; selected?: string } = $props();

  const options = $derived([
    { value: "all", label: "All", count: entries.length },
    ...["Added", "Changed", "Fixed", "Deprecated", "Removed", "Security"]
      .map((category) => ({
        value: category,
        label: category,
        count: entries.filter((entry) => entry.category === category).length,
      }))
      .filter((option) => option.count > 0),
  ]);
</script>

<div class="flex flex-wrap items-center gap-4 self-start rounded-md border border-border-subtle p-2">
  {#each options as option (option.value)}
    <Button
      variant={selected === option.value ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={selected === option.value}
      onclick={() => (selected = option.value)}
    >
      {option.label}
      <span class="text-xs text-text-muted tabular-nums">{option.count}</span>
    </Button>
  {/each}
</div>
