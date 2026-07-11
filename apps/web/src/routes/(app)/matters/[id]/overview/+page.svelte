<script lang="ts">
  /*
   * Matter overview — the landing under the matter header: the key facts as a ledger
   * definition list, the description when there is one, and honest placeholder tiles for the
   * figures that accrue once time, trust, and activity flow ("Soon", never fake numbers).
   * Status is displayed as a fact and never gates content — every section renders the same
   * for a prospective, open, or closed matter.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as Card from "@magna-carta/design-system/card";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import type { MatterFixture } from "$lib/matters/fixtures.ts";

  let { data }: { data: { matter: MatterFixture } } = $props();

  const matter = $derived(data.matter);

  const STATUS_LABEL: Record<MatterFixture["status"], string> = {
    prospective: "Prospective",
    open: "Open",
    closed: "Closed",
  };

  interface KeyFact {
    label: string;
    value: string;
  }

  /* Null facts are omitted rather than rendered as gaps; the matter number is the one null
   * with a meaning of its own (a consultation is unnumbered by design), so it states that. */
  const keyFacts: KeyFact[] = $derived.by(() => {
    const facts: KeyFact[] = [
      { label: "Matter number", value: matter.matterNumber ?? "Unnumbered — consultation" },
      { label: "Status", value: STATUS_LABEL[matter.status] },
    ];
    if (matter.matterTypeName) {
      facts.push({ label: "Matter type", value: matter.matterTypeName });
    }
    if (matter.locationName) {
      facts.push({ label: "Location", value: matter.locationName });
    }
    if (matter.responsibleAttorneyName) {
      facts.push({ label: "Responsible attorney", value: matter.responsibleAttorneyName });
    }
    if (matter.clientDisplayName) {
      facts.push({
        label: "Client",
        value: matter.clientCode
          ? `${matter.clientDisplayName} (${matter.clientCode})`
          : matter.clientDisplayName,
      });
    }
    if (matter.openedAt) {
      facts.push({ label: "Opened", value: formatDate(matter.openedAt) });
    }
    if (matter.closedAt) {
      facts.push({ label: "Closed", value: formatDate(matter.closedAt) });
    }
    // Unknown is not the same as "not enabled" — a matter read from the API does not carry the
    // setting, and stating it either way would be inventing the answer.
    if (matter.eBilling !== null) {
      facts.push({ label: "E-billing", value: matter.eBilling ? "Enabled" : "Not enabled" });
    }
    return facts;
  });

  /* The figures that accrue against a matter once their surfaces ship — placeholders only. */
  const ACCRUAL_TILES = [
    { label: "Unbilled time" },
    { label: "Trust balance" },
    { label: "Recent activity" },
  ];
</script>

<svelte:head>
  <title>{matter.title} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col gap-32">
  <section class="flex flex-col gap-16">
    <h2
      class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      Key facts
    </h2>
    <dl class="grid grid-cols-1 gap-x-32 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
      {#each keyFacts as fact (fact.label)}
        <div class="flex flex-col gap-4">
          <dt
            class="text-xs text-text-muted uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            {fact.label}
          </dt>
          <dd class="text-sm">{fact.value}</dd>
        </div>
      {/each}
    </dl>
  </section>

  {#if matter.description}
    <section class="flex flex-col gap-16">
      <h2
        class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Description
      </h2>
      <p class="max-w-xl text-sm">{matter.description}</p>
    </section>
  {/if}

  <div class="grid grid-cols-1 gap-16 sm:grid-cols-3">
    {#each ACCRUAL_TILES as tile (tile.label)}
      <Card.Root>
        <Card.Content class="flex flex-col gap-12">
          <div class="flex items-baseline justify-between gap-8">
            <span
              class="text-xs text-text-muted uppercase"
              style="letter-spacing: var(--mc-tracking-caps)"
            >
              {tile.label}
            </span>
            <Badge variant="neutral">Soon</Badge>
          </div>
          <Skeleton class="h-20 w-96" />
          <Skeleton class="h-12 w-64" />
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
</div>
