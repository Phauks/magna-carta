<script lang="ts">
  /*
   * CHECK STOCK — where each field prints on one trust account's checks, placed over a scan of
   * the firm's own blank check.
   *
   * THE CHECK IS DRAWN AT ITS TRUE PROPORTION and scaled to the column, with the account's
   * straightened scan behind the fields, so a reader drags a field onto the line it belongs on
   * rather than typing inches. The inches are still there, in the panel beside it, for the
   * reader who has a ruler and a test print in hand.
   *
   * NOTHING IS SAVED UNTIL SAVE LAYOUT. Moving, adding, removing, the page layout, the shift, a
   * new scan: all of it is a draft held here, and Save Layout sends the whole stock as one new
   * version. A field that may not stand where it is turns red and says nothing under itself; the
   * sentence that names the problem is the Save button's refusal.
   *
   * THE TEST PAGE IS THE DRAFT, NOT THE SAVED STOCK, because the test print is how a reader finds
   * out whether the draft is right before saving it.
   */
  import { onDestroy } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as SegmentedControl from "@magna-carta/design-system/segmented-control";
  import Button from "@magna-carta/design-system/button";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { toast } from "@magna-carta/design-system/toast";
  import Camera from "@lucide/svelte/icons/camera";
  import Printer from "@lucide/svelte/icons/printer";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import {
    CHECK_PAGE_LAYOUTS,
    CHECK_PAGE_LAYOUT_LABELS,
    CHECK_WIDTH_MILS,
    MAX_FIELD_SIZE_POINTS,
    MIN_FIELD_SIZE_POINTS,
    STANDARD_CHECK_FIELDS,
    checkFieldListProblem,
    type CheckField,
    type CheckFieldKind,
    type CheckPageLayout,
  } from "@magna-carta/trust/check-layout";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { withAccount, type BackDestination } from "$lib/screen/screen-header.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { SaveTrustCheckStockRequest, TrustChecksResponse } from "./checks-api.ts";
  import type { TrustChecksService } from "./checks-service.ts";
  import { checkTestPageDocument } from "./check-document.ts";
  import { CheckPdfError } from "./check-pdf.ts";
  import {
    REQUIRED_FIELD_KINDS,
    addedField,
    fieldLabel,
    inchesText,
    kindsToAdd,
    milsFromInches,
    shiftProblem,
    type CheckBackdrop,
  } from "./checks-model.ts";
  import CheckBoard from "./check-board.svelte";
  import CheckScanDialog from "./check-scan-dialog.svelte";

  let {
    trustAccountId,
    accountName,
    back,
    service,
    manageRefusal,
  }: {
    trustAccountId: string;
    /** Where the editor was entered from; the account is added to it. */
    back: BackDestination;
    /** The account's own name, or null while the roster is being read. */
    accountName: string | null;
    service: TrustChecksService;
    /** Why this reader may not save the stock, or undefined where they may. */
    manageRefusal: string | undefined;
  } = $props();

  // ---- the read ----------------------------------------------------------------------------------

  let data = $state<TrustChecksResponse | null>(null);
  let readFailure = $state<Failure | null>(null);

  // The draft. It starts at the standard positions, which is also what a new stock starts from.
  let name = $state("");
  let pageLayout = $state<CheckPageLayout>("check_top");
  let fields = $state<CheckField[]>(STANDARD_CHECK_FIELDS.map((field) => ({ ...field })));
  let shiftXMils = $state(0);
  let shiftYMils = $state(0);
  let startingText = $state("");
  let selectedKind = $state<CheckFieldKind | null>("payee");
  let backdrop = $state<CheckBackdrop>("sample");

  /** The scan drawn now: the saved one, a new one not yet saved, or none. */
  let scanUrl = $state<string | null>(null);
  /** What Save Layout does to the saved scan. */
  let scanChange = $state<SaveTrustCheckStockRequest["scan"]>("keep");

  function useScanUrl(next: string | null): void {
    if (scanUrl !== null && scanUrl !== next) URL.revokeObjectURL(scanUrl);
    scanUrl = next;
  }
  onDestroy(() => useScanUrl(null));

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await service.read(trustAccountId);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    data = outcome.value;
    const stock = outcome.value.stock;
    if (stock === null) {
      name = "";
      startingText = String(outcome.value.nextCheckNumber);
      return;
    }
    name = stock.name;
    pageLayout = stock.pageLayout;
    fields = stock.fields.map((field) => ({ ...field }));
    shiftXMils = stock.shiftXMils;
    shiftYMils = stock.shiftYMils;
    startingText = String(stock.startingCheckNumber);
    scanChange = "keep";
    if (stock.hasScan) {
      const url = await service.readScanUrl(trustAccountId);
      useScanUrl(url);
      if (url !== null) backdrop = "scan";
    }
  }

  let started = false;
  $effect(() => {
    if (started) return;
    started = true;
    void load();
  });

  const checksBack = $derived(withAccount(back, trustAccountId));

  // ---- the board ---------------------------------------------------------------------------------

  /** The board's drawn width, for the scale line and for whether every field can carry its tag. */
  let boardWidth = $state(0);
  /** A CSS inch is ninety-six pixels, so the true size is the check's inches at that. */
  const shownPercent = $derived(
    boardWidth === 0 ? null : Math.round((boardWidth / ((CHECK_WIDTH_MILS / 1_000) * 96)) * 100),
  );

  function changeField(next: CheckField): void {
    const index = fields.findIndex((field) => field.kind === next.kind);
    if (index !== -1) fields[index] = next;
  }

  const selected = $derived(fields.find((field) => field.kind === selectedKind) ?? null);

  // ---- the panel's fields ------------------------------------------------------------------------

  /** Which typed boxes hold text that is not a number. Red only; the box says nothing more. */
  let unreadable = $state<ReadonlySet<string>>(new Set());

  function markUnreadable(box: string, isUnreadable: boolean): void {
    const next = new Set(unreadable);
    if (isUnreadable) next.add(box);
    else next.delete(box);
    unreadable = next;
  }

  function typedInches(box: string, text: string, apply: (mils: number) => void): void {
    const mils = milsFromInches(text);
    markUnreadable(box, mils === null);
    if (mils !== null) apply(mils);
  }

  function typedPoints(text: string): void {
    if (selected === null) return;
    const points = Number(text.trim());
    const readable = text.trim() !== "" && Number.isInteger(points);
    markUnreadable("size", !readable);
    if (readable) changeField({ ...selected, sizePoints: points });
  }

  function choose(kind: CheckFieldKind): void {
    selectedKind = kind;
    unreadable = new Set();
  }

  // ---- the fields on the layout ------------------------------------------------------------------

  const addable = $derived(kindsToAdd(fields).map((kind) => ({ value: kind, label: fieldLabel(kind) })));
  let addChoice = $state("");

  function addField(kind: string): void {
    const found = kindsToAdd(fields).find((candidate) => candidate === kind);
    addChoice = "";
    if (found === undefined) return;
    fields = [...fields, { ...addedField(found) }];
    choose(found);
  }

  function removeField(kind: CheckFieldKind): void {
    fields = fields.filter((field) => field.kind !== kind);
    if (selectedKind === kind) selectedKind = fields[0]?.kind ?? null;
  }

  function standardPositions(): void {
    fields = STANDARD_CHECK_FIELDS.map((field) => ({ ...field }));
    shiftXMils = 0;
    shiftYMils = 0;
    choose("payee");
  }

  // ---- the scan ----------------------------------------------------------------------------------

  let scanOpen = $state(false);

  function straightened(scan: { readonly imageBase64: string; readonly previewUrl: string }): void {
    useScanUrl(scan.previewUrl);
    scanChange = { imageBase64: scan.imageBase64 };
    backdrop = "scan";
  }

  function removeScan(): void {
    useScanUrl(null);
    scanChange = data?.stock?.hasScan === true ? "remove" : "keep";
    if (backdrop === "scan") backdrop = "sample";
  }

  // ---- saving ------------------------------------------------------------------------------------

  const startingNumber = $derived.by((): number | null => {
    const value = Number(startingText.trim());
    return startingText.trim() !== "" && Number.isInteger(value) && value > 0 ? value : null;
  });

  const saveRefusal = $derived.by((): string | undefined => {
    if (manageRefusal !== undefined) return manageRefusal;
    if (data === null) return "Reading this account's check stock.";
    if (name.trim() === "") return "Name this check stock.";
    if (startingNumber === null) return "Give the number on the first check in the box.";
    if (unreadable.size > 0) return "One of the measurements is not a number.";
    if (shiftProblem(shiftXMils) || shiftProblem(shiftYMils)) {
      return "A whole page shift can be at most half an inch either way.";
    }
    return checkFieldListProblem(fields) ?? undefined;
  });

  let saving = $state(false);
  let saveFailure = $state<Failure | null>(null);
  let saveKey = "";
  let saveKeyFor = "";

  async function save(): Promise<void> {
    if (saveRefusal !== undefined || startingNumber === null) return;
    const request: SaveTrustCheckStockRequest = {
      trustAccountId,
      name: name.trim(),
      pageLayout,
      fields: fields.map((field) => ({ ...field })),
      shiftXMils,
      shiftYMils,
      startingCheckNumber: startingNumber,
      scan: scanChange,
    };
    // One key per body: pressing again after a failure, unchanged, is a retry and saves once.
    const body = JSON.stringify(request);
    if (saveKeyFor !== body) {
      saveKey = crypto.randomUUID();
      saveKeyFor = body;
    }
    saving = true;
    saveFailure = null;
    const outcome = await service.saveStock(request, saveKey);
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure = outcome.failure;
      return;
    }
    saveKeyFor = "";
    scanChange = "keep";
    if (data !== null) {
      data = { ...data, stock: outcome.value.stock, nextCheckNumber: outcome.value.nextCheckNumber };
    }
    toast.success("Layout saved.");
  }

  // ---- the test page -----------------------------------------------------------------------------

  let testing = $state(false);
  let testFailure = $state<Failure | null>(null);

  async function printTest(): Promise<void> {
    testing = true;
    testFailure = null;
    try {
      const pdf = await service.composePdf(
        checkTestPageDocument({ pageLayout, fields, shiftXMils, shiftYMils }),
      );
      service.openPdf(pdf);
    } catch (error) {
      testFailure = {
        problem: null,
        request: "Compose the test page in this browser",
        failedAt: new Date(),
        cause: error instanceof CheckPdfError ? error.message : String(error),
      };
    }
    testing = false;
  }

  /** On a phone the title row has room for one action; the other two move into the page menu. */
  const narrow = new MediaQuery("max-width: 40rem");
  const scanLabel = $derived(scanUrl === null ? "Add Scan" : "Replace Scan");
  const testLabel = $derived(testing ? "Making the Test Page" : "Print Test on Plain Paper");

  const layoutLabel = $derived(CHECK_PAGE_LAYOUT_LABELS[pageLayout]);
  const hasStubs = $derived(pageLayout !== "three_per_page");
</script>

{#snippet pageMenu()}
  <DropdownMenu.Item
    disabled={data === null || manageRefusal !== undefined}
    title={manageRefusal}
    onSelect={() => (scanOpen = true)}
  >
    <Camera class="size-16 shrink-0" aria-hidden="true" />
    {scanLabel}
  </DropdownMenu.Item>
  <DropdownMenu.Item disabled={testing} onSelect={() => void printTest()}>
    <Printer class="size-16 shrink-0" aria-hidden="true" />
    {testLabel}
  </DropdownMenu.Item>
{/snippet}

<div class="flex flex-col gap-16">
  <ScreenHeader
    title={name.trim() === "" ? "Check Stock" : name.trim()}
    back={checksBack}
    pageMenu={narrow.current ? pageMenu : undefined}
  >
    {#snippet meta()}
      {#if accountName !== null}
        <span>{accountName}</span>
        <Masthead.MetaSeparator />
      {/if}
      <span>{layoutLabel.title}</span>
    {/snippet}
    {#snippet actions()}
      {#if !narrow.current}
        <Button
          variant="secondary"
          disabled={data === null || manageRefusal !== undefined}
          title={manageRefusal}
          onclick={() => (scanOpen = true)}
        >
          <Camera class="size-16" aria-hidden="true" />
          {scanLabel}
        </Button>
        <Button variant="secondary" disabled={testing} onclick={() => void printTest()}>
          <Printer class="size-16" aria-hidden="true" />
          {testLabel}
        </Button>
      {/if}
      <Button
        variant="primary"
        disabled={saveRefusal !== undefined || saving}
        title={saveRefusal}
        onclick={() => void save()}
      >
        {saving ? "Saving" : "Save Layout"}
      </Button>
    {/snippet}
  </ScreenHeader>

  {#if saveFailure !== null}
    <FailureNotice
      failure={saveFailure}
      title="The Layout Was Not Saved"
      fallback="The saved layout is unchanged. Your changes are still here."
      whenSilent="Couldn't connect. The layout was not saved, and trying again won't save it twice."
      onRetry={() => void save()}
    />
  {/if}
  {#if testFailure !== null}
    <FailureNotice
      failure={testFailure}
      title="The Test Page Could Not Be Made"
      fallback="Nothing was printed. Your changes are still here."
      onRetry={() => void printTest()}
    />
  {/if}

  <LoadingRegion
    loading={data === null && readFailure === null}
    failed={readFailure !== null}
    label="Reading this account's check stock"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="This Account's Check Stock Could Not Be Read"
          fallback="Nothing was changed. The saved layout is still on its record."
          onRetry={() => void load()}
        />
      {/if}
    {/snippet}

    <div class="flex flex-col gap-24 lg:flex-row">
      <div class="flex min-w-0 flex-1 flex-col gap-16">
        <div class="flex flex-wrap items-center justify-between gap-12">
          <span id="check-backdrop-label" class="sr-only">Behind the fields</span>
          <SegmentedControl.Root
            aria-labelledby="check-backdrop-label"
            class="w-full sm:w-md"
            value={backdrop}
            onValueChange={(next) => (backdrop = next as CheckBackdrop)}
          >
            <SegmentedControl.Item
              value="scan"
              disabled={scanUrl === null}
              title={scanUrl === null ? "Add a scan of a blank check to draw it here." : undefined}
            >
              Scan Behind
            </SegmentedControl.Item>
            <SegmentedControl.Item value="fields">Fields Only</SegmentedControl.Item>
            <SegmentedControl.Item value="sample">Sample Check</SegmentedControl.Item>
          </SegmentedControl.Root>
          {#if shownPercent !== null}
            <span class="text-sm text-text-muted tabular-nums">
              Shown at {shownPercent} percent of 8.5 x 3.5 in.
            </span>
          {/if}
        </div>

        <div class="w-full" bind:clientWidth={boardWidth}>
          <CheckBoard
            {fields}
            {selectedKind}
            {backdrop}
            {scanUrl}
            tagged={boardWidth >= 640}
            onselect={choose}
            onchange={changeField}
          />
        </div>

        <div class="flex flex-wrap items-center gap-8">
          <span class="text-sm text-text-muted">Fields on this layout</span>
          {#each fields as field (field.kind)}
            <span class="inline-flex items-center">
              <Button
                variant={selectedKind === field.kind ? "primary" : "secondary"}
                size="sm"
                aria-pressed={selectedKind === field.kind}
                onclick={() => choose(field.kind)}
              >
                {fieldLabel(field.kind)}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${fieldLabel(field.kind)}`}
                disabled={REQUIRED_FIELD_KINDS.has(field.kind)}
                title={REQUIRED_FIELD_KINDS.has(field.kind)
                  ? `A check needs the ${fieldLabel(field.kind).toLowerCase()}. It can be moved, not removed.`
                  : undefined}
                onclick={() => removeField(field.kind)}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            </span>
          {/each}
          {#if addable.length > 0}
            <div class="w-full sm:w-3xs">
              <ChoicePicker
                options={addable}
                label="Add Field"
                bind:value={addChoice}
                onchange={addField}
              />
            </div>
          {/if}
          <Button variant="ghost" size="sm" onclick={standardPositions}>
            <RotateCcw class="size-16" aria-hidden="true" />
            Start From Standard Positions
          </Button>
        </div>

        <div class="flex flex-col gap-8">
          <span id="check-page-layout-label" class="text-sm font-medium">Page Layout</span>
          <div
            role="radiogroup"
            aria-labelledby="check-page-layout-label"
            class="grid grid-cols-1 gap-8 sm:grid-cols-2"
          >
            {#each CHECK_PAGE_LAYOUTS as layout (layout)}
              <ChoiceRow
                selected={pageLayout === layout}
                role="radio"
                aria-checked={pageLayout === layout}
                onclick={() => (pageLayout = layout)}
              >
                {CHECK_PAGE_LAYOUT_LABELS[layout].title}
                {#snippet detail()}{CHECK_PAGE_LAYOUT_LABELS[layout].detail}{/snippet}
              </ChoiceRow>
            {/each}
          </div>
        </div>

        <div class="grid grid-cols-1 gap-16 sm:grid-cols-2">
          <LabelledField label="Name">
            {#snippet children({ props })}
              <Input {...props} bind:value={name} autocomplete="off" />
            {/snippet}
          </LabelledField>
          <LabelledField label="Starting Check Number">
            {#snippet children({ props })}
              <Input
                {...props}
                bind:value={startingText}
                inputmode="numeric"
                autocomplete="off"
                aria-invalid={startingNumber === null}
                class="tabular-nums"
              />
            {/snippet}
          </LabelledField>
        </div>

        {#if hasStubs}
          <Card.Root>
            <Card.Header>
              <Card.Title>Voucher Stubs</Card.Title>
              <Card.Description>
                The two stubs on the page repeat the check number, date, payee, amount, matter and
                memo for your file copy. They follow the check's position on the page.
              </Card.Description>
            </Card.Header>
          </Card.Root>
        {/if}
      </div>

      <div class="flex w-full shrink-0 flex-col gap-16 lg:w-xs">
        <Card.Root>
          <Card.Header>
            <Card.Title>{selected === null ? "No Field Chosen" : fieldLabel(selected.kind)}</Card.Title>
            {#if selected === null}
              <Card.Description>Choose a field on the check to place it.</Card.Description>
            {/if}
          </Card.Header>
          {#if selected !== null}
            {@const field = selected}
            <Card.Content class="flex flex-col gap-16">
              <div class="grid grid-cols-2 gap-12">
                <LabelledField label="From Left (in)">
                  {#snippet children({ props })}
                    <Input
                      {...props}
                      value={inchesText(field.xMils)}
                      inputmode="decimal"
                      autocomplete="off"
                      class="tabular-nums"
                      aria-invalid={unreadable.has("left")}
                      onchange={(event) =>
                        typedInches("left", event.currentTarget.value, (mils) =>
                          changeField({ ...field, xMils: mils }),
                        )}
                    />
                  {/snippet}
                </LabelledField>
                <LabelledField label="From Top (in)">
                  {#snippet children({ props })}
                    <Input
                      {...props}
                      value={inchesText(field.yMils)}
                      inputmode="decimal"
                      autocomplete="off"
                      class="tabular-nums"
                      aria-invalid={unreadable.has("top")}
                      onchange={(event) =>
                        typedInches("top", event.currentTarget.value, (mils) =>
                          changeField({ ...field, yMils: mils }),
                        )}
                    />
                  {/snippet}
                </LabelledField>
                <LabelledField label="Width (in)">
                  {#snippet children({ props })}
                    <Input
                      {...props}
                      value={inchesText(field.widthMils)}
                      inputmode="decimal"
                      autocomplete="off"
                      class="tabular-nums"
                      aria-invalid={unreadable.has("width")}
                      onchange={(event) =>
                        typedInches("width", event.currentTarget.value, (mils) =>
                          changeField({ ...field, widthMils: mils }),
                        )}
                    />
                  {/snippet}
                </LabelledField>
                <LabelledField label="Text Size (pt)">
                  {#snippet children({ props })}
                    <Input
                      {...props}
                      value={String(field.sizePoints)}
                      inputmode="numeric"
                      autocomplete="off"
                      class="tabular-nums"
                      aria-invalid={unreadable.has("size") ||
                        field.sizePoints < MIN_FIELD_SIZE_POINTS ||
                        field.sizePoints > MAX_FIELD_SIZE_POINTS}
                      onchange={(event) => typedPoints(event.currentTarget.value)}
                    />
                  {/snippet}
                </LabelledField>
              </div>
              <p class="text-sm text-text-muted">
                Arrow keys nudge {inchesText(10)} in. Shift with an arrow nudges {inchesText(100)} in.
              </p>
            </Card.Content>
          {/if}
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Whole Page</Card.Title>
            <Card.Description>
              If every field lands a little off, move them all at once instead.
            </Card.Description>
          </Card.Header>
          <Card.Content class="grid grid-cols-2 gap-12">
            <LabelledField label="Shift Right (in)">
              {#snippet children({ props })}
                <Input
                  {...props}
                  value={inchesText(shiftXMils)}
                  inputmode="decimal"
                  autocomplete="off"
                  class="tabular-nums"
                  aria-invalid={unreadable.has("shift-right") || shiftProblem(shiftXMils)}
                  onchange={(event) =>
                    typedInches("shift-right", event.currentTarget.value, (mils) => (shiftXMils = mils))}
                />
              {/snippet}
            </LabelledField>
            <LabelledField label="Shift Down (in)">
              {#snippet children({ props })}
                <Input
                  {...props}
                  value={inchesText(shiftYMils)}
                  inputmode="decimal"
                  autocomplete="off"
                  class="tabular-nums"
                  aria-invalid={unreadable.has("shift-down") || shiftProblem(shiftYMils)}
                  onchange={(event) =>
                    typedInches("shift-down", event.currentTarget.value, (mils) => (shiftYMils = mils))}
                />
              {/snippet}
            </LabelledField>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Your Scan</Card.Title>
            <Card.Description>
              {scanUrl === null
                ? "No scan yet. A photograph of one blank check, straightened from its four corners, is drawn behind the fields. It never prints."
                : "Straightened from its four corners and kept with the firm's files. It is used only to place fields and never prints."}
            </Card.Description>
          </Card.Header>
          {#if scanUrl !== null}
            <Card.Content>
              <Button
                variant="ghost"
                size="sm"
                disabled={manageRefusal !== undefined}
                title={manageRefusal}
                onclick={removeScan}
              >
                Remove Scan
              </Button>
            </Card.Content>
          {/if}
        </Card.Root>
      </div>
    </div>
  </LoadingRegion>
</div>

<CheckScanDialog
  bind:open={scanOpen}
  stockName={name.trim() === "" ? "Check Stock" : name.trim()}
  onStraightened={straightened}
/>
