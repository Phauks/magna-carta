<script lang="ts">
  /*
   * Matter overview — the landing under the matter header: the key facts as a ledger
   * definition list, the description when there is one, the matter's next thirty days (the one
   * calendar component with this matter's scope, headless and capped), and honest placeholder
   * tiles for the figures that accrue once time and trust flow ("Soon", never fake numbers).
   * Status is displayed as a fact and never gates content — every section renders the same
   * for a prospective, open, or closed matter.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import EntityIdentity, { type EntityKind } from "@magna-carta/design-system/entity-identity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ActivityRegister from "$lib/activity/activity-register.svelte";
  import { entityKindFromIdentifier } from "$lib/directory/directory-api.ts";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import { CalendarView } from "$lib/calendar/index.ts";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { matterStatusLabel } from "$lib/matters/matter-status.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);

  interface KeyFact {
    label: string;
    value: string;
    /**
     * The directory record this fact names, where it names one; the value then opens it. Carried
     * only when the handle's kind can be read: a handle nobody can classify is shown as the name
     * alone, because the dashed mark would say something about the record that is only true of
     * the identifier.
     */
    entity?: { id: string; kind: EntityKind };
  }

  /* Null facts are omitted rather than rendered as gaps; the matter number is the one null with a
   * meaning of its own. A consultation has a number — its own, tentative one — so the fact names
   * which sequence the number came from rather than presenting it as a matter number. */
  const clientEntity = $derived.by((): { id: string; kind: EntityKind } | null => {
    const id = matter.clientEntityId;
    if (id === null) return null;
    const kind = entityKindFromIdentifier(id);
    return kind === null ? null : { id, kind };
  });

  const keyFacts: KeyFact[] = $derived.by(() => {
    const facts: KeyFact[] = [
      matter.matterNumber !== null
        ? { label: "Matter number", value: matter.matterNumber }
        : {
            label: "Consultation number",
            value: matter.consultationNumber ?? "Unnumbered — consultation",
          },
      // The word comes from the product's one status register, so this page, the header and the
      // docket cannot end up calling the same matter three things.
      { label: "Status", value: matterStatusLabel(matter.status) },
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
        // The client is a directory record where the matter links one; the fact then opens it.
        // A matter that carries only a display name shows the name and nothing to open.
        ...(clientEntity === null ? {} : { entity: clientEntity }),
      });
    }
    if (matter.openedAt) {
      facts.push({ label: "Opened", value: formatDate(matter.openedAt) });
    }
    if (matter.closedAt) {
      facts.push({ label: "Closed", value: formatDate(matter.closedAt) });
    }
    // Absent, not false: the matter read does not carry this yet, and "Not enabled" would assert
    // something about the firm's billing setup that nothing here has established.
    if (matter.eBilling !== null) {
      facts.push({ label: "E-billing", value: matter.eBilling ? "Enabled" : "Not enabled" });
    }
    return facts;
  });

  /* The figures that accrue against a matter once their surfaces ship — placeholders only. */
  const ACCRUAL_TILES = [{ label: "Unbilled time" }, { label: "Trust balance" }];

  const isSample = $derived(matter.source === "sample");
  /** The next thirty days on this matter, six rows deep; the Calendar section has the rest. */
  const COMING_UP_DAYS = 30;
  const COMING_UP_ROWS = 6;
</script>

<svelte:head>
  <title>{matter.title} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col gap-32">
  <section class="flex flex-col gap-16">
    <FieldLabel as="h2" class="border-b border-border-strong pb-8"
    >
      Key facts
    </FieldLabel>
    <dl class="grid grid-cols-1 gap-x-32 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
      {#each keyFacts as fact (fact.label)}
        <div class="flex flex-col gap-4">
          <FieldLabel as="dt"
          >
            {fact.label}
          </FieldLabel>
          <dd class="text-sm">
            {#if fact.entity !== undefined}
              <EntityIdentity
                kind={fact.entity.kind}
                name={fact.value}
                href={entityRecordHref(fact.entity.id)}
              />
            {:else}
              {fact.value}
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  {#if matter.description}
    <section class="flex flex-col gap-16">
      <FieldLabel as="h2" class="border-b border-border-strong pb-8"
      >
        Description
      </FieldLabel>
      <p class="max-w-xl text-sm">{matter.description}</p>
    </section>
  {/if}

  <div class="grid grid-cols-1 gap-16 sm:grid-cols-3">
    <Card.Root>
      <Card.Header class="flex flex-row items-baseline justify-between gap-8">
        <Card.Title>Coming up</Card.Title>
        <Button variant="ghost" size="sm" href="/matters/{matter.id}/calendar?view=agenda">
          Calendar
        </Button>
      </Card.Header>
      <Card.Content>
        <CalendarView
          scope={{ kind: "matter", matterId: matter.id }}
          view="agenda"
          anchor={todayCivil()}
          toolbar={false}
          agendaDays={COMING_UP_DAYS}
          limit={COMING_UP_ROWS}
        />
      </Card.Content>
    </Card.Root>
    {#each ACCRUAL_TILES as tile (tile.label)}
      <Card.Root>
        <Card.Content class="flex flex-col gap-12">
          <div class="flex items-baseline justify-between gap-8">
            <FieldLabel as="span"
            >
              {tile.label}
            </FieldLabel>
            <Badge variant="neutral">Soon</Badge>
          </div>
          <Skeleton class="h-20 w-96" />
          <Skeleton class="h-12 w-64" />
        </Card.Content>
      </Card.Root>
    {/each}
  </div>

  <!-- The newest of everything recorded on the matter: the one activity register with a row budget,
       so what the Overview shows is what the Activity section shows, and nothing is summarised
       twice. The whole chronology is one step away. -->
  <section class="flex flex-col gap-16">
    <div class="flex items-baseline justify-between gap-8 border-b border-border-strong pb-8">
      <FieldLabel as="h2">
        Recent activity
      </FieldLabel>
      <a href={`/matters/${matter.id}/activity`} class="text-sm underline">See all activity</a>
    </div>
    <ActivityRegister
      matterId={matter.id}
      matterTitle={matter.title}
      {isSample}
      variant="recent"
      limit={8}
    />
  </section>
</div>
