<script lang="ts">
  /*
   * Conflicts Check — the firm's own surface for the screen a lawyer runs before taking a matter,
   * and re-runs when circumstances change.
   *
   * This is the Form archetype: a grouped-section form at a readable measure, then the record it
   * writes. It is deliberately not a search box. A conflicts check is a professional-responsibility
   * act with a record behind it — what was searched, what could not be, what surfaced, and who
   * concluded what — and the shape of this screen is the shape of that act.
   *
   * NAMING A MATTER CHANGES WHAT CAN BE SEARCHED. With a matter, the matter's own parties join the
   * subjects and the imputation class has something to join the firm's members against. Without
   * one, imputation records unavailable — which the check says out loud rather than leaving out.
   *
   * WHAT THIS SCREEN CANNOT OFFER, AND SAYS SO. Nothing serves a list of the checks a firm has run,
   * so there is no history here; the block that would hold one renders in its place, refused, naming
   * what it waits on. A matter's own standing is reachable, because that read exists.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { goto } from "$app/navigation";
  import CheckRunner from "$lib/conflicts/check-runner.svelte";
  import { gapReason } from "$lib/conflicts/conflicts-gaps.ts";
  import { RUN_CHECK_PERMISSION } from "$lib/conflicts/conflicts-api.ts";
  import { MaturityBadge, soonControlProperties } from "@magna-carta/design-system/maturity";
  import {
    listMatters,
    readSession,
    type MatterSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  let matters = $state<readonly MatterSummary[]>([]);
  let matterQuery = $state("");
  let settledMatterQuery = $state("");
  let chosenMatter = $state<MatterSummary | null>(null);
  let bootstrapped = $state(false);

  const historyDescription = "conflicts-earlier-checks";
  const soonHistory = soonControlProperties(gapReason("checkHistory"), historyDescription);

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  // The typed query settles before it is sent: a docket read per keystroke is a request per
  // keystroke, and the firm's own search over title, number and client is the authoritative one.
  $effect(() => {
    const typed = matterQuery;
    const timer = setTimeout(() => (settledMatterQuery = typed), 250);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const asked = settledMatterQuery.trim();
    let live = true;
    void (async () => {
      const outcome = await listMatters(fetch, { scope: "caseload", search: asked });
      if (!live) return;
      // A docket that cannot be read leaves the picker empty; the check itself does not need one.
      matters = outcome.kind === "ok" ? outcome.value.data : [];
    })();
    return () => {
      live = false;
    };
  });

  const permissions = $derived(session?.permissions ?? null);
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));

  /**
   * How a matter reads in the picker and back on the form: its number where it has one. A
   * consultation's tentative number counts — running a check against one is the whole point of
   * taking the consultation, and the number is what the result will be filed under.
   */
  function matterLine(matter: MatterSummary): string {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  }

  function chooseMatter(value: string | string[]): void {
    const id = Array.isArray(value) ? (value[0] ?? "") : value;
    chosenMatter = matters.find((matter) => matter.id === id) ?? null;
  }
</script>

<svelte:head>
  <title>Conflicts Check · Magna Carta</title>
</svelte:head>

<ScreenHeader
  title="Conflicts Check"
  class="mb-24"
>
  {#snippet meta()}
    <span>Search the firm's record, and keep what the search did</span>
  {/snippet}
</ScreenHeader>

{#if session !== null && !mayRun}
  <Alert.Root variant="info" class="mb-16">
    <Alert.Title>Running A Check Is Not Available To This Account</Alert.Title>
    <Alert.Description>
      Running a check needs the conflicts:run permission, which this account does not hold. Reading a
      matter's standing is a separate permission.
    </Alert.Description>
  </Alert.Root>
{/if}

<div class="flex max-w-3xl flex-col gap-24">
  <section class="flex flex-col gap-16">
    <h2 class="text-base font-semibold">The Matter</h2>
    <div class="flex flex-col gap-8">
      <Label for="conflicts-matter">Matter</Label>
      <Combobox.Root
        type="single"
        items={matters.map((matter) => ({ value: matter.id, label: matterLine(matter) }))}
        inputValue={matterQuery}
        onValueChange={chooseMatter}
      >
        <Combobox.Input
          id="conflicts-matter"
          placeholder="Matter"
          autocomplete="off"
          oninput={(event) => (matterQuery = event.currentTarget.value)}
        />
        <Combobox.Content>
          {#each matters as matter (matter.id)}
            <Combobox.Item value={matter.id} label={matterLine(matter)}>
              {matterLine(matter)}
            </Combobox.Item>
          {/each}
        </Combobox.Content>
      </Combobox.Root>
    </div>

    {#if chosenMatter !== null}
      <div class="flex flex-wrap items-center gap-8">
        <Button
          variant="secondary"
          onclick={() => void goto(`/conflicts/matters/${chosenMatter?.id ?? ""}`)}
        >
          <ScrollText class="size-16" aria-hidden="true" />
          Read where this matter stands
        </Button>
        <Button variant="ghost" onclick={() => (chosenMatter = null)}>Clear the matter</Button>
      </div>
    {/if}
  </section>

  <Separator />

  <CheckRunner
    matterId={chosenMatter?.id ?? null}
    matterLabel={chosenMatter === null ? null : matterLine(chosenMatter)}
    {permissions}
    onRan={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
  />

  <Separator />

  <section class="flex flex-col gap-8">
    <div class="flex items-center gap-8">
      <h2 class="text-base font-semibold">Earlier Checks</h2>
      <MaturityBadge stage="soon" />
    </div>
    <!-- The block keeps its place rather than being dropped: a firm looking for the checks it has
         run should see that the platform knows the question and cannot answer it yet. -->
    <p id={historyDescription} class="text-sm text-text-muted">{soonHistory.title}</p>
  </section>
</div>
