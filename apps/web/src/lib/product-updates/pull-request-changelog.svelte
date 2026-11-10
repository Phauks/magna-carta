<script lang="ts">
  /*
   * The Changelog's list: every merged pull request, newest first, grouped by the day it landed.
   *
   * Each day and each pull request folds on a caret at its left, and the whole list folds to titles
   * from the filter row, because 600-odd entries are read by scanning titles and opening the few
   * that matter. A pull request is a card so the edge of one entry is never in doubt.
   *
   * Every pull request shows the same three things in the same order: its title; its badges (the
   * pull request and its commit, both linked to GitHub, then its kind, whether members see it, and
   * the areas it touched); and its changelog entry as written, in full and at the width of the
   * screen. An area badge filters to that area.
   *
   * The filters are three small menus that say what they hold and open only when asked: kind, area,
   * and whether to show only what members see.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import type { BadgeVariant } from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import X from "@lucide/svelte/icons/x";
  import ChangelogInline from "./changelog-inline.svelte";
  import {
    PULL_REQUEST_KINDS,
    countBy,
    type MergedPullRequest,
    type PullRequestKind,
  } from "./pull-request-ledger.ts";

  let { pullRequests, query }: { pullRequests: readonly MergedPullRequest[]; query: string } =
    $props();

  /*
   * A kind's badge colour. Additions are the good news; a removal or a security change is the one
   * a reader must not skim past; a pull request with no entry is quiet.
   */
  const KIND_BADGE: Record<PullRequestKind, BadgeVariant> = {
    Added: "success",
    Changed: "info",
    Deprecated: "warning",
    Removed: "danger",
    Fixed: "warning",
    Security: "danger",
    Unrecorded: "neutral",
  };

  type Audience = "all" | "members";

  // Only kinds and areas the ledger actually holds are offered, each with its count.
  const kindOptions = $derived(
    countBy(pullRequests, (pullRequest) => [pullRequest.kind]).toSorted(
      (left, right) =>
        PULL_REQUEST_KINDS.indexOf(left.value) - PULL_REQUEST_KINDS.indexOf(right.value),
    ),
  );
  const areaOptions = $derived(countBy(pullRequests, (pullRequest) => pullRequest.areas));

  let kinds = $state<PullRequestKind[]>([]);
  let areas = $state<string[]>([]);
  let audience = $state<Audience>("all");

  const toggle = <Value,>(list: readonly Value[], value: Value): Value[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  // A menu whose filter is on reads as pressed, so the row says what is narrowing the list.
  const triggerClass = (active: boolean) =>
    `${buttonClasses({ variant: active ? "secondary" : "ghost", size: "sm" })} border ${
      active ? "border-border-strong" : "border-border-default"
    }`;

  const menuLabel = (name: string, chosen: readonly string[]) =>
    chosen.length === 0
      ? name
      : chosen.length === 1
        ? `${name}: ${chosen[0]}`
        : `${name}: ${chosen.length}`;

  const visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return pullRequests.filter(
      (pullRequest) =>
        (kinds.length === 0 || kinds.includes(pullRequest.kind)) &&
        (areas.length === 0 || pullRequest.areas.some((area) => areas.includes(area))) &&
        (audience === "all" || pullRequest.memberFacing) &&
        (needle === "" || pullRequest.searchText.includes(needle)),
    );
  });
  const days = $derived.by(() => {
    const byDate = new Map<string, MergedPullRequest[]>();
    for (const pullRequest of visible) {
      byDate.set(pullRequest.date, [...(byDate.get(pullRequest.date) ?? []), pullRequest]);
    }
    return [...byDate].map(([date, onDate]) => ({ date, pullRequests: onDate }));
  });
  const filtered = $derived(kinds.length > 0 || areas.length > 0 || audience !== "all");

  // The newest day opens; older days wait to be asked for. Every entry starts open within its day.
  let openDays = $state<string[]>(
    pullRequests[0] === undefined ? [] : [pullRequests[0].date],
  );
  const everyEntry = () => pullRequests.map((pullRequest) => String(pullRequest.number));
  let openEntries = $state<string[]>(everyEntry());
  const anyEntryOpen = $derived(openEntries.length > 0);

  function clearFilters() {
    kinds = [];
    areas = [];
    audience = "all";
  }
</script>

<div class="flex flex-col gap-24">
  <div class="flex flex-wrap items-center gap-8">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(kinds.length > 0)}>
        {menuLabel("Kind", kinds)}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
        {#each kindOptions as option (option.value)}
          <DropdownMenu.CheckboxItem
            checked={kinds.includes(option.value)}
            onCheckedChange={() => (kinds = toggle(kinds, option.value))}
            closeOnSelect={false}
          >
            <span class="flex w-full items-center justify-between gap-8">
              {option.value}
              <span class="text-xs text-text-muted tabular-nums">{option.count}</span>
            </span>
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(areas.length > 0)}>
        {menuLabel("Area", areas)}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
        <!-- Thirty-odd areas: the list scrolls inside a short menu rather than running off the page. -->
        <div
          class="mc-scrollbar overflow-y-auto"
          style="max-block-size: min(var(--bits-floating-available-height, 18rem), 18rem)"
        >
          {#each areaOptions as option (option.value)}
            <DropdownMenu.CheckboxItem
              checked={areas.includes(option.value)}
              onCheckedChange={() => (areas = toggle(areas, option.value))}
              closeOnSelect={false}
            >
              <span class="flex w-full items-center justify-between gap-8">
                {option.value}
                <span class="text-xs text-text-muted tabular-nums">{option.count}</span>
              </span>
            </DropdownMenu.CheckboxItem>
          {/each}
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(audience !== "all")}>
        {audience === "all" ? "All pull requests" : "Only what members see"}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="min-inline-size: var(--mc-size-popover)">
        <DropdownMenu.RadioGroup
          value={audience}
          onValueChange={(value) => (audience = value as Audience)}
        >
          <DropdownMenu.RadioItem value="all">All pull requests</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="members">Only what members see</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    {#if filtered}
      <Button variant="ghost" size="sm" onclick={clearFilters}>
        <X class="size-16" aria-hidden="true" />
        Clear
      </Button>
    {/if}

    <span class="ms-auto flex items-center gap-12 text-sm text-text-muted tabular-nums">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => (openEntries = anyEntryOpen ? [] : everyEntry())}
      >
        {#if anyEntryOpen}
          <ChevronsDownUp class="size-16" aria-hidden="true" />
          Collapse entries
        {:else}
          <ChevronsUpDown class="size-16" aria-hidden="true" />
          Expand entries
        {/if}
      </Button>
      <span>
        {filtered || query.trim() !== ""
          ? `${visible.length} of ${pullRequests.length}`
          : pullRequests.length} pull requests
      </span>
    </span>
  </div>

  {#if days.length === 0}
    <EmptyState title="No pull requests match">
      Nothing merged matches the search and filters. Clearing them brings the full list back.
    </EmptyState>
  {:else}
    <Accordion.Root type="multiple" value={openDays} onValueChange={(value) => (openDays = value)}>
      {#each days as day (day.date)}
        <Accordion.Item value={day.date}>
          <Accordion.Trigger chevron="start">
            <span class="flex items-baseline gap-12">
              <span class="font-display text-xl">{formatDate(day.date)}</span>
              <span class="text-sm text-text-muted">
                {day.pullRequests.length} pull {day.pullRequests.length === 1 ? "request" : "requests"}
              </span>
            </span>
          </Accordion.Trigger>
          <Accordion.Content>
            <Accordion.Root
              type="multiple"
              value={openEntries}
              onValueChange={(value) => (openEntries = value)}
              class="flex flex-col gap-12 ps-24"
            >
              {#each day.pullRequests as pullRequest (pullRequest.number)}
                <Accordion.Item
                  value={String(pullRequest.number)}
                  class="flex flex-col gap-8 rounded-lg border border-border-default bg-surface-raised px-16 py-12"
                >
                  <Accordion.Trigger chevron="start" class="py-4 text-start text-base font-semibold">
                    {pullRequest.title}
                  </Accordion.Trigger>
                  <div class="flex flex-wrap items-center gap-4 ps-24">
                    <a
                      href={pullRequest.pullRequestUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Pull request ${pullRequest.number} on GitHub`}
                    >
                      <Badge variant="neutral" class="font-mono">#{pullRequest.number}</Badge>
                    </a>
                    <a
                      href={pullRequest.commitUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Commit ${pullRequest.shortSha} on GitHub`}
                      title={pullRequest.sha}
                    >
                      <Badge variant="neutral" class="font-mono">{pullRequest.shortSha}</Badge>
                    </a>
                    <Badge variant={KIND_BADGE[pullRequest.kind]}>{pullRequest.kind}</Badge>
                    {#if pullRequest.memberFacing}
                      <Badge variant="accent">Members see this</Badge>
                    {/if}
                    {#each pullRequest.areas as area (area)}
                      <button
                        type="button"
                        aria-label={`Show only ${area}`}
                        onclick={() => (areas = toggle(areas, area))}
                      >
                        <Badge variant="neutral">{area}</Badge>
                      </button>
                    {/each}
                  </div>
                  <Accordion.Content>
                    {#if pullRequest.entry.length > 0}
                      <div class="flex flex-col gap-8 ps-24 pt-4 text-sm text-text-default">
                        {#each pullRequest.entry as paragraph, index (index)}
                          <p><ChangelogInline nodes={paragraph} /></p>
                        {/each}
                      </div>
                    {:else}
                      <p class="ps-24 pt-4 text-sm text-text-muted">
                        No changelog entry was written for this pull request.
                      </p>
                    {/if}
                  </Accordion.Content>
                </Accordion.Item>
              {/each}
            </Accordion.Root>
          </Accordion.Content>
        </Accordion.Item>
      {/each}
    </Accordion.Root>
  {/if}
</div>
