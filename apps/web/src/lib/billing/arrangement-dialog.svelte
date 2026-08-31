<script lang="ts">
  /*
   * The fee arrangement, in full.
   *
   * The strip above the ledger states the two facts a reader needs at a glance — which version is
   * in force, and since when. Everything else about the arrangement lives behind this: what it is
   * billed as, what its terms actually say, and every version that governed before this one.
   *
   * THE HISTORY IS APPEND-ONLY AND IS PRESENTED THAT WAY. Every bill records the version it was
   * composed under, so the version it was composed under has to still exist. A version is never
   * edited; an amendment is a new one, and the old one keeps the dates it governed.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import Button from "@magna-carta/design-system/button";
  import { formatDate } from "@magna-carta/design-system/data-table";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import type { ArrangementRecord } from "./billing-api.ts";
  import { ARRANGEMENT_KIND_LABELS, arrangementTerms } from "./fee-agreement.ts";

  let {
    open = $bindable(false),
    arrangement,
    matterTitle,
    matterNumber,
    money,
    canAmend,
    amendRefusal,
    onAmend,
  }: {
    open?: boolean;
    arrangement: ArrangementRecord | null;
    matterTitle: string;
    matterNumber: string | null;
    money: (amountMinor: number) => string;
    canAmend: boolean;
    /** Why amending is refused, where it is. */
    amendRefusal: string;
    onAmend: () => void;
  } = $props();

  const inForce = $derived(arrangement?.inForce ?? null);
  const history = $derived(arrangement?.history ?? []);
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} class="max-w-2xl">
    <Dialog.Title>Fee Arrangement</Dialog.Title>
    <Dialog.Description>
      {matterNumber === null ? matterTitle : `${matterTitle} · Matter ${matterNumber}`}
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      {#if inForce === null}
        <p class="text-sm text-text-muted">
          Nothing was recorded, and a matter with no arrangement is billed
          {ARRANGEMENT_KIND_LABELS.hourly.toLowerCase()}.
        </p>
      {:else}
        <dl class="flex flex-col gap-4 text-sm">
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Billed As</dt>
            <dd>{ARRANGEMENT_KIND_LABELS[inForce.kind]}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">In Force Since</dt>
            <dd class="tabular-nums">{formatDate(inForce.validFrom)}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Version</dt>
            <dd class="tabular-nums">{inForce.version} of {history.length}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Terms</dt>
            <dd class="text-right">{arrangementTerms(inForce, money)}</dd>
          </div>
        </dl>

        {#if history.length > 1}
          <section class="flex flex-col gap-8 border-t border-border-default pt-12">
            <h3 class="text-xs text-text-subtle uppercase">Versions</h3>
            <ul class="flex flex-col gap-8">
              {#each history as version (version.id)}
                <li class="flex flex-col gap-4 text-sm">
                  <span>
                    Version <span class="tabular-nums">{version.version}</span>:
                    {ARRANGEMENT_KIND_LABELS[version.kind]}
                  </span>
                  <span class="text-xs text-text-muted tabular-nums">
                    {formatDate(version.validFrom)}
                    {version.validTo === null ? "to now" : `to ${formatDate(version.validTo)}`}
                  </span>
                  <span class="text-xs text-text-subtle">{arrangementTerms(version, money)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-8">
      <Button
        variant="secondary"
        disabled={!canAmend}
        title={canAmend
          ? "Record an amendment as a new version. The version in force stays on the record with the dates it governed."
          : amendRefusal}
        onclick={onAmend}
      >
        <SquarePen class="size-16" aria-hidden="true" />
        Amend
      </Button>
      <Button onclick={() => (open = false)}>Close</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
