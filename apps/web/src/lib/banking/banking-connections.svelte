<script lang="ts">
  /*
   * The banks the firm has connected, under the account cards: who connected each and when it was
   * last read, and a menu for the acts that belong to the whole bank rather than one account. The
   * menu opens on a press only, as every icon-only menu does.
   */
  import * as Card from "@magna-carta/design-system/card";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import Separator from "@magna-carta/design-system/separator";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import LogIn from "@lucide/svelte/icons/log-in";
  import Unlink from "@lucide/svelte/icons/unlink";
  import type { BankConnection } from "./banking-api.ts";
  import BankingBankMark from "./banking-bank-mark.svelte";
  import { readTime, type ReadingOptions } from "./banking-model.ts";

  let {
    connections,
    manageRefusal,
    reading,
    onEditAccounts,
    onReconnect,
    onDisconnect,
  }: {
    connections: readonly BankConnection[];
    manageRefusal: string | undefined;
    reading: ReadingOptions;
    onEditAccounts: (connection: BankConnection) => void;
    onReconnect: (connection: BankConnection) => void;
    onDisconnect: (connection: BankConnection) => void;
  } = $props();

  function detailLine(connection: BankConnection): string {
    const connected = `Connected by ${connection.connectedBy} on ${formatInstantDate(connection.connectedAt, { timeZone: reading.timeZone })}`;
    return connection.lastSyncedAt === null
      ? connected
      : `${connected} · updated ${readTime(connection.lastSyncedAt, reading)}`;
  }
</script>

<section aria-labelledby="banking-banks-heading" class="flex flex-col gap-8">
  <h2 id="banking-banks-heading" class="text-sm font-medium text-text-muted">Banks</h2>
  <Card.Root class="gap-0 py-0">
    {#each connections as connection, index (connection.id)}
      {#if index > 0}<Separator />{/if}
      <div class="flex items-start gap-8 p-12">
        <span class="flex min-w-0 flex-1 flex-col gap-4">
          <span class="flex flex-wrap items-center gap-8">
            <BankingBankMark name={connection.institutionName} logo={connection.institutionLogo} />
            <span class="text-sm font-semibold text-text-default">{connection.institutionName}</span>
            {#if connection.signInNeeded}
              <Badge variant="warning">Sign in again</Badge>
            {:else}
              <Badge variant="success">Working</Badge>
            {/if}
          </span>
          <span class="text-xs text-text-muted">{detailLine(connection)}</span>
        </span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
            aria-label={`More for ${connection.institutionName}`}
            disabled={manageRefusal !== undefined}
            title={manageRefusal}
          >
            <Ellipsis class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {#if connection.signInNeeded}
              <DropdownMenu.Item onSelect={() => onReconnect(connection)}>
                <LogIn class="size-16 shrink-0" aria-hidden="true" />
                Reconnect
              </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Item onSelect={() => onEditAccounts(connection)}>
              <ListChecks class="size-16 shrink-0" aria-hidden="true" />
              Edit Accounts
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => onDisconnect(connection)}>
              <Unlink class="size-16 shrink-0" aria-hidden="true" />
              Disconnect
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/each}
  </Card.Root>
</section>
