<script lang="ts">
  /*
   * The status seal, and the window it opens. A matter's status is READ here and changed from one
   * control here, which opens the panel that discusses what changing it requires
   * (matter-status-change-dialog.svelte).
   *
   * THE SEAL IS A PILLBOX (owner ruling, 2026-09-14). It states the status, and pressing it opens
   * this window. Nothing hangs off it: no menu, no chevron. It was briefly a dropdown of lifecycle
   * steps, which put a list of verbs under a control whose whole job is to say one word, and gave
   * the reader nothing about what any of those verbs would do.
   *
   * ONE CONTROL CHANGES THE STATUS, AND IT IS NAMED FOR THE ACT. Not Open Matter, Close Matter and
   * Put On Hold standing as a row of three; one Change Status beside the status itself. Which steps
   * exist from here, what each requires, and whether those requirements are met are the change
   * panel's to say, because that is the moment a reader needs them.
   *
   * WHAT THE WINDOW IS AND IS NOT. It is a short answer to four questions and nothing else: what
   * the status is, what the matter is numbered, how the matter is engaged — the agreement the
   * client signed and the fee arrangement it rests on — and where the firm's paper file is kept.
   * It is NOT a checklist for a person to work through, and NOT a summary of the matter —
   * everything else about the matter is on the sections that own it.
   *
   * WHY THE CHECKS LEFT AND THESE FACTS STAYED. The division is what a fact is ABOUT. The
   * requirement lists, the hold's reason field and the step controls are all about a change to the
   * status, so they moved into the panel that makes the change and are read where the decision is
   * taken. The number, the engagement and the paper file are standing facts about the record: true
   * whatever the status is, changed from their own controls, and read by somebody who did not come
   * to change anything. A window that carried both made the requirements read as a standing
   * property of the matter, which they are not — they are the answer to a question nobody had asked
   * yet.
   *
   * THE ENGAGEMENT LIVES HERE AND NOT ON THE FEES SCREEN (owner ruling, 2026-09-03). The fee
   * arrangement is a fact of the engagement, set when the matter opens and rarely read again, and
   * the intake agreement it rests on is the same kind of fact as the paper file's whereabouts. So
   * it sits with the status, its version history folded away, and Amend seated beside it the way
   * Change Status is seated beside the status. The Fees screen states nothing about it.
   *
   * IT IS A READING PANEL, AND THE SHELL SAYS SO. It opens in ActionDialog with `kind="reading"`,
   * which is the kind that asks for nothing: its action bar ends at the way out, and every control
   * it offers is seated in its body beside the fact that control changes. Somebody may open this to
   * read where the file is kept, and a window whose bottom-right corner offered Close Matter put
   * the act they did not come for exactly where a hand goes by habit.
   *
   * TWO SIDES, AND THE DIVISION IS THE POINT. The left is the matter's status, its number and its
   * engagement; the right is the paper file. They are apart because the paper file is a STANDING
   * fact and not a consequence of any step: a firm keeps a matter's folder in a box, commonly with
   * other matters' folders and commonly at a remote store, and closing the matter moves none of
   * that. The right side is the shell's context pane — the record window's own right pane, lent —
   * so it sits on the quieter surface behind a hairline, as context does everywhere in the product.
   */
  import { invalidateAll } from "$app/navigation";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import ArrowRightLeft from "@lucide/svelte/icons/arrow-right-left";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Hash from "@lucide/svelte/icons/hash";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import { formatDate, formatMoney } from "@magna-carta/design-system/data-table";
  import { formatInstantDate } from "@magna-carta/design-system/formatters";
  import AmendAgreementDialog from "$lib/billing/amend-agreement-dialog.svelte";
  import {
    BILLING_PERMISSIONS,
    readArrangement,
    type ArrangementRecord,
  } from "$lib/billing/billing-api.ts";
  import {
    ARRANGEMENT_KIND_LABELS,
    arrangementTerms,
    versionPeriod,
    versionTitle,
  } from "$lib/billing/fee-agreement.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import MatterStatusChangeDialog from "./matter-status-change-dialog.svelte";
  import { renumberMatter, RENUMBER_MATTER_PERMISSION } from "./numbering-api.ts";
  import { matterNumberRefusal } from "./numbering-scheme.ts";
  import { forgetMatterRecord, type MatterRecord } from "./matter-record.ts";
  import { matterStatusLabel, matterStatusPresentation } from "./matter-status.ts";
  import {
    MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    MATTER_PHYSICAL_FILE_FACTS,
    SAMPLE_MATTER_STATUS_SENTENCE,
  } from "./matter-lifecycle.ts";
  import {
    readMatterOffices,
    updateMatter,
    EDIT_MATTER_PERMISSION,
    type MatterOffices,
  } from "./matters-api.ts";
  import { OfficeLink, OfficePicker } from "$lib/offices/index.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";

  let { matter }: { matter: MatterRecord } = $props();

  // The seal comes from the one matter-status register, so this control and the docket's status
  // column can never disagree about what "Closed" looks like.
  const seal = $derived(matterStatusPresentation(matter.status));

  let open = $state(false);
  /** Whether the panel that changes the status is showing. Opened by the one control that does. */
  let changeOpen = $state(false);

  /**
   * Who is asking, from the one shared session read. Null until it lands and null again where it
   * failed; `sessionSettled` is what tells the two apart, and a failed read is never said as a
   * permission not held — the server checks the same permission and answers in its own words.
   */
  const permissions = $derived(sessionPermissions.session?.permissions ?? null);
  const sessionSettled = $derived(sessionPermissions.settled);

  /**
   * The matter's number, set by hand: a court's number, a legacy number, a correction. Offered only
   * where the matter has been active (the number is drawn at open and never before), and asked in
   * place rather than in a second window.
   */
  let numberDraft = $state("");
  let numberTouched = $state(false);
  let numberSaving = $state(false);
  let numberFailure = $state<StatedFailure | null>(null);
  /** The server's own refusal of the number: taken by another matter, or unfit for a link. */
  let numberRefusal = $state<string | null>(null);
  const numberError = $derived(
    numberRefusal ?? (numberTouched ? matterNumberRefusal(numberDraft) : null),
  );
  /** A number belongs only to a matter that has been active; the unnumbered rungs never carry one. */
  const mayCarryNumber = $derived(matter.openedAt !== null || matter.matterNumber !== null);
  const numberBlock = $derived.by((): string | null => {
    if (!sessionSettled) return "Reading your session.";
    if (permissions === null) return null;
    return permissions.includes(RENUMBER_MATTER_PERMISSION)
      ? null
      : permissionRefusal("Setting the number", RENUMBER_MATTER_PERMISSION);
  });

  /** The engagement: the fee arrangement in force and its history. Null until the read comes back. */
  let arrangement = $state<ArrangementRecord | null>(null);
  let arrangementFailure = $state<StatedFailure | null>(null);
  let historyShown = $state(false);
  let amendOpen = $state(false);

  const inForce = $derived(arrangement?.inForce ?? null);
  const history = $derived(arrangement?.history ?? []);
  const currency = $derived(inForce?.currency ?? "USD");
  const money = (amountMinor: number): string => formatMoney(amountMinor / 100, { currency });
  const mayAmend = $derived(
    permissions === null || permissions.includes(BILLING_PERMISSIONS.configure),
  );
  const AMEND_REFUSAL = permissionRefusal("Amending the fee arrangement", BILLING_PERMISSIONS.configure);

  const isSample = $derived(matter.source === "sample");

  /**
   * Whether the row offers the field or reads. Decided by the record and by who is asking — never
   * by a press, which is the whole point: the row is the same height before and after it is used.
   */
  const numberEditable = $derived(mayCarryNumber && !isSample && numberBlock === null);

  /**
   * The paper file's office: which of the firm's offices this matter's folder is kept at.
   *
   * Read from the matter itself rather than taken from the record the chrome already holds, because
   * a file moved from another surface between two openings must not leave this window stating where
   * it used to be — the same reason the engagement is re-read. It is NOT the office the matter is
   * run out of, which is the citation on the header: a folder travels, and telling somebody the
   * file is in a building it left is the one thing this row must not do.
   */
  let offices = $state<MatterOffices | null>(null);
  let officesFailure = $state<StatedFailure | null>(null);
  // A sample matter has no record behind it to ask about, so nothing is in flight and nothing is
  // waited for; the row states what a sample states, which is that nothing is recorded.
  const officesLoading = $derived(!isSample && offices === null && officesFailure === null);
  const physicalFileLocationId = $derived(offices?.physicalFileLocationId ?? null);
  const physicalFileLocationName = $derived(offices?.physicalFileLocationName ?? null);

  /*
   * Where the file is kept is a FIELD at rest, not a button that grows one (owner ruling,
   * 2026-09-16). It was a Set Location press that revealed a labelled picker and a Record/Cancel
   * pair beneath it, which grew the window under the reader's pointer at the moment they acted.
   * A closed choice over the firm's own offices is exactly what the combobox is for: it shows the
   * office's name at rest, takes typing, and is the same size before and after it is used. What it
   * chooses is recorded straight away — there is one value here, so a commit would only be a second
   * press to confirm the first.
   */
  let physicalFileSaving = $state(false);
  /**
   * What the field is showing. It follows the record — every read puts the recorded office back in
   * it — and a refused write puts it back too, so a field that says one office while the record
   * holds another is not a state this window can be left in.
   */
  let physicalFileDraft = $state<string | null>(null);
  let physicalFileFailure = $state<StatedFailure | null>(null);
  const physicalFileBlock = $derived.by((): string | null => {
    if (!sessionSettled) return "Reading your session.";
    if (permissions === null) return null;
    return permissions.includes(EDIT_MATTER_PERMISSION)
      ? null
      : permissionRefusal("Recording where the paper file is kept", EDIT_MATTER_PERMISSION);
  });

  // Who is asking, read through the shared session so the first control on the page to need it
  // pays and the rest join. Not read on mount: the seal is on every matter page and most visits
  // never touch it. It is read as the pointer reaches the seal, or focus lands on it, so that by
  // the time the window has opened the answer is usually already here and its controls do not
  // flicker from refused to offered; opening the window is the backstop for a touch. A sample
  // matter is already blocked for a better reason, so it never asks at all.
  function warmSession(): void {
    if (isSample) return;
    void sessionPermissions.load(fetch);
  }
  $effect(() => {
    if (open) warmSession();
  });

  /*
   * The two reads the window makes about facts that CHANGE elsewhere: the engagement, and the
   * office the paper file is kept at. Both are made from `reset` — the shell's own opening
   * transition — and not from an effect, and that is a correctness point rather than a style one.
   * The shell calls `onOpen` from an effect of its own, and a child's effects run after the
   * parent's, so an effect here guarded by a "have I asked" flag reads its flag BEFORE `reset`
   * clears it: the window would re-read on its first opening and never again, which is the one
   * thing the re-read exists to prevent. An amendment recorded elsewhere, or a folder moved between
   * two openings, must not leave this window stating what used to be true.
   */
  async function readEngagement(): Promise<void> {
    const outcome = await readArrangement(fetch, matter.id);
    if (outcome.kind === "ok") {
      arrangement = outcome.value;
      arrangementFailure = null;
      return;
    }
    arrangementFailure = stated(
      outcome.failure,
      "The agreement could not be read.",
      MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    );
  }

  async function readOffices(): Promise<void> {
    const outcome = await readMatterOffices(fetch, matter.id);
    if (outcome.kind === "ok") {
      offices = outcome.value;
      physicalFileDraft = outcome.value.physicalFileLocationId;
      officesFailure = null;
      return;
    }
    officesFailure = stated(
      outcome.failure,
      "The paper file's office could not be read.",
      MATTER_LIFECYCLE_TRANSPORT_FAILURE,
    );
  }

  // A window opened again starts on the record as it now stands, not on whatever was left open
  // the last time somebody was in it.
  function reset(): void {
    historyShown = false;
    // The field opens holding the number the matter wears, so changing one digit of it is changing
    // one digit rather than retyping the whole number from an empty box.
    numberDraft = matter.matterNumber ?? "";
    numberTouched = false;
    numberFailure = null;
    numberRefusal = null;
    physicalFileFailure = null;
    if (isSample) return;
    // Both re-reads keep the last answer standing while they are in flight, so a window somebody
    // has already read does not blink back to "Not recorded" and then forward again.
    void readEngagement();
    void readOffices();
  }

  async function setPhysicalFileLocation(officeId: string | null): Promise<void> {
    if (physicalFileSaving || officeId === physicalFileLocationId) return;
    physicalFileSaving = true;
    physicalFileFailure = null;
    const outcome = await updateMatter(
      fetch,
      matter.id,
      { physicalFileLocationId: officeId },
      crypto.randomUUID(),
    );
    physicalFileSaving = false;
    if (outcome.kind === "ok") {
      // The record this screen opened on still names the old office; the next arrival must not.
      forgetMatterRecord(matter.id);
      await readOffices();
      return;
    }
    // The write was refused, so the field goes back to what the record still says.
    physicalFileDraft = physicalFileLocationId;
    physicalFileFailure = stated(
      outcome.failure,
      "Where the file is kept was not recorded.",
      "Nothing answered. The matter's paper file is unchanged.",
    );
  }

  async function setNumber(): Promise<void> {
    numberTouched = true;
    numberRefusal = null;
    if (numberSaving || matterNumberRefusal(numberDraft) !== null) return;
    numberSaving = true;
    numberFailure = null;
    const outcome = await renumberMatter(fetch, matter.id, numberDraft.trim(), crypto.randomUUID());
    numberSaving = false;
    if (outcome.kind === "ok") {
      numberTouched = false;
      await invalidateAll();
      return;
    }
    // The one refusal a person can act on from the field reads beside it; anything else, the
    // server's refusal of the number itself included, travels whole with its Error ID.
    if (outcome.kind === "problem" && outcome.problem.status === 409) {
      numberRefusal = "Another matter already wears that number.";
      return;
    }
    numberFailure = stated(
      outcome.failure,
      "The number was not set.",
      "Nothing answered. The matter's number is unchanged.",
    );
  }

  /** The record, named once, for every panel this control opens. */
  /*
   * The matter by the newest number it has drawn: its matter number, else the tentative one it wears
   * as a consultation, else the one its intake was written down under. Every rung has one, so the
   * status word is reached only by a matter recorded before its rung was numbered.
   */
  const subtitle = $derived<RecordSubject>({
    reference:
      matter.matterNumber !== null
        ? { kind: "Matter", number: matter.matterNumber }
        : matter.consultationNumber !== null
          ? {
              kind: matterStatusLabel("consultation"),
              number: matter.consultationNumber,
              standing: "tentative",
            }
          : matter.intakeNumber !== null
            ? { kind: matterStatusLabel("intake"), number: matter.intakeNumber }
            : { kind: seal.label, number: null },
    facts: [matter.title],
  });
</script>

<!-- The seal is a PILLBOX: it states the status, and pressing it opens the window. It is a real
     button around the chip, never a chip pretending to be one — a Badge labels and does not act.
     The affordance rides the hairline the badge recipe already reserves and leaves transparent, so
     it costs no layout: the pill is outlined at rest (a control has to read as one before it is
     hovered) and the edge strengthens under the pointer. It matters most in dark mode, where the
     neutral Closed chip's tint is all but the page's own ground and the word alone would read as
     text. No chevron and no menu: the seal says one word, and what can be DONE about that word is
     a question the window answers. -->
<button
  type="button"
  class="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
  aria-label="Matter status: {seal.label}"
  aria-haspopup="dialog"
  aria-expanded={open}
  title={seal.meaning}
  onpointerenter={warmSession}
  onfocus={warmSession}
  onclick={() => (open = true)}
>
  <Badge variant={seal.variant} class="border-border-default hover:border-border-strong" caps>
    {seal.label}
  </Badge>
</button>

<!-- The firm's wide working window, not a confirmation's width. The left side is bounded and
     always will be; the right side is a panel that grows into a real physical-file register, and
     a surface sized to today's sparse version would have to be resized the day it arrives. The
     structure that will hold the work renders at rest. -->
<ActionDialog
  kind="reading"
  bind:open
  heading="Matter Status"
  {subtitle}
  width="record"
  context={physicalFile}
  onOpen={reset}
>
  {#snippet fields()}
    <div class="flex flex-col gap-16">
    <dl class="flex flex-col gap-8 text-sm">
      <div class="grid grid-cols-2 items-center gap-16">
        <dt class="text-text-muted">Status</dt>
        <!-- ONE control changes the status, and it is named for the act rather than for any one
             step. Three verbs stood here — Open Matter, Close Matter, Put On Hold — and each was
             a press that committed before the reader had been told what it would do or what it
             required. Which steps exist from here, and what each of them requires, belongs where
             the change is made: the panel this opens. It is seated beside the fact it changes,
             and the window's own corner still offers nothing but the way out, because somebody
             may have opened this to read where the paper file is kept. -->
        <dd class="flex flex-wrap items-center gap-8">
          <Badge variant={seal.variant} caps>
            {seal.label}
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            disabled={isSample}
            title={isSample ? SAMPLE_MATTER_STATUS_SENTENCE : undefined}
            onclick={() => (changeOpen = true)}
          >
            <ArrowRightLeft class="size-16" aria-hidden="true" />
            Change Status
          </Button>
        </dd>
      </div>
    </dl>

    {#if isSample}
      <!-- A disabled control can be neither hovered nor focused, so the refusal has to read. -->
      <p class="text-xs text-text-subtle">{SAMPLE_MATTER_STATUS_SENTENCE}</p>
    {/if}

    {#if matter.status === "hold"}
      <!-- The pause, as the record states it: when it began, and why, in the words whoever
           recorded it used. Read before anything else on a held matter, because it is the
           reason the reader is looking at this window. -->
      <div class="flex flex-col gap-8">
        <FieldLabel as="h3">On Hold</FieldLabel>
        <dl class="flex flex-col gap-8 text-sm">
          <div class="grid grid-cols-2 items-baseline gap-16">
            <dt class="text-text-muted">Since</dt>
            <dd class="tabular-nums">
              {matter.heldAt === null ? "Not recorded" : formatInstantDate(matter.heldAt)}
            </dd>
          </div>
          <div class="grid grid-cols-2 items-baseline gap-16">
            <dt class="text-text-muted">Reason</dt>
            <dd>{matter.holdReason ?? "Not recorded"}</dd>
          </div>
        </dl>
      </div>
    {/if}

    <!-- The matter's number, and the way to set one by hand. A standing fact rather than a
         step: it is drawn when the matter opens and sits here so a court's number or a legacy
         number can be put on the record without leaving the window that states the status. -->
    <div class="flex flex-col gap-8">
      <FieldLabel as="h3">Number</FieldLabel>
      <dl class="flex flex-col gap-8 text-sm">
        <div class="grid grid-cols-2 items-center gap-16">
          <dt class="text-text-muted">Matter Number</dt>
          <dd class="flex flex-wrap items-center gap-8">
            <!-- THE FIELD IS THE CONTROL HERE TOO, for the reason the paper file's office is:
                 Set Number was a press that grew a labelled field and a Set/Cancel pair beneath
                 the row, shifting everything under it at the moment somebody acted. The field
                 stands in the row at rest, carrying the number the matter wears, and the commit
                 beside it lights only once the text differs from what is on the record. Where
                 there is nothing to set — a matter that has not opened, a sample, an account
                 without the permission — the row reads instead. -->
            {#if numberEditable}
              <Input
                bind:value={numberDraft}
                disabled={numberSaving}
                aria-label={matter.matterNumber === null ? "Matter number" : "New matter number"}
                aria-invalid={numberError !== null}
                class="min-w-0 flex-1"
                onblur={() => (numberTouched = true)}
                onkeydown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void setNumber();
                  }
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={numberSaving || numberDraft.trim() === (matter.matterNumber ?? "")}
                onclick={() => void setNumber()}
              >
                <Hash class="size-16" aria-hidden="true" />
                {numberSaving ? "Setting" : "Record"}
              </Button>
            {:else if matter.matterNumber !== null}
              <span class="tabular-nums">{matter.matterNumber}</span>
            {:else}
              <span class="text-text-subtle">
                {mayCarryNumber ? "Not recorded" : "Drawn when the matter opens"}
              </span>
            {/if}
          </dd>
        </div>
        {#if matter.consultationNumber !== null}
          <div class="grid grid-cols-2 items-center gap-16">
            <dt class="text-text-muted">Consultation Number</dt>
            <dd class="tabular-nums">{matter.consultationNumber}</dd>
          </div>
        {/if}
      </dl>
      {#if mayCarryNumber && !isSample && numberBlock !== null}
        <!-- A disabled control can be neither hovered nor focused, so the refusal has to read. -->
        <p class="text-xs text-text-subtle">{numberBlock}</p>
      {/if}
      {#if numberEditable}
        <!-- What the field is for, beside it at all times rather than arriving with a form. -->
        <p class="text-xs text-text-subtle">
          A court's number, a number from the firm's old system, or a correction. It has to be
          unique in the firm and able to stand in a link; the number it replaces stays on the
          record.
        </p>
      {/if}
      {#if numberError !== null}
        <p class="text-xs text-status-danger-subtle-foreground">{numberError}</p>
      {/if}
      {#if numberFailure !== null}
        <FailureNotice
          failure={numberFailure.failure}
          title="The Number Was Not Set"
          fallback={numberFailure.fallback}
          whenSilent={numberFailure.whenSilent}
        />
      {/if}
    </div>

    {#if !isSample}
      <!-- How the matter is engaged: the agreement the client signed, and the fee arrangement it
           rests on. Amend is seated beside the arrangement as the step is seated beside the
           status; the history is folded away because it is rarely read and never short. -->
      <div class="flex flex-col gap-8">
        <FieldLabel as="h3">Engagement</FieldLabel>
        <!-- The agreement's list stands while it is read, in its own shape over the fields it
             will carry, so the values land where the reader already expects them. A failed read
             settles to the notice with Retry in the same place. -->
        <LoadingRegion
          loading={arrangement === null && arrangementFailure === null}
          failed={arrangementFailure !== null}
          label="Reading the agreement"
          class="flex flex-col gap-8"
        >
          {#snippet failure()}
            {#if arrangementFailure !== null}
              <FailureNotice
                failure={arrangementFailure.failure}
                subject="The agreement"
                fallback={arrangementFailure.fallback}
                whenSilent={arrangementFailure.whenSilent}
                onRetry={() => {
                  arrangementFailure = null;
                  void readEngagement();
                }}
              />
            {/if}
          {/snippet}
          <dl class="flex flex-col gap-8 text-sm">
            <div class="grid grid-cols-2 items-center gap-16">
              <dt class="text-text-muted">Agreement</dt>
              <dd>
                {#if inForce?.agreementFileId != null && inForce.agreementFileName !== null}
                  <a
                    href={fileDownloadUrl(inForce.agreementFileId)}
                    class="underline underline-offset-2 hover:text-text-default"
                    title="The signed agreement, from the matter's files"
                  >
                    {inForce.agreementFileName}
                  </a>
                {:else if inForce?.agreementFileId != null}
                  <span class="text-text-subtle">The file named on this version has been deleted.</span>
                {:else}
                  <span class="text-text-subtle">Not on file</span>
                {/if}
              </dd>
            </div>
            <div class="grid grid-cols-2 items-center gap-16">
              <dt class="text-text-muted">Billed As</dt>
              <dd class="flex flex-wrap items-center gap-8">
                <span>
                  {inForce === null ? ARRANGEMENT_KIND_LABELS.hourly : ARRANGEMENT_KIND_LABELS[inForce.kind]}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!mayAmend}
                  title={mayAmend
                    ? "Record an amendment as a new version. The version in force stays on the record with the dates it governed."
                    : AMEND_REFUSAL}
                  onclick={() => (amendOpen = true)}
                >
                  <SquarePen class="size-16" aria-hidden="true" />
                  Amend
                </Button>
              </dd>
            </div>
            {#if inForce === null}
              <p class="text-xs text-text-subtle">
                Nothing was recorded, and a matter with no arrangement is billed hourly.
              </p>
            {:else}
              <div class="grid grid-cols-2 items-baseline gap-16">
                <dt class="text-text-muted">Terms</dt>
                <dd>{arrangementTerms(inForce, money)}</dd>
              </div>
              <div class="grid grid-cols-2 items-baseline gap-16">
                <dt class="text-text-muted">In Force Since</dt>
                <dd class="tabular-nums">
                  {formatDate(inForce.validFrom)} · version {inForce.version} of {history.length}
                </dd>
              </div>
            {/if}
          </dl>
          {#if history.length > 1}
            <Button
              variant="ghost"
              size="sm"
              class="self-start"
              aria-expanded={historyShown}
              onclick={() => (historyShown = !historyShown)}
            >
              {#if historyShown}
                <ChevronDown class="size-16" aria-hidden="true" />
              {:else}
                <ChevronRight class="size-16" aria-hidden="true" />
              {/if}
              {historyShown ? "Hide the earlier versions" : `Show the ${history.length - 1} earlier ${history.length === 2 ? "version" : "versions"}`}
            </Button>
            {#if historyShown}
              <ul class="flex flex-col gap-8 text-sm">
                {#each history as version (version.id)}
                  <li class="flex flex-col gap-4">
                    <span class="flex items-baseline justify-between gap-16">
                      <span>{versionTitle(version)}</span>
                      <span class="text-xs text-text-muted tabular-nums">
                        {versionPeriod(version, formatDate)}
                      </span>
                    </span>
                    <span class="text-xs text-text-subtle">{arrangementTerms(version, money)}</span>
                    {#if version.agreementFileName !== null && version.agreementFileId !== null}
                      <a
                        href={fileDownloadUrl(version.agreementFileId)}
                        class="self-start text-xs underline underline-offset-2"
                      >
                        {version.agreementFileName}
                      </a>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </LoadingRegion>
      </div>
    {/if}
    </div>
  {/snippet}
</ActionDialog>

<!-- The one panel the status is changed in, opened over this window by the one control that
     changes it. It is where the steps available from here are listed and what each requires is
     answered; nothing about the change is decided twice. -->
<MatterStatusChangeDialog {matter} bind:open={changeOpen} {subtitle} />

<!-- Amending is its own act, asked in its own panel over this one; the answer comes back here. -->
<AmendAgreementDialog
  bind:open={amendOpen}
  {arrangement}
  matterId={matter.id}
  onRecorded={(record) => (arrangement = record)}
/>

<!-- The paper file, which no lifecycle step touches. -->
{#snippet physicalFile()}
  <div class="flex flex-col gap-8">
    <FieldLabel as="h3">Physical File</FieldLabel>
    <!-- The firm's own paper file, which is not the custody register: that one holds client
         property left with the firm to guard.

         WHERE IT IS KEPT IS ONE OF THE FIRM'S OFFICES, named by the same piece that names an
         office anywhere else, so a reader who wants the address or the telephone is one press from
         the record rather than reading a name that leads nowhere. It is NOT the office the matter
         is run out of — that one is the citation on the header — because a folder travels.

         The other two rows hold nothing and say so the way a row says it: "Not recorded" beside
         the Soon mark, with deliberately no sentence under them naming the dependency, which a row
         that already states it holds nothing has said (owner ruling). The reasoning for all three
         lives in matter-lifecycle.ts. -->
    <dl class="flex flex-col gap-8 text-sm">
      {#each MATTER_PHYSICAL_FILE_FACTS as fact (fact.key)}
        <div class="grid grid-cols-2 items-baseline gap-16">
          <dt class="text-text-muted">{fact.label}</dt>
          {#if fact.served}
            <dd>
              <LoadingRegion
                loading={officesLoading}
                failed={officesFailure !== null}
                label="Reading where the paper file is kept"
                class="flex flex-col gap-8"
              >
                {#snippet failure()}
                  {#if officesFailure !== null}
                    <FailureNotice
                      failure={officesFailure.failure}
                      subject="The paper file's office"
                      fallback={officesFailure.fallback}
                      whenSilent={officesFailure.whenSilent}
                      onRetry={() => {
                        officesFailure = null;
                        void readOffices();
                      }}
                    />
                  {/if}
                {/snippet}
                <!-- THE FIELD IS THE CONTROL, and it is the same size before and after it is
                     used: a combobox over the firm's own offices, showing the office's name at
                     rest and taking typing. Where the reader may not change it — a sample matter,
                     or an account without the permission — the row reads instead, as the linked
                     name. Which of the two shows is decided by who is asking, never by a press,
                     so nothing here grows under a pointer. -->
                {#if isSample || physicalFileBlock !== null}
                  <OfficeLink
                    officeId={physicalFileLocationId}
                    name={physicalFileLocationName}
                    whenNone="Not recorded"
                  />
                {:else}
                  <div class="flex flex-col gap-4">
                    <OfficePicker
                      label="Office"
                      bind:value={physicalFileDraft}
                      disabled={physicalFileSaving}
                      title={physicalFileSaving ? "Recording where the file is kept." : undefined}
                      onchange={(officeId) => void setPhysicalFileLocation(officeId)}
                    />
                    <!-- The way through to the office's own record, on a line the row keeps
                         whether or not an office is named: naming one lights a link rather than
                         growing the row by a line. -->
                    {#if physicalFileLocationId === null}
                      <span class="text-xs text-text-subtle">
                        Name an office and its record opens from here.
                      </span>
                    {:else}
                      <OfficeLink
                        officeId={physicalFileLocationId}
                        name={physicalFileLocationName}
                      />
                    {/if}
                  </div>
                {/if}
              </LoadingRegion>
            </dd>
          {:else}
            <dd class="flex items-center gap-8 text-text-subtle">
              Not recorded
              <MaturityBadge stage="soon" />
            </dd>
          {/if}
        </div>
      {/each}
    </dl>
    {#if !isSample && physicalFileBlock !== null}
      <!-- A disabled control can be neither hovered nor focused, so the refusal has to read. -->
      <p class="text-xs text-text-subtle">{physicalFileBlock}</p>
    {/if}
    <!-- What the field is for, stated once, beside it — not as a hint that arrives with a form.
         Emptying it is a real answer: a firm that does not know where a folder is must be able to
         say that rather than leave a guess standing. -->
    {#if !isSample && physicalFileBlock === null}
      <p class="text-xs text-text-subtle">
        The office the firm keeps this matter's folder at. Not the office the matter is run out of:
        a file that has been boxed elsewhere is recorded where it actually is.
      </p>
    {/if}
    {#if physicalFileFailure !== null}
      <FailureNotice
        failure={physicalFileFailure.failure}
        title="The Paper File Is Unchanged"
        fallback={physicalFileFailure.fallback}
        whenSilent={physicalFileFailure.whenSilent}
      />
    {/if}
  </div>
{/snippet}
