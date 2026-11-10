<script lang="ts">
  /*
   * Writing a post. The order of the fields is the board's first confidentiality control: the
   * composer asks which part of the software the post is about before anything is written, and
   * there is no general area to pick.
   *
   * The notice is shown until the member dismisses it for good — once, not on every post, because
   * a notice on every post is read for a week and then not at all. Text that looks like a case
   * name, a docket or matter number, an email address, a phone number or an amount beside a name
   * is highlighted while it can still be edited; the server runs the same detector and holds the
   * post for a human if any of it is still there. "Send to Support Instead" is on the panel itself,
   * because a notice that says a question is in the wrong place has to offer the right one.
   *
   * There are no attachments: a screenshot of a firm's own data is the likeliest leak on a board
   * like this, and an image defeats every text-based control at once.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import LifeBuoy from "@lucide/svelte/icons/life-buoy";
  import {
    detectConfidentialDetail,
    FINDING_LABELS,
  } from "@magna-carta/community/confidentiality-detector";
  import {
    BODY_MAX_LENGTH,
    PRODUCT_AREAS,
    TITLE_MAX_LENGTH,
    type PostKind,
  } from "@magna-carta/community/vocabulary";

  let {
    open = $bindable(false),
    kind = $bindable<PostKind>("request"),
    category = $bindable<string | null>(null),
    title = $bindable(""),
    body = $bindable(""),
    noticeDismissed = $bindable(false),
    displayName,
    onPost,
    onSendToSupport,
  }: {
    open?: boolean;
    kind?: PostKind;
    category?: string | null;
    title?: string;
    body?: string;
    noticeDismissed?: boolean;
    /** The name this post will carry. Never the firm. */
    displayName: string;
    onPost?: () => Promise<ActionOutcome>;
    onSendToSupport?: () => void;
  } = $props();

  const findings = $derived(detectConfidentialDetail(body));
  const titleFindings = $derived(detectConfidentialDetail(title));
  const flagged = $derived([...titleFindings, ...findings]);
  const refusal = $derived(
    category === null
      ? "Which part of the software this is about."
      : title.trim().length < 8
        ? "A title of at least eight characters."
        : body.trim() === ""
          ? "Some detail."
          : undefined,
  );

  const flaggedSummary = $derived(
    [...new Set(flagged.map((finding) => FINDING_LABELS[finding.kind]))].join(" and "),
  );
</script>

<ActionDialog
  bind:open
  heading={kind === "request" ? "New Request" : "New Question"}
  commitLabel={kind === "request" ? "Post Request" : "Post Question"}
  commitBusyLabel="Posting"
  commitRefusal={refusal}
  unsavedChanges={title.trim() !== "" || body.trim() !== ""}
  width="wide"
  onCommit={onPost ?? (async () => "refused")}
>
  {#snippet notice()}
    {#if !noticeDismissed}
      <Alert.Root variant="warning">
        <p>
          <strong>This board is about the software.</strong> Do not include client names, matter
          numbers, ledger balances, party names, or screenshots of your own data. A question that needs
          those belongs in support, where it stays confidential.
        </p>
        <p class="text-xs">
          ABA Formal Opinion 511 holds that a post can breach confidentiality even in hypothetical form,
          where a reader could infer the client or the situation.
        </p>
        <div>
          <Button variant="secondary" size="sm" onclick={() => (noticeDismissed = true)}>
            Understood, Do Not Show Again
          </Button>
        </div>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-20">
      <fieldset class="flex flex-col gap-8" disabled={busy}>
        <legend class="pb-8 text-sm font-semibold">Which part of the software is this about?</legend>
        <div class="flex flex-wrap gap-8">
          {#each PRODUCT_AREAS as area (area.slug)}
            <button
              type="button"
              aria-pressed={category === area.slug}
              onclick={() => (category = area.slug)}
              class="rounded-full border border-border-default bg-surface-default px-12 py-4 text-sm hover:border-border-strong aria-pressed:border-action-primary aria-pressed:bg-surface-selected aria-pressed:font-semibold"
            >
              {area.label}
            </button>
          {/each}
        </div>
      </fieldset>

      <div class="flex flex-col gap-8">
        <Label id="community-kind-label">Kind</Label>
        <RadioGroup.Root
          aria-labelledby="community-kind-label"
          bind:value={kind}
          disabled={busy}
          class="flex gap-24"
        >
          <label class="flex items-center gap-8 text-sm">
            <RadioGroup.Item value="request" /> Request
            <span class="text-text-subtle">something new, others can vote</span>
          </label>
          <label class="flex items-center gap-8 text-sm">
            <RadioGroup.Item value="question" /> Question
            <span class="text-text-subtle">how to do something today</span>
          </label>
        </RadioGroup.Root>
      </div>

      <label class="flex flex-col gap-8">
        <span class="text-sm font-semibold">Title</span>
        <Input bind:value={title} maxlength={TITLE_MAX_LENGTH} disabled={busy} />
      </label>

      <label class="flex flex-col gap-8">
        <span class="flex items-baseline justify-between text-sm font-semibold">
          Details
          <span class="text-xs font-normal text-text-subtle">Text, lists and code only. Images and files are off.</span>
        </span>
        <Textarea bind:value={body} maxlength={BODY_MAX_LENGTH} rows={6} disabled={busy} />
      </label>

      {#if flagged.length > 0}
        <Alert.Root variant="warning">
          <p>
            This looks like it includes {flaggedSummary}:
            {#each flagged as finding, index (finding.start + finding.kind)}
              <mark class="rounded-sm bg-status-warning-subtle px-4 font-semibold text-status-warning-subtle-foreground"
                >{finding.text}</mark
              >{index < flagged.length - 1 ? ", " : ""}
            {/each}. Remove it, or send this to support instead. If you post it anyway, it will be held
            until the Magna Carta team has read it.
          </p>
        </Alert.Root>
      {/if}

      <p class="text-xs text-text-subtle">
        Publicly readable, not indexed by search engines. Posting as <strong class="text-text-default"
          >{displayName}</strong
        >; your firm is never shown. You can delete this post instantly at any time.
      </p>
      <div>
        <Button variant="secondary" size="sm" onclick={onSendToSupport} disabled={busy}>
          <LifeBuoy class="size-16" aria-hidden="true" />
          Send to Support Instead
        </Button>
      </div>
    </div>
  {/snippet}
</ActionDialog>
