<script lang="ts">
  /*
   * Where one matter stands on conflicts — the Record Detail archetype over a read that is computed
   * from the log every time it is asked and stores nothing.
   *
   * A matter is not checked once. Its party set moves, and so does the firm's corpus underneath it,
   * so this page answers three questions a single check cannot: what the last search found that
   * nobody has answered, what the firm's CURRENT policy requires that the last search did not run,
   * and what has changed in the firm's records since that would have changed its answer.
   *
   * A MATTER WITH NO CHECK IS NOT AN ERROR AND IS NOT AN EMPTY RESULT. The read deliberately does
   * not 404 on an unknown matter, because that would make "never checked" and "no such matter" the
   * same answer; this page keeps them apart the same way.
   *
   * RE-RUNNING IS AN ACT, NOT A REFRESH. The runner sits below the standing rather than as a button
   * beside it: a re-check is a new search under a scope somebody chose, and it writes a new entry in
   * the firm's append-only log.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import BackLink from "$lib/navigation/back-link.svelte";
  import Button from "@magna-carta/design-system/button";
  import Separator from "@magna-carta/design-system/separator";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import CheckRunner from "$lib/conflicts/check-runner.svelte";
  import PosturePanel from "$lib/conflicts/posture-panel.svelte";
  import {
    readMatterConflictsPosture,
    READ_CONFLICTS_PERMISSION,
    type MatterConflictsPosture,
  } from "$lib/conflicts/conflicts-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { resolveMatterRecord, type MatterRecord } from "$lib/matters/matter-record.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  /** The register this standing was opened from, and where the way out leads. */
  const CONFLICTS_HREF = "/conflicts";

  const matterId = $derived(page.params.matterId ?? "");

  let posture = $state<MatterConflictsPosture | null>(null);
  let matter = $state<MatterRecord | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);
  let session = $state<SessionBootstrap | null>(null);

  async function read(): Promise<void> {
    loading = true;
    const outcome = await readMatterConflictsPosture(fetch, matterId);
    loading = false;
    if (outcome.kind === "ok") {
      posture = outcome.value;
      failure = null;
      return;
    }
    posture = null;
    failure = stated(
      outcome.failure,
      "The matter's conflicts standing could not be read.",
      "The matter's conflicts standing could not be reached.",
    );
  }

  $effect(() => {
    const asked = matterId;
    if (asked === "") return;
    void read();
    void firmRoster.load(fetch);
    void (async () => {
      // The matter's own name, so the page says what it is about rather than printing a handle.
      // An identifier nothing names still reads: the standing is the subject, not the title.
      matter = (await resolveMatterRecord(fetch, asked)) ?? null;
    })();
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const permissions = $derived(session?.permissions ?? null);
  const mayRead = $derived(permissions === null || permissions.includes(READ_CONFLICTS_PERMISSION));
  const matterLabel = $derived.by(() => {
    if (matter === null) return null;
    // A consultation's tentative number counts here too: a check run at intake is filed under it.
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  });
</script>

<svelte:head>
  <title>Conflicts Standing · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <!-- The eyebrow that named the screen this check was opened from now RETURNS to it: one line
         in the eyebrow register, doing the work of two. One link back to the register is not a
         breadcrumb trail, so the landmark is named for what it is. -->
    <nav aria-label="Back to Conflicts Check" class="flex">
      <BackLink href={CONFLICTS_HREF} label="Conflicts Check" />
    </nav>
    <Masthead.Title>Where This Matter Stands</Masthead.Title>
    <Masthead.Meta>
      <span>{matterLabel ?? "The matter is not named"}</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    {#if matter !== null}
      <Button variant="secondary" href="/matters/{matterId}">Open the matter</Button>
    {/if}
  </Masthead.Actions>
</Masthead.Root>

{#if session !== null && !mayRead}
  <Alert.Root variant="info" class="mb-16">
    <Alert.Title>Reading Conflicts Is Not Available To This Account</Alert.Title>
    <Alert.Description>
      Reading a matter's conflicts standing needs the conflicts:read permission, which this account
      does not hold.
    </Alert.Description>
  </Alert.Root>
{/if}

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="The Standing Could Not Be Read"
    fallback={failure.fallback}
    whenSilent={failure.whenSilent}
    onRetry={() => void read()}
  />
{:else}
  <div class="flex max-w-3xl flex-col gap-24">
    <PosturePanel
      {posture}
      {loading}
      {memberNames}
      checkHref={(checkId) => `/conflicts/checks/${checkId}`}
    >
      {#snippet actions()}
        <Button variant="secondary" href="#conflicts-run">
          <ShieldAlert class="size-16" aria-hidden="true" />
          Run a check for this matter
        </Button>
      {/snippet}
    </PosturePanel>

    <Separator />

    <section id="conflicts-run" class="flex flex-col gap-16">
      <h2 class="text-base font-semibold">Run A Check For This Matter</h2>
      <CheckRunner
        {matterId}
        matterLabel={matterLabel ?? matterId}
        {permissions}
        onRan={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
      />
    </section>
  </div>
{/if}
