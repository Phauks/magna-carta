<script lang="ts">
  /*
   * After the bank's own sign-in window: one question, which account in the books each bank account
   * is. One row per account the bank reported, each with the books' bank accounts and Don't Use. A
   * row starts on the account it is already tied to, else on the account whose name ends in the
   * bank's last four digits, else on Don't Use. An account in the books another bank account holds
   * is marked Taken.
   *
   * Save writes only the rows that changed, each with its own key, unties first. A row that fails
   * stops the save there and says so; the rows before it are saved and the screen reads them.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Separator from "@magna-carta/design-system/separator";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { BankBookAccount, BankFeedAccount } from "./banking-api.ts";
  import type { BankingService } from "./banking-service.ts";
  import {
    DONT_USE,
    choicesRefusal,
    connectRowDetail,
    isTakenBy,
    linkChanges,
    preselectedBookAccount,
    type AccountChoice,
  } from "./banking-model.ts";

  let {
    open = $bindable(false),
    institutionName,
    accounts,
    bookAccounts,
    service,
    manageRefusal,
    onSaved,
  }: {
    open?: boolean;
    institutionName: string;
    /** The bank accounts of this one connection. */
    accounts: readonly BankFeedAccount[];
    bookAccounts: readonly BankBookAccount[];
    service: BankingService;
    manageRefusal: string | undefined;
    onSaved: () => void;
  } = $props();

  let chosen = $state<Record<string, string>>({});
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    failure = null;
    chosen = Object.fromEntries(
      accounts.map((account) => [account.id, preselectedBookAccount(account, bookAccounts)]),
    );
  }

  const choices = $derived<readonly AccountChoice[]>(
    accounts.map((account) => ({
      accountId: account.id,
      ledgerAccountId: chosen[account.id] ?? DONT_USE,
    })),
  );
  const changes = $derived(linkChanges(accounts, choices));
  const inWindow = $derived(new Set(accounts.map((account) => account.id)));

  function optionsFor(account: BankFeedAccount): readonly ChoiceOption[] {
    return [
      ...bookAccounts.map((book) => {
        const taken =
          isTakenBy(book, account.id) &&
          book.feedAccountId !== null &&
          !inWindow.has(book.feedAccountId);
        return {
          value: book.ledgerAccountId,
          label: book.name,
          aside: taken ? "Taken" : book.kind === "trust" ? "Trust" : "Operating",
          meaning: taken ? "Another bank account is tied to this account." : undefined,
        };
      }),
      { value: DONT_USE, label: "Don't Use" },
    ];
  }

  const refusal = $derived(manageRefusal ?? choicesRefusal(choices, bookAccounts));

  async function save(): Promise<ActionOutcome> {
    failure = null;
    // One at a time, in order: an untie has to land before the row taking that account is written.
    const outcome = await changes.reduce<Promise<Awaited<ReturnType<BankingService["link"]>> | null>>(
      async (previous, change) => {
        const before = await previous;
        if (before !== null && before.kind !== "ok") return before;
        return service.link(change.accountId, change.ledgerAccountId, crypto.randomUUID());
      },
      Promise.resolve(null),
    );
    if (outcome !== null && outcome.kind !== "ok") {
      failure = stated(
        outcome.failure,
        "This bank account was not saved. Rows above it were.",
        "Couldn't connect. This bank account was not saved.",
      );
      onSaved();
      return "refused";
    }
    onSaved();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  heading={`${institutionName} Is Connected`}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={refusal}
  unsavedChanges={changes.length > 0}
  onOpen={reset}
  onCommit={save}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Couldn't Save"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-12">
      <p class="text-sm text-text-muted">
        Choose which account in Magna Carta each bank account is.
      </p>
      {#each accounts as account, index (account.id)}
        {#if index > 0}<Separator />{/if}
        <div class="grid items-center gap-8 sm:grid-cols-2">
          <span class="flex min-w-0 flex-col">
            <span class="text-sm font-semibold text-text-default">{account.name}</span>
            <span class="text-xs text-text-muted tabular-nums">{connectRowDetail(account)}</span>
          </span>
          <ChoicePicker
            label={`Account for ${account.name}`}
            options={optionsFor(account)}
            disabled={busy || manageRefusal !== undefined}
            title={manageRefusal}
            bind:value={
              () => chosen[account.id] ?? DONT_USE,
              (next) => (chosen = { ...chosen, [account.id]: next })
            }
          />
        </div>
      {/each}
    </div>
  {/snippet}
</ActionDialog>
