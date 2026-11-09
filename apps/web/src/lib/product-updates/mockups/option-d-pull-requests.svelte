<script lang="ts">
  /* Option D: every merged pull request, newest first, collapsible by day, filterable. */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import X from "@lucide/svelte/icons/x";
  import { parseChangelogText } from "../changelog-text.ts";
  import ChangelogInline from "../changelog-inline.svelte";
  import pullRequests from "./pull-requests.json";

  let { query }: { query: string } = $props();
  const REPOSITORY = "https://github.com/Phauks/magna-carta";
  const BEHIND = "Behind the scenes";

  type Kind = "Added" | "Changed" | "Fixed" | "Removed" | "Security" | "Deprecated" | "Unrecorded";
  const KIND_TONE: Record<Kind, "success" | "info" | "neutral" | "danger" | "warning"> = {
    Added: "success",
    Changed: "info",
    Fixed: "warning",
    Removed: "danger",
    Security: "danger",
    Deprecated: "warning",
    Unrecorded: "neutral",
  };

  const records = pullRequests.map((pullRequest) => {
    const entry = pullRequest.entries[0];
    const kind = ((entry?.category as Kind | undefined) ?? "Unrecorded") as Kind;
    const publicText = pullRequest.entries.map((item) => item.public).find((text) => text) ?? null;
    const developerText = pullRequest.entries.map((item) => item.developer).join("\n\n");
    return {
      ...pullRequest,
      kind,
      areas: pullRequest.areas.length === 0 ? [BEHIND] : pullRequest.areas,
      publicParagraphs: publicText === null ? [] : parseChangelogText(publicText),
      developerParagraphs: developerText.trim() === "" ? [] : parseChangelogText(developerText),
      memberFacing: publicText !== null,
      searchText: `${pullRequest.title} ${pullRequest.number} ${pullRequest.sha} ${publicText ?? ""} ${developerText}`.toLowerCase(),
    };
  });

  const KINDS = (["Added", "Changed", "Fixed", "Removed", "Security", "Deprecated", "Unrecorded"] as Kind[])
    .map((kind) => ({ kind, count: records.filter((record) => record.kind === kind).length }))
    .filter((option) => option.count > 0);
  const AREA_COUNTS = [...new Set(records.flatMap((record) => record.areas))]
    .map((area) => ({ area, count: records.filter((record) => record.areas.includes(area)).length }))
    .toSorted((left, right) => right.count - left.count);

  let kinds = $state<Kind[]>([]);
  let areas = $state<string[]>([]);
  let audience = $state<"all" | "members">("all");

  const triggerClass = (active: boolean) =>
    `${buttonClasses({ variant: active ? "secondary" : "ghost", size: "sm" })} border ${
      active ? "border-border-strong" : "border-border-default"
    }`;
  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const visible = $derived(
    records.filter(
      (record) =>
        (kinds.length === 0 || kinds.includes(record.kind)) &&
        (areas.length === 0 || record.areas.some((area) => areas.includes(area))) &&
        (audience === "all" || record.memberFacing) &&
        (query.trim() === "" || record.searchText.includes(query.trim().toLowerCase())),
    ),
  );
  const dates = $derived([...new Set(visible.map((record) => record.date))]);
  const filtered = $derived(kinds.length > 0 || areas.length > 0 || audience !== "all");
  let open = $state<string[]>(records.slice(0, 1).map((record) => record.date));
  let detailsOpen = $state<string[]>([]);
</script>

<div class="flex flex-col gap-24">
  <!-- The filters: three small menus that say what they hold and open only when asked. -->
  <div class="flex flex-wrap items-center gap-8">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(kinds.length > 0)}>
        {kinds.length === 0 ? "Kind" : kinds.length === 1 ? `Kind: ${kinds[0]}` : `Kind: ${kinds.length}`}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="inline-size: var(--mc-size-popover)">
        {#each KINDS as option (option.kind)}
          <DropdownMenu.CheckboxItem
            checked={kinds.includes(option.kind)}
            onCheckedChange={() => (kinds = toggle(kinds, option.kind))}
            closeOnSelect={false}
          >
            <span class="flex w-full items-center justify-between gap-8">
              {option.kind}
              <span class="text-xs text-text-muted tabular-nums">{option.count}</span>
            </span>
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(areas.length > 0)}>
        {areas.length === 0 ? "Area" : areas.length === 1 ? `Area: ${areas[0]}` : `Area: ${areas.length}`}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="inline-size: var(--mc-size-popover)">
        <div class="mc-scrollbar overflow-y-auto" style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)">
        {#each AREA_COUNTS as option (option.area)}
          <DropdownMenu.CheckboxItem
            checked={areas.includes(option.area)}
            onCheckedChange={() => (areas = toggle(areas, option.area))}
            closeOnSelect={false}
          >
            <span class="flex w-full items-center justify-between gap-8">
              {option.area}
              <span class="text-xs text-text-muted tabular-nums">{option.count}</span>
            </span>
          </DropdownMenu.CheckboxItem>
        {/each}
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={triggerClass(audience !== "all")}>
        {audience === "all" ? "All pull requests" : "Member-facing only"}
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" style="inline-size: var(--mc-size-popover)">
        <DropdownMenu.RadioGroup
          value={audience}
          onValueChange={(value) => (audience = value as "all" | "members")}
        >
          <DropdownMenu.RadioItem value="all">Every pull request</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="members">Only what members see</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    {#if filtered}
      <Button variant="ghost" size="sm" onclick={() => ((kinds = []), (areas = []), (audience = "all"))}>
        <X class="size-16" aria-hidden="true" />
        Clear
      </Button>
    {/if}
    <span class="ms-auto text-sm text-text-muted tabular-nums">
      {filtered ? `${visible.length} of ${records.length}` : records.length} pull requests
    </span>
  </div>

  <Accordion.Root type="multiple" value={open} onValueChange={(value) => (open = value)}>
    {#each dates as date (date)}
      {@const onDate = visible.filter((record) => record.date === date)}
      <Accordion.Item value={date}>
        <Accordion.Trigger chevron="start">
          <span class="flex items-baseline gap-12">
            <span class="font-display text-xl">{formatDate(date)}</span>
            <span class="text-sm text-text-muted">
              {onDate.length} pull {onDate.length === 1 ? "request" : "requests"}
            </span>
          </span>
        </Accordion.Trigger>
        <Accordion.Content>
          <ul class="flex flex-col divide-y divide-border-default ps-24">
            {#each onDate as record (record.number)}
              <li class="flex flex-col gap-8 py-16">
                <p class="text-base font-semibold">{record.title}</p>
                <div class="flex flex-wrap items-center gap-4">
                  <a
                    href={`${REPOSITORY}/commit/${record.sha}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Commit ${record.sha}, pull request #${record.number}, on GitHub`}
                  >
                    <Badge variant="neutral" class="font-mono">{record.sha.slice(0, 7)}</Badge>
                  </a>
                  <Badge variant={KIND_TONE[record.kind]}>{record.kind}</Badge>
                  {#if record.memberFacing}
                    <Badge variant="accent">Members see this</Badge>
                  {/if}
                  {#each record.areas as area (area)}
                    <button type="button" onclick={() => (areas = toggle(areas, area))}>
                      <Badge variant="neutral">{area}</Badge>
                    </button>
                  {/each}
                </div>
                {#if record.publicParagraphs.length > 0}
                  <div class="flex flex-col gap-8 text-sm text-text-default">
                    {#each record.publicParagraphs as paragraph, index (index)}
                      <p><ChangelogInline nodes={paragraph} /></p>
                    {/each}
                  </div>
                {/if}
                {#if record.developerParagraphs.length > 0}
                  <Accordion.Root
                    type="multiple"
                    value={detailsOpen}
                    onValueChange={(value) => (detailsOpen = value)}
                  >
                    <Accordion.Item value={String(record.number)} class="border-none">
                      <Accordion.Trigger chevron="start" class="py-4 text-sm text-text-muted">
                        Changelog entry
                      </Accordion.Trigger>
                      <Accordion.Content>
                        <div class="flex flex-col gap-8 ps-24 text-sm text-text-muted">
                          {#each record.developerParagraphs as paragraph, index (index)}
                            <p><ChangelogInline nodes={paragraph} /></p>
                          {/each}
                        </div>
                      </Accordion.Content>
                    </Accordion.Item>
                  </Accordion.Root>
                {/if}
              </li>
            {/each}
          </ul>
        </Accordion.Content>
      </Accordion.Item>
    {/each}
  </Accordion.Root>
</div>
