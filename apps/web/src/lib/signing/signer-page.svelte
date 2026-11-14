<script lang="ts">
  /*
   * An outside signer's page, from the link they were mailed.
   *
   * IN ORDER, AND NOTHING SKIPPED: a signer who proves who they are with a code is asked for it
   * first; then the electronic-records disclosure is read and agreed to; only then is the document
   * shown, with the signer's own fields over it and a guided walk from one to the next. The server
   * refuses each step out of order as well, so this order is a courtesy and not the guard.
   *
   * THE PAGE OWES THE SIGNER A SENTENCE FOR EVERY WAY IT CANNOT GO ON. A link that expired, a request
   * that was cancelled or declined, a turn that has not come yet: each answers with the server's own
   * title and words, rather than an error.
   *
   * NOTHING HERE IS A MEMBER'S. The route sits outside the signed-in group; every call carries the
   * link and no cookie (./signer-api.ts).
   */
  import { onDestroy } from "svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Info from "@lucide/svelte/icons/info";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Progress from "@magna-carta/design-system/progress";
  import Textarea from "@magna-carta/design-system/textarea";
  import VerificationCodeInput from "@magna-carta/design-system/verification-code-input";
  import { formatInstant, formatInstantDate } from "@magna-carta/design-system/formatters";
  import { SAMPLE_SENTENCE, sampleMatter } from "@magna-carta/design-system/loading-fixtures";
  import AuthPanel from "$lib/auth/auth-panel.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { Failure } from "$lib/api/problem.ts";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import { pointsToScreen } from "$lib/pdf-editor/redactions.ts";
  import AdoptSignatureDialog, { type AdoptedMarks } from "./adopt-signature-dialog.svelte";
  import {
    checkAccessCode,
    declineSigning,
    finishSigning,
    giveConsent,
    openSigning,
    readSigning,
    readSigningDocument,
    sendAccessCode,
    type SignerRequestView,
  } from "./signer-api.ts";
  import {
    MAXIMUM_TEXT_ANSWER,
    answersToSend,
    finishRefusal,
    nextFieldToDo,
    progressOf,
    type SignerField,
  } from "./signer-walk.ts";

  let { token }: { token: string } = $props();

  /** A refusal the server described, said in its own words: the link, the turn, the request. */
  interface Closed {
    readonly title: string;
    readonly sentence: string;
  }

  type Phase =
    | { readonly kind: "reading" }
    | { readonly kind: "closed"; readonly closed: Closed }
    | { readonly kind: "unread"; readonly failure: StatedFailure }
    | { readonly kind: "ready"; readonly view: SignerRequestView }
    | { readonly kind: "finished"; readonly status: "signed" | "declined" };

  let phase = $state<Phase>({ kind: "reading" });
  let gone = false;

  /** A failure the server explained as a closed door, or null where it is a fault to report. */
  function closedBy(failure: Failure): Closed | null {
    const problem = failure.problem;
    if (problem === null || problem === undefined) return null;
    if (![404, 409, 410].includes(problem.status)) return null;
    return {
      title: problem.title ?? "This Link Doesn't Work",
      sentence: problem.detail ?? "Ask the sender for a new link.",
    };
  }

  function settleFailure(failure: Failure, fallback: string): void {
    const closed = closedBy(failure);
    phase = closed === null ? { kind: "unread", failure: stated(failure, fallback) } : { kind: "closed", closed };
  }

  async function read(): Promise<void> {
    const outcome = await readSigning(token);
    if (gone) return;
    if (outcome.kind === "failed") {
      settleFailure(outcome.failure, "Couldn't load the document to sign.");
      return;
    }
    phase = { kind: "ready", view: outcome.value };
  }

  async function begin(): Promise<void> {
    phase = { kind: "reading" };
    // Opening records that the signer looked, and refuses a signer whose turn has not come.
    const opened = await openSigning(token);
    if (gone) return;
    if (opened.kind === "failed") {
      settleFailure(opened.failure, "Couldn't open the document to sign.");
      return;
    }
    await read();
  }

  void begin();

  const view = $derived(phase.kind === "ready" ? phase.view : null);

  /** Whose request this is, kept once read so the header still says so after the signer finishes. */
  let named = $state<{ firmName: string; title: string; senderName: string } | null>(null);
  $effect(() => {
    if (view !== null) named = { firmName: view.firmName, title: view.title, senderName: view.senderName };
  });

  // ---- the code --------------------------------------------------------------------------------

  let codeSentTo = $state<string | null>(null);
  let code = $state("");
  let codeBusy = $state(false);
  let codeFailure = $state<StatedFailure | null>(null);
  let codeWrong = $state(false);

  async function askForCode(): Promise<void> {
    codeBusy = true;
    codeFailure = null;
    const outcome = await sendAccessCode(token);
    codeBusy = false;
    if (outcome.kind === "failed") {
      codeFailure = stated(outcome.failure, "The code wasn't sent.");
      return;
    }
    codeSentTo = outcome.value.sentTo;
  }

  async function enterCode(): Promise<void> {
    if (!/^\d{6}$/u.test(code)) return;
    codeBusy = true;
    codeFailure = null;
    codeWrong = false;
    const outcome = await checkAccessCode(token, code);
    codeBusy = false;
    if (outcome.kind === "failed") {
      if (outcome.failure.problem?.status === 422) {
        codeWrong = true;
        code = "";
        return;
      }
      const closed = closedBy(outcome.failure);
      if (closed !== null) phase = { kind: "closed", closed };
      else codeFailure = stated(outcome.failure, "Couldn't check the code.");
      return;
    }
    await read();
  }

  // ---- the disclosure --------------------------------------------------------------------------

  let agreed = $state(false);
  let consentBusy = $state(false);
  let consentFailure = $state<StatedFailure | null>(null);
  let disclosureShown = $state(false);
  let consentedAt = $state<string | null>(null);

  async function consent(): Promise<void> {
    if (!agreed) return;
    consentBusy = true;
    consentFailure = null;
    const outcome = await giveConsent(token);
    consentBusy = false;
    if (outcome.kind === "failed") {
      consentFailure = stated(outcome.failure, "Your agreement wasn't recorded.");
      return;
    }
    consentedAt = new Date().toISOString();
    await read();
  }

  // ---- the document ----------------------------------------------------------------------------

  type DocumentState =
    | { readonly kind: "idle" }
    | { readonly kind: "reading" }
    | { readonly kind: "failed"; readonly sentence: string }
    | { readonly kind: "shown"; readonly pages: readonly PdfPageSize[] };

  let documentState = $state<DocumentState>({ kind: "idle" });
  let source: PdfDocumentSource | null = null;
  let pageCanvases = $state<(HTMLCanvasElement | null)[]>([]);
  const painted = new Set<number>();
  const ZOOM = 1;

  const walking = $derived(view !== null && !view.needsCode && view.consented);

  $effect(() => {
    if (walking && documentState.kind === "idle") void openDocument();
  });

  async function openDocument(): Promise<void> {
    documentState = { kind: "reading" };
    const outcome = await readSigningDocument(token);
    if (gone) return;
    if (outcome.kind === "failed") {
      documentState = {
        kind: "failed",
        sentence: outcome.failure.problem?.detail ?? "Couldn't load the document. Reload the page to try again.",
      };
      return;
    }
    source = new PdfDocumentSource();
    const refused = await source.open(outcome.value);
    if (gone) return;
    if (refused !== null) {
      documentState = { kind: "failed", sentence: "This browser can't show the document." };
      return;
    }
    pageCanvases = source.pages.map(() => null);
    documentState = { kind: "shown", pages: source.pages };
  }

  async function paint(canvas: HTMLCanvasElement, index: number): Promise<void> {
    if (source === null) return;
    const outcome = await source.render(index, renderDpiFor(ZOOM, window.devicePixelRatio));
    if (gone || "failure" in outcome) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    canvas.width = outcome.page.width;
    canvas.height = outcome.page.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(outcome.page.data), outcome.page.width, outcome.page.height),
      0,
      0,
    );
  }

  $effect(() => {
    pageCanvases.forEach((canvas, index) => {
      if (canvas === null || painted.has(index)) return;
      painted.add(index);
      void paint(canvas, index);
    });
  });

  onDestroy(() => {
    gone = true;
    source?.close();
  });

  // ---- the walk --------------------------------------------------------------------------------

  let answers = $state<Record<string, string | boolean>>({});
  let marks = $state<AdoptedMarks | null>(null);
  let currentId = $state<string | null>(null);
  let adoptOpen = $state(false);
  const fieldElements: Record<string, HTMLElement | null> = $state({});

  const fields = $derived<readonly SignerField[]>(view?.fields ?? []);
  const adopted = $derived(marks !== null || (view?.adopted ?? false));
  const progress = $derived(progressOf(fields, answers, adopted));
  const refusal = $derived(finishRefusal(fields, answers, adopted));
  const needsInitials = $derived(fields.some((field) => field.kind === "initials"));
  const today = $derived(formatInstantDate(new Date().toISOString()));

  function fieldsOn(page: number): SignerField[] {
    return fields.filter((field) => field.page === page + 1);
  }

  function boxOf(field: SignerField, page: PdfPageSize): string {
    const box = pointsToScreen(
      { x0: field.rect[0], y0: field.rect[1], x1: field.rect[2], y1: field.rect[3] },
      page,
      ZOOM,
    );
    return `left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px`;
  }

  function goToNext(): void {
    const next = nextFieldToDo(fields, answers, adopted, currentId);
    if (next === null) return;
    currentId = next.id;
    const element = fieldElements[next.id];
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
    element?.focus({ preventScroll: true });
    if ((next.kind === "signature" || next.kind === "initials") && !adopted) adoptOpen = true;
  }

  function adoptedNow(next: AdoptedMarks): void {
    marks = next;
  }

  // ---- finishing and declining -----------------------------------------------------------------

  let finishBusy = $state(false);
  let finishFailure = $state<StatedFailure | null>(null);

  async function finish(): Promise<void> {
    if (refusal !== null) return;
    finishBusy = true;
    finishFailure = null;
    const outcome = await finishSigning(token, answersToSend(fields, answers));
    finishBusy = false;
    if (outcome.kind === "failed") {
      const closed = closedBy(outcome.failure);
      if (closed !== null && outcome.failure.problem?.status === 410) phase = { kind: "closed", closed };
      else finishFailure = stated(outcome.failure, "Your signature wasn't recorded.");
      return;
    }
    phase = { kind: "finished", status: outcome.value.status };
  }

  let declineOpen = $state(false);
  let declineReason = $state("");
  let declineFailure = $state<StatedFailure | null>(null);

  async function decline(): Promise<ActionOutcome> {
    declineFailure = null;
    const outcome = await declineSigning(token, declineReason.trim());
    if (outcome.kind === "failed") {
      declineFailure = stated(outcome.failure, "Your decline wasn't recorded.");
      return "refused";
    }
    phase = { kind: "finished", status: "declined" };
    return "committed";
  }
</script>

<svelte:head>
  <title>{view === null ? "Sign a Document" : `Sign ${view.title}`}</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

{#snippet closedCard(closed: Closed)}
  <AuthPanel title={closed.title}>
    <p class="text-sm">{closed.sentence}</p>
  </AuthPanel>
{/snippet}

<div class="flex h-dvh min-h-0 flex-col bg-surface-sunken">
  <header class="flex min-h-64 flex-wrap items-center gap-x-16 gap-y-8 border-b border-border-default bg-surface-default px-24 py-8">
    <span class="shrink-0 font-display text-xl text-text-default">{named?.firmName ?? ""}</span>
    {#if named !== null}
      <span class="min-w-0 truncate text-sm text-text-muted">{named.title} · sent by {named.senderName}</span>
    {/if}
    {#if walking && documentState.kind === "shown"}
      <span class="ms-auto flex shrink-0 items-center gap-12 text-sm text-text-muted">
        {progress.done} of {progress.total} fields done
        <Progress class="w-96" value={progress.done} max={Math.max(1, progress.total)} aria-label="Fields done" />
      </span>
      <Button variant="primary" onclick={goToNext} disabled={nextFieldToDo(fields, answers, adopted, currentId) === null}>
        <ArrowRight aria-hidden="true" />Next Field
      </Button>
    {/if}
  </header>

  {#if phase.kind === "ready" && walking}
    <div class="flex items-center gap-8 border-b border-border-default bg-status-info-subtle px-16 py-8 text-sm text-status-info-subtle-foreground">
      <Info class="size-16 shrink-0" aria-hidden="true" />
      <span>
        You agreed to sign electronically{consentedAt === null ? "" : ` at ${formatInstant(consentedAt)}`}.
      </span>
      <Button variant="ghost" size="sm" onclick={() => (disclosureShown = !disclosureShown)}>
        {disclosureShown ? "Hide the Disclosure" : "Read the Disclosure"}
      </Button>
    </div>
    {#if disclosureShown && view !== null}
      <section aria-label={view.consent.title} class="border-b border-border-default bg-surface-default px-16 py-12">
        <div class="mx-auto flex max-w-prose flex-col gap-8 text-sm">
          {#each view.consent.paragraphs as paragraph, index (index)}
            <p>{paragraph}</p>
          {/each}
          <p class="text-text-muted">To withdraw your agreement, decline to sign below.</p>
        </div>
      </section>
    {/if}
  {/if}

  <main class="mc-scrollbar min-h-0 flex-1 overflow-auto p-24">
    <LoadingRegion class="flex w-max min-w-full flex-col items-center" loading={phase.kind === "reading"} label="Reading the document to sign">
      {#snippet fixture()}
        <AuthPanel title={sampleMatter(0).title}>
          <p class="text-sm">{SAMPLE_SENTENCE}</p>
        </AuthPanel>
      {/snippet}

      {#if phase.kind === "closed"}
        {@render closedCard(phase.closed)}
      {:else if phase.kind === "unread"}
        <AuthPanel title="Couldn't Load the Document">
          <FailureNotice failure={phase.failure.failure} fallback={phase.failure.fallback} onRetry={() => void begin()} />
        </AuthPanel>
      {:else if phase.kind === "finished"}
        <AuthPanel title={phase.status === "signed" ? "You Have Signed" : "You Declined to Sign"}>
          <p class="text-sm">
            {phase.status === "signed"
              ? "Your signature is recorded. You'll get a copy of the signed document by email once everyone has signed. You can close this page."
              : "Your decline is recorded and the sender has been told. You can close this page."}
          </p>
        </AuthPanel>
      {:else if view !== null && view.needsCode}
        <AuthPanel title="Confirm It Is You">
          <div class="flex flex-col gap-16">
            <p class="text-sm">
              {view.firmName} asked us to confirm it's you before you sign. We'll email a six-digit code to {view.codeSentTo ?? "your email address"}.
            </p>
            {#if codeFailure !== null}
              <FailureNotice failure={codeFailure.failure} fallback={codeFailure.fallback} />
            {/if}
            {#if codeSentTo === null}
              <Button variant="primary" disabled={codeBusy} onclick={() => void askForCode()}>Email Me a Code</Button>
            {:else}
              <p class="text-sm text-text-muted">The code was sent to {codeSentTo}. It works for ten minutes.</p>
              <div class="flex flex-col gap-8">
                <Label for="signer-access-code">Code</Label>
                <VerificationCodeInput inputId="signer-access-code" bind:value={code} disabled={codeBusy} onComplete={() => void enterCode()} />
              </div>
              {#if codeWrong}
                <Alert.Root variant="warning">
                  <Alert.Description>That code isn't right. Check the latest email and try again.</Alert.Description>
                </Alert.Root>
              {/if}
              <div class="flex gap-8">
                <Button variant="primary" disabled={codeBusy || code.length !== 6} onclick={() => void enterCode()}>Continue</Button>
                <Button variant="ghost" disabled={codeBusy} onclick={() => void askForCode()}>Send a New Code</Button>
              </div>
            {/if}
          </div>
        </AuthPanel>
      {:else if view !== null && !view.consented}
        <AuthPanel title={view.consent.title}>
          <div class="flex flex-col gap-16">
            <p class="text-sm">
              {view.senderName} at {view.firmName} has sent you <span class="font-semibold">{view.title}</span> to sign.
            </p>
            {#if view.message.trim() !== ""}
              <blockquote class="border-s-2 border-border-strong ps-12 text-sm">{view.message}</blockquote>
            {/if}
            <div class="flex max-h-256 flex-col gap-8 overflow-y-auto rounded-md border border-border-default p-12 text-sm mc-scrollbar">
              {#each view.consent.paragraphs as paragraph, index (index)}
                <p>{paragraph}</p>
              {/each}
            </div>
            {#if consentFailure !== null}
              <FailureNotice failure={consentFailure.failure} fallback={consentFailure.fallback} />
            {/if}
            <label class="flex items-start gap-8 text-sm">
              <Checkbox checked={agreed} onCheckedChange={(checked) => (agreed = checked)} disabled={consentBusy} />
              <span>I have read this and agree to use electronic records and signatures.</span>
            </label>
            <div class="flex flex-wrap gap-8">
              <Button variant="primary" disabled={!agreed || consentBusy} onclick={() => void consent()}>Agree and Continue</Button>
              <Button variant="ghost" disabled={consentBusy} onclick={() => (declineOpen = true)}>Decline to Sign</Button>
            </div>
          </div>
        </AuthPanel>
      {:else if view !== null}
        {#if documentState.kind === "failed"}
          <Alert.Root variant="warning" class="max-w-prose">
            <Alert.Title>Couldn't Show the Document</Alert.Title>
            <Alert.Description>{documentState.sentence}</Alert.Description>
          </Alert.Root>
        {:else if documentState.kind === "shown"}
          <div class="flex flex-col items-center gap-24">
            {#each documentState.pages as page, index (index)}
              {@const display = pageDisplaySize(page, ZOOM)}
              <div
                class="relative flex-none border border-border-default bg-surface-raised"
                style="width: {display.width}px; height: {display.height}px"
                aria-label="Page {index + 1} of {documentState.pages.length}"
                role="group"
              >
                <canvas bind:this={pageCanvases[index]} class="pointer-events-none block h-full w-full"></canvas>
                {#each fieldsOn(index) as field (field.id)}
                  {@const current = currentId === field.id}
                  <div class="absolute" style={boxOf(field, page)}>
                    {#if field.kind === "signature" || field.kind === "initials"}
                      {@const mark = field.kind === "signature" ? marks?.signature : marks?.initials}
                      <button
                        type="button"
                        bind:this={fieldElements[field.id]}
                        class="flex h-full w-full items-center justify-center gap-4 overflow-hidden rounded-sm border-2 text-xs {adopted ? 'border-transparent' : 'border-accent-default bg-accent-subtle text-accent-subtle-foreground'} {current ? 'ring-2 ring-accent-default' : ''}"
                        aria-label={adopted ? `Your ${field.kind === "signature" ? "signature" : "initials"}` : field.kind === "signature" ? "Click to sign" : "Click to initial"}
                        onclick={() => {
                          currentId = field.id;
                          if (!adopted) adoptOpen = true;
                        }}
                      >
                        {#if mark}
                          <img src={mark} alt="" class="h-full w-full object-contain" />
                        {:else if adopted}
                          <span class="text-text-muted">Adopted</span>
                        {:else}
                          <PenLine class="size-16 shrink-0" aria-hidden="true" />
                          <span class="truncate">{field.kind === "signature" ? "Click to Sign" : "Initial"}</span>
                        {/if}
                      </button>
                    {:else if field.kind === "text"}
                      <Input
                        bind:ref={
                          () => (fieldElements[field.id] ?? null) as HTMLInputElement | null,
                          (element) => (fieldElements[field.id] = element)
                        }
                        size="sm"
                        class="h-full min-h-0 px-4 {current ? 'border-accent-default' : ''}"
                        aria-label={field.required ? "Required text" : "Optional text"}
                        maxlength={MAXIMUM_TEXT_ANSWER}
                        value={typeof answers[field.id] === "string" ? String(answers[field.id]) : ""}
                        oninput={(event) => (answers = { ...answers, [field.id]: event.currentTarget.value })}
                        onfocus={() => (currentId = field.id)}
                      />
                    {:else if field.kind === "checkbox"}
                      <div
                        bind:this={fieldElements[field.id]}
                        class="flex h-full w-full items-center justify-center rounded-sm {current ? 'ring-2 ring-accent-default' : ''}"
                      >
                        <Checkbox
                          aria-label={field.required ? "Required checkbox" : "Optional checkbox"}
                          checked={answers[field.id] === true}
                          onCheckedChange={(checked) => {
                            currentId = field.id;
                            answers = { ...answers, [field.id]: checked };
                          }}
                        />
                      </div>
                    {:else if field.kind === "date-signed"}
                      <span class="flex h-full w-full items-center rounded-sm border border-dashed border-border-strong px-4 text-xs text-text-default">
                        {today}
                      </span>
                    {:else}
                      <span class="flex h-full w-full items-center rounded-sm border border-dashed border-border-strong px-4 text-xs text-text-default">
                        {view.signerName}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-text-muted" role="status">Opening the document</p>
        {/if}
      {/if}
    </LoadingRegion>
  </main>

  {#if phase.kind === "ready" && walking}
    <footer class="flex flex-wrap items-center gap-12 border-t border-border-default bg-surface-default px-16 py-12">
      <span class="text-sm text-text-muted">Questions about this document? Reply to the email from {phase.view.senderName}.</span>
      {#if finishFailure !== null}
        <FailureNotice failure={finishFailure.failure} fallback={finishFailure.fallback} />
      {/if}
      <span class="ms-auto flex items-center gap-8">
        {#if refusal !== null}<span class="text-xs text-text-muted">{refusal}</span>{/if}
        <Button variant="secondary" disabled={finishBusy} onclick={() => (declineOpen = true)}>Decline to Sign</Button>
        <Button variant="primary" disabled={refusal !== null || finishBusy} onclick={() => void finish()}>
          {finishBusy ? "Finishing" : "Finish"}
        </Button>
      </span>
    </footer>
  {/if}
</div>

{#if view !== null}
  <AdoptSignatureDialog
    bind:open={adoptOpen}
    {token}
    signerName={view.signerName}
    {needsInitials}
    onAdopted={adoptedNow}
  />
{/if}

<ActionDialog
  bind:open={declineOpen}
  kind="destructive"
  heading="Decline to Sign"
  commitLabel="Decline to Sign"
  commitBusyLabel="Declining"
  onOpen={() => {
    declineReason = "";
    declineFailure = null;
  }}
  onCommit={decline}
>
  {#snippet notice()}
    {#if declineFailure !== null}
      <FailureNotice failure={declineFailure.failure} fallback={declineFailure.fallback} />
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <p class="text-sm">
        Declining ends this request for everyone, and {view?.senderName ?? "the sender"} is told. Anything you filled in is discarded.
      </p>
      <Label for="signer-decline-reason">Why (optional)</Label>
      <Textarea id="signer-decline-reason" bind:value={declineReason} maxlength={500} disabled={busy} />
    </div>
  {/snippet}
</ActionDialog>
