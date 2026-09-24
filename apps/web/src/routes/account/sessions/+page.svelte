<script lang="ts">
  /*
   * Account · Active Sessions — every device signed in to this account, and the way to end any of
   * them from here.
   *
   * ITS OWN SECTION, not a row under Security, because it is the only part of the account surface
   * that is a LIST rather than a setting: a row per device, each with its own action, and a
   * count that changes on its own between visits. It was a `Manage…` seam on Security while there
   * was nothing behind it; a section is what it is now that there is.
   *
   * THE READING IS THE FEATURE. Somebody opens this screen for one reason — to find out whether
   * anybody else is signed in as them — so every caption is a fact the row knows: it never shows a
   * "last active" stamp it cannot stand behind, and it never fills a gap with a sentence about our
   * own plumbing ($lib/account/active-sessions.ts holds both rulings). The standing notice about
   * the few minutes a revoked device keeps working came off with the account surface's other
   * explanatory small text; the remedy it pointed at is a control now, on Account -> Security.
   *
   * THIS DEVICE HAS NO SIGN OUT BUTTON. Ending the session you are reading on is signing out, and
   * signing out lives in the profile menu; a second door to it here would be one that navigates the
   * screen out from under itself. Worth knowing when writing about this screen: that menu is NOT on
   * this page — the account surface renders in the Secure Shell, whose chrome band carries only the
   * brand mark and Close (secure-shell.svelte) — so the way back to it is Close first.
   *
   * Every call goes through the Better Auth client ($lib/auth/client.ts); listing and revoking are
   * its own /list-sessions and /revoke-session routes, which are scoped to the caller's own account
   * server-side — a token belonging to somebody else is answered as though it were revoked, so
   * nothing here can be used to probe another account's sessions.
   */
  import { onMount } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import {
    activeSessionRows,
    canEndIndividualSessions,
    otherDeviceRows,
    REVOKE_FAILED,
    SESSIONS_UNAVAILABLE,
    signedOutElsewhereMessage,
    THIS_DEVICE,
    type ActiveSessionRecord,
    type ActiveSessionRow,
  } from "$lib/account/active-sessions.ts";
  import { authClient } from "$lib/auth/client.ts";

  let rows = $state<ActiveSessionRow[]>([]);
  let loading = $state(true);
  // A failed read is its own state rather than an empty list: "nobody is signed in" and "we could
  // not find out" are opposite answers to the question this screen is asked.
  let unavailable = $state(false);
  // The token being revoked, so exactly one row shows the pending posture — not every row.
  let revoking = $state<string | null>(null);
  let revokingOthers = $state(false);

  let others = $derived(otherDeviceRows(rows));
  // False when this device could not be identified among the rows: every per-row Sign out is then a
  // button that might end the session pressing it, so none is offered. "Sign out everywhere else"
  // stays, because the server resolves "else" from the request rather than from this screen.
  let canEndOne = $derived(canEndIndividualSessions(rows));

  async function load(): Promise<void> {
    loading = true;
    unavailable = false;
    try {
      // Two reads, in parallel: the list, and the current session — whose token is what marks one
      // row as this device. A current session that will not resolve is not a failure of the list;
      // it costs the "This device" badge and nothing else (activeSessionRows takes a null token).
      const [listed, current] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      if (listed.error || !listed.data) {
        unavailable = true;
        return;
      }
      const currentToken = current.data?.session.token ?? null;
      rows = activeSessionRows(listed.data satisfies readonly ActiveSessionRecord[], currentToken);
    } catch {
      unavailable = true;
    } finally {
      loading = false;
    }
  }

  async function signOutDevice(row: ActiveSessionRow): Promise<void> {
    if (revoking !== null || revokingOthers) return;
    revoking = row.token;
    let revoked = false;
    try {
      const { error } = await authClient.revokeSession({ token: row.token });
      revoked = !error;
    } catch {
      revoked = false;
    }
    revoking = null;
    if (!revoked) {
      toast.error(REVOKE_FAILED);
      return;
    }
    toast.success(`Signed out of ${row.device}.`);
    // Re-read rather than splicing the row out: the server is the record of which sessions exist,
    // and a list edited locally would quietly diverge from it the first time a revocation half-took.
    await load();
  }

  async function signOutEverywhereElse(): Promise<void> {
    if (revokingOthers || revoking !== null) return;
    // Only a count this screen can stand behind: with no row marked as this device, it does not
    // know which of the rows it listed were somebody else's.
    const count = canEndOne ? others.length : null;
    revokingOthers = true;
    let revoked = false;
    try {
      const { error } = await authClient.revokeOtherSessions();
      revoked = !error;
    } catch {
      revoked = false;
    }
    revokingOthers = false;
    if (!revoked) {
      toast.error(REVOKE_FAILED);
      return;
    }
    toast.success(signedOutElsewhereMessage(count));
    await load();
  }

  // Read once when the screen opens. The list is re-read after every revocation rather than polled:
  // a session appearing is not an event this screen can learn about, and a ticking read of the
  // account's sessions is a request every few seconds for a page somebody looks at for a minute.
  onMount(() => {
    void load();
  });
</script>

<svelte:head>
  <title>Active Sessions · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Active Sessions" />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    {#if loading}
      <p class="text-sm text-text-muted">Reading your signed-in devices…</p>
    {:else if unavailable}
      <EmptyState title="Your devices could not be listed">
        {SESSIONS_UNAVAILABLE}
        {#snippet actions()}
          <Button variant="secondary" onclick={() => void load()}>Try again</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <section class="flex flex-col gap-12">
        <div class="flex items-center justify-between gap-16">
          <h3 class="text-sm font-medium">
            {rows.length === 1 ? "1 signed-in device" : `${rows.length} signed-in devices`}
          </h3>
          <!-- Destructive because it ends sessions somebody else may be holding; disabled when
               this device is the only one, so the control never promises an act with no subject. -->
          <Button
            variant="destructive"
            size="sm"
            disabled={(canEndOne && others.length === 0) || revokingOthers || revoking !== null}
            onclick={() => void signOutEverywhereElse()}
          >
            {revokingOthers ? "Signing out…" : "Sign out everywhere else"}
          </Button>
        </div>

        {#if !canEndOne}
          <!-- Said out loud rather than left as an absence of buttons: a reader who expects to end
               one device and finds no way to should learn why, and that the one control still on
               the screen does something they can rely on. -->
          <p class="text-xs text-text-muted">
            This device could not be identified among the sessions below, so individual sign-out is
            unavailable — ending one might end the session you are reading on. Sign out everywhere
            else still works, and never ends this session.
          </p>
        {/if}

        <ul
          class="flex flex-col divide-y divide-border-default border-y border-border-strong"
        >
          {#each rows as row (row.token)}
            <li class="flex items-center justify-between gap-16 py-12">
              <div class="flex min-w-0 flex-col gap-4">
                <div class="flex items-center gap-8">
                  <span class="truncate text-sm font-medium">{row.device}</span>
                  {#if row.isCurrent}
                    <Badge variant="neutral">{THIS_DEVICE}</Badge>
                  {/if}
                </div>
                <p class="text-xs text-text-muted">
                  <!-- Signed in, never "last active": the row's updatedAt is a refresh stamp, not a
                       last-seen one (the reasoning is in $lib/account/active-sessions.ts). -->
                  Signed in
                  <time datetime={instantAttribute(row.signedInAt)}>
                    {formatInstant(row.signedInAt)}
                  </time>
                  <!-- The address only where the request carried one: a clause naming its own
                       absence tells a reader about our plumbing, not about their device. -->
                  {#if row.ipAddress !== null}· {row.ipAddress}{/if}
                  · expires
                  <time datetime={instantAttribute(row.expiresAt)}>
                    {formatInstant(row.expiresAt)}
                  </time>
                </p>
              </div>
              {#if !row.isCurrent && canEndOne}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={revoking !== null || revokingOthers}
                  aria-label="Sign out of {row.device}"
                  onclick={() => void signOutDevice(row)}
                >
                  {revoking === row.token ? "Signing out…" : "Sign out"}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>
