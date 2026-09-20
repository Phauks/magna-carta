<script lang="ts">
  /*
   * THE RUN SCREEN — one report, over one scope, rendered from its declaration.
   *
   * Nothing here knows what a report is. The declaration says which controls to draw (a period on
   * every report, a knowledge instant on a bitemporal one, a trust account where the report is
   * about one), the read fires through the declaration's port when
   * the scope is complete, and the answer arrives as titled sections the screen draws as tables
   * and the export menu renders as a file. Adding a report never touches this file.
   *
   * WHAT THE PACK LISTS IS THE FIRM'S POLICY, NOT A CONTROL HERE. Whether ledgers at zero appear
   * and whether authorizers are named are firm settings (Settings, Reports), applied on the server
   * and recorded on the provenance section, so the firm's document reads the same every time.
   *
   * THE SCOPE IS IN THE ADDRESS. A report somebody ran is a link somebody else can open, so every
   * half of the scope rides the URL and a change here is `replaceState` rather than a navigation:
   * the same screen looking at different days is not a place in the reader's history.
   *
   * NO RUN BUTTON. The reporting reads are bounded and measured, every control's change is a new
   * question, and a control between the question and the answer would make the reader confirm what
   * they already chose. The read fires when the scope is complete, and the result region is
   * furniture: it renders at rest with the report's own sections over sample words, so the answer
   * fills a shape the reader already has.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Select from "@magna-carta/design-system/select";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { DateRangePicker } from "@magna-carta/design-system/date-range-picker";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { LabelledField } from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { MaturityBadge, soonDependencySentence } from "@magna-carta/design-system/maturity";
  import { parseDate } from "@internationalized/date";
  import Calendar from "@lucide/svelte/icons/calendar";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ExportMenu from "$lib/export/export-menu.svelte";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    reportExportDocument,
    type ReportPresentation,
    type ReportSection,
  } from "$lib/reports/report-presentation.ts";
  import { isBuiltReport, type ReportDeclaration } from "$lib/reports/report-registry.ts";
  import {
    DEFAULT_KNOWLEDGE_ZONE,
    REPORT_PERIOD_PRESET_IDENTIFIERS,
    customReportPeriodOutcome,
    isPeriodShowing,
    knowledgeDateOf,
    knowledgeInstantForDate,
    knowledgeInstantMovedToZone,
    readReportScope,
    reportPeriodPreset,
    scopeReading,
    writeReportScope,
    type ReportPeriod,
    type ReportScope,
  } from "$lib/reports/report-scope.ts";
  import {
    LIST_TRUST_ACCOUNTS_PERMISSION,
    listTrustAccounts,
    trustAccountLabel,
    type TrustAccountRoster,
  } from "$lib/reports/reports-api.ts";
  import type { ReportCaptions } from "$lib/reports/trust-compliance-presenter.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { FirmMatters } from "$lib/time/firm-matters.svelte.ts";
  import { matterDisplay } from "$lib/time/time-sheet-model.ts";
  import { civilDateOf } from "@magna-carta/civil-time/civil-date";

  let { data }: { data: { report: ReportDeclaration } } = $props();
  const report = $derived(data.report);
  const built = $derived(isBuiltReport(report) ? report : null);

  const today = civilDateOf(new Date());

  // ---- who is asking -----------------------------------------------------------------------------

  /*
   * Null until the session read lands; then what it said. A session that could NOT be read is a
   * different fact from a session that lacks the key: the first is a transport failure and the
   * server still decides (a refusal comes back as a 403 and is shown as one), the second is known
   * up front and the doomed request is not sent.
   */
  let permissions = $state<readonly string[] | null>(null);
  let sessionRead = $state(false);
  const refusedUpFront = $derived(
    permissions !== null && !permissions.includes(report.permission),
  );

  // The captions: the firm's matters and members, read for their names. The report is READ without
  // them — an identifier stands where a name has not arrived, which is the pack's own posture.
  const firmMatters = new FirmMatters();
  const roster = new FirmRoster();
  const captions = $derived<ReportCaptions>({
    matter: (matterId) => {
      const matter = firmMatters.byIdentifier(matterId);
      return matter === undefined ? matterId : matterDisplay(matter);
    },
    client: (clientEntityId) => clientEntityId,
    member: (userId) =>
      roster.members?.find((member) => member.userId === userId)?.displayName ?? userId,
  });

  let bootstrapped = false;
  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void firmMatters.load(fetch);
    void roster.load(fetch);
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") permissions = outcome.value.permissions;
      sessionRead = true;
    })();
  });

  // ---- the subject: the firm's trust accounts ----------------------------------------------------

  let accounts = $state<TrustAccountRoster | null>(null);
  let accountsFailure = $state<StatedFailure | null>(null);

  async function loadAccounts(): Promise<void> {
    accountsFailure = null;
    const outcome = await listTrustAccounts(fetch);
    if (outcome.kind === "ok") accounts = outcome.value;
    else accountsFailure = stated(outcome.failure, "The firm's trust accounts could not be read.");
  }

  /*
   * A member who may run the report and may not read trust cannot pick an account. The listing is
   * a trust read on purpose, and the gap is stated in the words a reader can take to whoever
   * administers their account, rather than as a read that failed.
   */
  const accountsRefusal = $derived(
    accountsFailure?.failure.problem?.status === 403
      ? permissionRefusal("Picking a trust account", LIST_TRUST_ACCOUNTS_PERMISSION)
      : null,
  );

  $effect(() => {
    if (built?.scope.trustAccount === true && accounts === null && accountsFailure === null) {
      void loadAccounts();
    }
  });

  const accountChoices = $derived(
    (accounts?.accounts ?? [])
      .map((account) => ({ value: account.id, label: trustAccountLabel(account) }))
      .toSorted((left, right) => left.label.localeCompare(right.label)),
  );

  /** The zone a chosen day ends in: the holding office's, once an account is chosen. */
  const subjectZone = $derived(
    accounts?.accounts.find((account) => account.id === scope.subject)?.timeZone ??
      DEFAULT_KNOWLEDGE_ZONE,
  );

  // ---- the scope: what is asked for --------------------------------------------------------------

  const defaultPeriod = $derived(reportPeriodPreset("month", today));
  const scope = $derived(readReportScope(page.url.searchParams, defaultPeriod));

  function goToScope(next: ReportScope): void {
    replaceState(writeReportScope(page.url, next), page.state);
  }

  /*
   * A different account may keep a different clock. The day the reader chose is what survives
   * the change; the instant that day ends at is re-resolved in the new office's zone.
   */
  function chooseSubject(next: string | null): void {
    const nextZone =
      accounts?.accounts.find((account) => account.id === next)?.timeZone ??
      DEFAULT_KNOWLEDGE_ZONE;
    goToScope({
      ...scope,
      subject: next,
      knownAsOf:
        scope.knownAsOf === null
          ? null
          : knowledgeInstantMovedToZone(scope.knownAsOf, subjectZone, nextZone),
    });
  }

  function applyPeriod(period: ReportPeriod): void {
    goToScope({ ...scope, period });
  }

  let customRangeRefusal = $state<string | null>(null);
  function applyCustomRange(from: string, to: string): void {
    const outcome = customReportPeriodOutcome(from, to);
    if (outcome.kind === "refused") {
      customRangeRefusal = outcome.reason;
      return;
    }
    customRangeRefusal = null;
    applyPeriod(outcome.scope);
  }

  const KNOWLEDGE_CHOICES = [
    { value: "live", label: "Everything known now" },
    { value: "day", label: "As at the end of a day" },
  ] as const;
  const knowledgeChoice = $derived(scope.knownAsOf === null ? "live" : "day");

  function chooseKnowledge(next: string): void {
    if (next === "live") {
      goToScope({ ...scope, knownAsOf: null });
      return;
    }
    // A day chosen with no day named yet is the end of the period: "as at the period end" is the
    // question a compliance report is most often asked.
    goToScope({ ...scope, knownAsOf: knowledgeInstantForDate(scope.period.to, subjectZone) });
  }

  function chooseKnowledgeDay(isoDate: string): void {
    goToScope({ ...scope, knownAsOf: knowledgeInstantForDate(isoDate, subjectZone) });
  }

  /** What is still missing before the report can be read, or null when nothing is. */
  const scopeGap = $derived.by((): string | null => {
    if (built === null) return null;
    if (built.scope.trustAccount && scope.subject === null) {
      return "Choose a trust account to run this report.";
    }
    return null;
  });
  const scopeComplete = $derived(built !== null && scopeGap === null);

  // ---- the read ----------------------------------------------------------------------------------

  let presentation = $state<ReportPresentation | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reading = $state(false);
  /** Bumped by Refresh and Retry, so the same scope reads again rather than being deduplicated. */
  let reloadToken = $state(0);

  const readKey = $derived(
    !scopeComplete || !sessionRead || refusedUpFront
      ? null
      : [
          report.id,
          scope.subject ?? "",
          scope.period.from,
          scope.period.to,
          scope.knownAsOf ?? "live",
          String(reloadToken),
        ].join(":"),
  );

  let shownKey: string | null = null;
  $effect(() => {
    const key = readKey;
    if (key === null || key === shownKey || built === null) return;
    shownKey = key;
    const target = built;
    const asked = scope;
    reading = true;
    readFailure = null;
    void (async () => {
      const outcome = await target.run(fetch, asked, captions);
      // A later scope has been asked for since; this answer is to a question nobody is asking.
      if (shownKey !== key) return;
      if (outcome.kind === "ok") {
        presentation = outcome.value;
      } else {
        presentation = null;
        readFailure = stated(outcome.failure, "The report could not be produced.");
      }
      reading = false;
    })();
  });

  // The presentation re-arranges when a caption arrives — the same payload, better names — but the
  // captions are consulted at read time, so a name that landed after the read is applied on the
  // next one. Refresh re-reads on demand.
  function refresh(): void {
    reloadToken += 1;
  }

  const readRefusal = $derived(
    readFailure?.failure.problem?.status === 403
      ? permissionRefusal("Running this report", report.permission)
      : null,
  );

  const samplePresentation = $derived(built === null ? null : built.fixture(captions));

  const scopeLine = $derived.by(() => {
    const subjectName =
      presentation?.subtitle ??
      accountChoices.find((choice) => choice.value === scope.subject)?.label ??
      null;
    const reading = scopeReading(scope, subjectZone);
    return subjectName === null ? reading : `${subjectName} · ${reading}`;
  });
</script>

<svelte:head><title>{report.name} · Magna Carta</title></svelte:head>

<ScreenHeader title={report.name} back="reports" class="mb-24">
  {#snippet meta()}
    <span>{scopeLine}</span>
    {#if !isBuiltReport(report)}
      <MaturityBadge stage={report.stage} />
    {/if}
  {/snippet}
  {#snippet actions()}
    <ExportMenu
      disabled={presentation === null}
      exportDocument={() =>
        presentation === null ? null : reportExportDocument(presentation, new Date())}
    />
    <Button variant="ghost" disabled={!scopeComplete || reading} onclick={refresh}>
      <RefreshCw class="size-16" aria-hidden="true" />
      Refresh
    </Button>
  {/snippet}
</ScreenHeader>

<div class="flex flex-col gap-24">
  <!-- The report's own controls, at the reading edge. Which of them appear is the declaration's
       decision; the row draws what it is told. -->
  <div class="flex flex-wrap items-start gap-16">
    {#if built !== null && built.scope.trustAccount}
      <LabelledField label="Trust Account" hint={scopeGap ?? undefined}>
        {#snippet children({ props })}
          <Select.Root
            type="single"
            items={accountChoices}
            value={scope.subject ?? ""}
            onValueChange={(next) => chooseSubject(next === "" ? null : next)}
            allowDeselect={false}
            disabled={accounts === null}
          >
            <Select.Trigger {...props} class="w-xs">
              <Select.Value placeholder={placeholderOf("Trust Account")} />
            </Select.Trigger>
            <Select.Content>
              {#each accountChoices as choice (choice.value)}
                <Select.Item value={choice.value} label={choice.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </LabelledField>
    {/if}

    <LabelledField label="Period">
      {#snippet children({ props })}
        <Popover.Root>
          <Popover.Trigger
            {...props}
            class={buttonClasses({ variant: "secondary", size: "default" })}
            disabled={built === null}
          >
            <Calendar class="size-16" aria-hidden="true" />
            {scope.period.label}
            <ChevronDown class="size-16" aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content align="start">
            <div class="flex flex-col gap-12">
              <p class="text-xs text-text-subtle">Report on</p>
              <div class="flex flex-col items-start gap-4">
                {#each REPORT_PERIOD_PRESET_IDENTIFIERS as identifier (identifier)}
                  {@const preset = reportPeriodPreset(identifier, today)}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={isPeriodShowing(scope.period, preset)}
                    onclick={() => applyPeriod(preset)}
                  >
                    {preset.label}
                  </Button>
                {/each}
              </div>
              <p class="text-xs text-text-subtle">Custom range</p>
              <DateRangePicker
                value={{ start: parseDate(scope.period.from), end: parseDate(scope.period.to) }}
                onValueChange={(range) => {
                  const from = range?.start?.toString() ?? "";
                  const to = range?.end?.toString() ?? "";
                  if (from !== "" && to !== "") applyCustomRange(from, to);
                }}
              />
              <p class="text-xs text-text-muted">
                {customRangeRefusal ??
                  "The range applies as you pick it. A preset above returns to a named span."}
              </p>
            </div>
          </Popover.Content>
        </Popover.Root>
      {/snippet}
    </LabelledField>

    {#if report.temporal === "bitemporal"}
      <LabelledField label="As Known">
        {#snippet children({ props })}
          <Select.Root
            type="single"
            items={[...KNOWLEDGE_CHOICES]}
            value={knowledgeChoice}
            onValueChange={chooseKnowledge}
            allowDeselect={false}
            disabled={built === null}
          >
            <Select.Trigger {...props} class="w-3xs">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each KNOWLEDGE_CHOICES as choice (choice.value)}
                <Select.Item value={choice.value} label={choice.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </LabelledField>
      {#if scope.knownAsOf !== null}
        <!-- The date field's label is the picker's own; the wrapper stacks it over the field so the
             row reads label-over-control like its neighbours. -->
        <div class="flex flex-col">
          <DatePicker
            label={`End of Day, ${subjectZone}`}
            value={parseDate(knowledgeDateOf(scope.knownAsOf, subjectZone))}
            maxValue={parseDate(today)}
            onValueChange={(next) => {
              if (next !== undefined) chooseKnowledgeDay(next.toString());
            }}
          />
        </div>
      {/if}
    {/if}

  </div>

  {#if !isBuiltReport(report)}
    <!-- A report the design named and nobody has built: the anatomy stands, disabled, with the one
         honest line about what it waits on. -->
    <p class="text-xs text-text-muted">{soonDependencySentence(report.waitsOn)}</p>
  {:else if refusedUpFront}
    <Alert.Root variant="danger">
      <Alert.Title>This Report Is Not Yours To Run</Alert.Title>
      <Alert.Description>{permissionRefusal("Running this report", report.permission)}</Alert.Description>
    </Alert.Root>
  {:else}
    {#if accountsRefusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The Trust Accounts Are Not Yours To Read</Alert.Title>
        <Alert.Description>{accountsRefusal}</Alert.Description>
      </Alert.Root>
    {:else if accountsFailure !== null}
      <FailureNotice
        failure={accountsFailure.failure}
        title="The Trust Accounts Could Not Be Read"
        fallback={accountsFailure.fallback}
        onRetry={() => void loadAccounts()}
      />
    {/if}

    {#if readRefusal !== null}
      <Alert.Root variant="danger">
        <Alert.Title>This Report Is Not Yours To Run</Alert.Title>
        <Alert.Description>{readRefusal}</Alert.Description>
      </Alert.Root>
    {/if}

    <LoadingRegion
      loading={presentation === null && readFailure === null && scopeComplete}
      refreshing={reading}
      failed={readFailure !== null && readRefusal === null}
      empty={!scopeComplete}
      label="Producing the report"
      onRetry={refresh}
      class="flex flex-col gap-24"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure.failure}
            title="The Report Could Not Be Produced"
            fallback={readFailure.fallback}
            onRetry={refresh}
          />
        {/if}
      {/snippet}
      {#snippet emptyState()}
        <!-- structured-empty-allow: nothing has been ASKED yet, which is not an empty answer. The
             report's sections and their columns come back with the response, so until the scope is
             complete there is no header row to draw — an invented one would promise a shape the
             chosen report may not take. -->
        <EmptyState title="Choose a Trust Account">
          {scopeGap ?? "Nothing has been asked for yet."} The report runs as soon as the scope is
          complete.
        </EmptyState>
      {/snippet}
      {#snippet fixture()}
        {#if samplePresentation !== null}
          {@render stamp(samplePresentation)}
          {#each samplePresentation.sections as section (section.id)}
            {@render sectionTable(section)}
          {/each}
        {/if}
      {/snippet}

      {#if presentation !== null}
        {@render stamp(presentation)}
        {#each presentation.sections as section (section.id)}
          {@render sectionTable(section)}
        {/each}
      {/if}
    </LoadingRegion>
  {/if}
</div>

<!-- The response's own sentence about its reproducibility, on the face of the report. -->
{#snippet stamp(shown: ReportPresentation)}
  <Alert.Root variant={shown.reproducible ? "info" : "warning"}>
    <Alert.Title>{shown.reproducible ? "Reproducible" : "Live"}</Alert.Title>
    <Alert.Description>{shown.stamp}</Alert.Description>
  </Alert.Root>
{/snippet}

<!-- One section as a table: the recipe's own head over the presenter's rows, figures against the
     right edge, and one placeholder row when the section has nothing in it. -->
{#snippet sectionTable(section: ReportSection)}
  {@const endAligned = new Set(section.endAlignedColumns ?? [])}
  <section class="flex flex-col gap-8">
    <FieldLabel as="h2" class="border-b border-border-strong pb-8">{section.title}</FieldLabel>
    {#if section.note !== undefined}
      <p class="text-xs text-text-muted">{section.note}</p>
    {/if}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">{section.title}</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          {#each section.headers as header, columnIndex (columnIndex)}
            <DataTable.Head data-align={endAligned.has(columnIndex) ? "end" : undefined}>
              {header}
            </DataTable.Head>
          {/each}
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each section.rows as row, rowIndex (rowIndex)}
          <DataTable.Row>
            {#each row as cell, columnIndex (columnIndex)}
              <DataTable.Cell
                data-align={endAligned.has(columnIndex) ? "end" : undefined}
                class={endAligned.has(columnIndex) ? "tabular-nums" : undefined}
              >
                {typeof cell === "string" ? cell : cell.text}
              </DataTable.Cell>
            {/each}
          </DataTable.Row>
        {:else}
          <DataTable.Row data-placeholder="true">
            <DataTable.Cell colspan={section.headers.length}>
              <span class="text-text-muted">{section.whenEmpty}</span>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </section>
{/snippet}
