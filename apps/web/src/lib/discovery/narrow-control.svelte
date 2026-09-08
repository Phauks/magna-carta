<script lang="ts">
  /*
   * The ONE place a review set's documents are narrowed, rendered entirely from the criteria
   * registry.
   *
   * Where several mechanisms narrow one list they sit behind one control, because from where a
   * reader sits they answer one question — and answering it in three places is how somebody ends up
   * staring at an empty table with a filter set on a control they are not looking at. That standing
   * ruling is why the classic faceted rail down the side of a review screen is not here: every
   * narrowing a review set offers is a property of a row, and this is the control that sets them.
   *
   * A CRITERION NOBODY SERVES YET RENDERS, DISABLED, WITH ITS LINE. Keyword narrowing, a date range,
   * coding state and near-duplicate clusters are all declared in criteria.ts and none is served
   * today. Omitting them would leave a reader to discover the shape of the finished control by
   * being surprised later; showing them says what this corpus will be askable and what each one
   * waits on. It is also what makes lighting one up a stage flip rather than a redesign.
   *
   * A CRITERION SET SOMEWHERE ELSE RENDERS TOO, SAYING WHERE. Two of them are: a family is named by
   * opening a document, and the name search is the screen's own search field, which is the
   * product's one control for searching within a screen and lives in the action row beside this
   * one. They still appear here, with the line their `setFrom` gives them and the way to clear
   * them, because this is the ONE control that answers "why is this list short" — and a reason
   * missing from it is exactly the empty table with a filter set on a control nobody is looking at.
   *
   * THE CONTROL SAYS HOW MANY ARE SET, AND THERE IS ONE WAY TO EMPTY IT — visible, not only on a
   * key. A keyboard way out is not an affordance: nothing advertises it, and a pointer user is left
   * to work it out.
   */
  import * as Popover from "@magna-carta/design-system/popover";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Badge from "@magna-carta/design-system/badge";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import {
    CRITERIA_PROVIDERS,
    criteriaCount,
    providerIsBuilt,
    withCriterion,
    type CriteriaContext,
    type CriteriaSet,
  } from "./criteria.ts";

  let {
    criteria,
    context,
    onChange,
  }: {
    criteria: CriteriaSet;
    context: CriteriaContext;
    onChange: (next: CriteriaSet) => void;
  } = $props();

  const setCount = $derived(criteriaCount(criteria));

  function set(key: string, value: string): void {
    onChange(withCriterion(criteria, key, value));
  }

  function clearEverything(): void {
    onChange({});
  }
</script>

<Popover.Root>
  <!-- The trigger IS the button. The design system's Popover.Trigger is a pass-through with no look
       of its own, so it wears the button recipe directly rather than wrapping a Button inside a
       trigger, which would nest one interactive element in another. -->
  <Popover.Trigger class={buttonClasses({ variant: "ghost", size: "default" })} title="Narrow these documents">
    <ListFilter class="size-16" aria-hidden="true" />
    Narrow
    {#if setCount > 0}
      <Badge variant="info">{setCount}</Badge>
    {/if}
  </Popover.Trigger>

  <Popover.Content align="end" class="flex w-sm flex-col gap-16">
    {#each CRITERIA_PROVIDERS as provider (provider.key)}
      {@const value = criteria[provider.key] ?? ""}
      <div class="flex flex-col gap-8">
        <div class="flex items-center gap-8">
          <Label id="narrow-{provider.key}-label">{provider.label}</Label>
          {#if !providerIsBuilt(provider)}
            <MaturityBadge stage="soon" />
          {/if}
        </div>

        {#if !providerIsBuilt(provider)}
          <!-- Rendered for real and refused, carrying the one sentence the platform says about a
               capability that is designed and not yet served. -->
          <Select.Root type="single" items={[]} disabled>
            <Select.Trigger
              aria-labelledby="narrow-{provider.key}-label"
              title={soonDependencySentence(provider.waitsOn)}
              aria-describedby="narrow-{provider.key}-waiting"
            >
              <Select.Value placeholder={placeholderOf(provider.label)} />
            </Select.Trigger>
          </Select.Root>
          <p id="narrow-{provider.key}-waiting" class="text-text-muted text-sm">
            {soonDependencySentence(provider.waitsOn)}
            It will narrow through {provider.willComposeInto}.
          </p>
        {:else if provider.setFrom !== undefined}
          <!-- Set from its own control, named. No editing control here: one that did nothing would
               be worse than the sentence saying where the real one is. -->
          <p class="text-text-muted text-sm">Set from {provider.setFrom}.</p>
          {#if value !== ""}
            <p class="text-sm">{value}</p>
            <Button variant="ghost" onclick={() => set(provider.key, "")}>Clear</Button>
          {/if}
        {:else if provider.shape.kind === "choice"}
          {@const options = provider.shape.options(context)}
          {#if options.length === 0}
            <!-- A narrowing with nothing to pick from is not a missing control: a review set with
                 no Custodian of Record yet, or no load, has nothing to offer here. A criterion that
                 is never picked from a menu says so through `setFrom` above instead. -->
            <p class="text-text-muted text-sm">Nothing to pick from yet.</p>
          {:else}
            <Select.Root
              type="single"
              items={options.map((option) => ({ value: option.value, label: option.label }))}
              {value}
              onValueChange={(next) => set(provider.key, next)}
            >
              <Select.Trigger aria-labelledby="narrow-{provider.key}-label">
                <Select.Value placeholder={placeholderOf(provider.label)} />
              </Select.Trigger>
              <Select.Content>
                {#each options as option (option.value)}
                  <Select.Item value={option.value} label={option.label} title={option.hint} />
                {/each}
              </Select.Content>
            </Select.Root>
            {#if value !== ""}
              <Button variant="ghost" onclick={() => set(provider.key, "")}>Clear</Button>
            {/if}
          {/if}
        {/if}

        <p class="text-text-muted text-sm">{provider.describes}</p>
      </div>
    {/each}

    {#if setCount > 0}
      <Button variant="ghost" onclick={clearEverything}>Show every document</Button>
    {/if}
  </Popover.Content>
</Popover.Root>
