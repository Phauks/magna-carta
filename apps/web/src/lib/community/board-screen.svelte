<script lang="ts">
  /*
   * The community board's home, layout A as the owner picked it on 2026-11-10: the product areas
   * down the left, one ranked list in the middle (Trending, Top, New), and the roadmap and known
   * issues summarised on the right.
   *
   * The venue line sits above everything because it is the fact a reader most needs before they
   * write a word: anyone with the link can read this, search engines do not keep it, and only
   * people at firms using Magna Carta can post or vote.
   */
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Badge from "@magna-carta/design-system/badge";
  import Input from "@magna-carta/design-system/input";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import * as Select from "@magna-carta/design-system/select";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import type { BoardPostView, BoardSummary } from "@magna-carta/community/board-service";
  import {
    PRODUCT_AREAS,
    ROADMAP_COLUMNS,
    type PostKind,
    type SortOrder,
  } from "@magna-carta/community/vocabulary";
  import CommunityTopBar from "./community-top-bar.svelte";
  import PostRow from "./post-row.svelte";
  import { communityStatusKey } from "./community-status.ts";

  export interface KnownIssueSummary {
    readonly title: string;
    readonly standing: string;
  }

  let {
    kind = "request",
    posts,
    total,
    summary,
    knownIssue,
    viewerDisplayName,
    selectedArea = $bindable(null),
    sort = $bindable("trending"),
    search = $bindable(""),
    onCompose,
  }: {
    kind?: PostKind;
    posts: readonly BoardPostView[];
    total: number;
    summary: BoardSummary;
    knownIssue: KnownIssueSummary | null;
    viewerDisplayName: string | null;
    selectedArea?: string | null;
    sort?: SortOrder;
    search?: string;
    onCompose?: () => void;
  } = $props();

  const areaCounts = $derived(kind === "request" ? summary.requestsByArea : summary.questionsByArea);
  const totalAcrossAreas = $derived(Object.values(areaCounts).reduce((sum, count) => sum + count, 0));
  const STATUS_FILTERS = [
    { value: "open", label: "Open" },
    { value: "all", label: "Every Status" },
    { value: "completed", label: "Completed" },
    { value: "not-on-the-roadmap", label: "Not on the Roadmap" },
  ];
  let statusFilter = $state("open");
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current={kind === "request" ? "requests" : "questions"} {viewerDisplayName} />
  <main class="flex flex-col gap-24 px-32 py-24">
    <p class="flex items-center gap-8 text-xs text-text-muted">
      <EyeOff class="size-16" aria-hidden="true" />
      Anyone with the link can read this board. Search engines do not index it. Only people at firms
      using Magna Carta can post or vote.
    </p>

    <div class="flex items-end justify-between gap-24">
      <div class="flex flex-col gap-4">
        <h1 class="text-2xl font-semibold">{kind === "request" ? "Feature Requests" : "Questions"}</h1>
        <p class="text-sm text-text-muted">
          {kind === "request"
            ? "Ask for what your firm needs, vote on what other firms have asked for, and see what we decided and why."
            : "Ask how to do something in Magna Carta today, and answer what other firms have asked."}
        </p>
      </div>
      <Button onclick={onCompose}>
        <Plus class="size-16" aria-hidden="true" />
        {kind === "request" ? "New Request" : "New Question"}
      </Button>
    </div>

    <div class="flex items-start gap-24">
      <nav aria-label="Topic" class="flex w-3xs shrink-0 flex-col gap-4">
        <FieldLabel as="h2" class="px-8 pb-4">Topic</FieldLabel>
        <button
          type="button"
          aria-current={selectedArea === null ? "true" : undefined}
          onclick={() => (selectedArea = null)}
          class="flex justify-between rounded-md px-8 py-4 text-left text-sm hover:bg-surface-default aria-[current=true]:bg-surface-selected aria-[current=true]:font-semibold"
        >
          All Topics <span class="text-text-subtle tabular-nums">{totalAcrossAreas}</span>
        </button>
        {#each PRODUCT_AREAS as area (area.slug)}
          <button
            type="button"
            aria-current={selectedArea === area.slug ? "true" : undefined}
            onclick={() => (selectedArea = area.slug)}
            class="flex justify-between gap-8 rounded-md px-8 py-4 text-left text-sm hover:bg-surface-default aria-[current=true]:bg-surface-selected aria-[current=true]:font-semibold"
          >
            {area.label}
            <span class="text-text-subtle tabular-nums">{areaCounts[area.slug] ?? 0}</span>
          </button>
        {/each}
      </nav>

      <section aria-label="Posts" class="flex min-w-0 flex-1 flex-col gap-12">
        <div class="flex items-center gap-8">
          <Tabs.Root bind:value={sort}>
            <Tabs.List>
              <Tabs.Trigger value="trending">Trending</Tabs.Trigger>
              <Tabs.Trigger value="top">Top</Tabs.Trigger>
              <Tabs.Trigger value="new">New</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          {#if kind === "request"}
            <Select.Root type="single" items={STATUS_FILTERS} bind:value={statusFilter}>
              <Select.Trigger aria-label="Status" class="w-auto">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each STATUS_FILTERS as filter (filter.value)}
                  <Select.Item value={filter.value} label={filter.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
          <label class="ml-auto flex w-full max-w-sm items-center gap-8">
            <Search class="size-16 text-text-subtle" aria-hidden="true" />
            <span class="sr-only">Search {kind === "request" ? "requests" : "questions"}</span>
            <Input bind:value={search} placeholder={kind === "request" ? "Search requests" : "Search questions"} />
          </label>
        </div>
        {#if posts.length === 0}
          <div class="rounded-lg border border-border-default bg-surface-default px-24 py-40 text-center">
            <p class="text-md font-semibold">Nothing here yet</p>
            <p class="text-sm text-text-muted">
              Be the first to ask about this part of Magna Carta.
            </p>
          </div>
        {:else}
          <ul class="rounded-lg border border-border-default bg-surface-default">
            {#each posts as post (post.number)}
              <PostRow {post} />
            {/each}
          </ul>
          <p class="text-xs text-text-subtle">Showing {posts.length} of {total}.</p>
        {/if}
      </section>

      <aside class="flex w-3xs shrink-0 flex-col gap-12">
        <section class="flex flex-col gap-8 rounded-lg border border-border-default bg-surface-default p-16">
          <FieldLabel as="h2">Roadmap</FieldLabel>
          {#each ROADMAP_COLUMNS.filter((column) => column !== "future").toReversed() as column (column)}
            {@const statusKey = communityStatusKey(column)}
            <div class="flex items-center justify-between">
              <Badge {...statusBadgeAttributes(statusKey)} caps>{statusEntry(statusKey).label}</Badge>
              <span class="text-sm font-semibold tabular-nums">{summary.roadmap[column]}</span>
            </div>
          {/each}
          <a href="#roadmap" class="flex items-center justify-between pt-4 text-sm font-semibold text-text-link">
            Open the Roadmap <ArrowRight class="size-16" aria-hidden="true" />
          </a>
          <p class="text-xs text-text-subtle">No target dates. Cards can move backwards.</p>
        </section>
        {#if knownIssue !== null}
          <section class="flex flex-col gap-8 rounded-lg border border-border-default bg-surface-default p-16">
            <FieldLabel as="h2">Known Issues</FieldLabel>
            <div class="flex gap-8 text-sm">
              <TriangleAlert class="size-16 shrink-0 text-status-warning" aria-hidden="true" />
              <div>
                <p class="font-semibold">{knownIssue.title}</p>
                <p class="text-xs text-text-subtle">{knownIssue.standing}</p>
              </div>
            </div>
          </section>
        {/if}
      </aside>
    </div>
  </main>
</div>
