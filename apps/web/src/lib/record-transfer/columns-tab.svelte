<script lang="ts">
  /*
   * The Columns tab: one row per column of the selected file, and what each column holds.
   *
   * The column names and first values come from the file's preview, which is the operator's own
   * file read back to them. Holds offers the fields of the record the file's rows become, the key
   * of each row, and leaving the column out, which is where every column starts. The detail cell
   * asks what a field cannot go without: the order of a date, what a client or party column refers
   * to, a party's role, and the matches for the source's type and staff codes.
   *
   * Below a comfortable width the table reads as stacked rows, each cell under its own label, so
   * nothing scrolls sideways.
   *
   * A refusal is a red edge on the field and never a line of text. What no column holds yet stands
   * under the table as plain marks from the start, and turns red once a run has been refused.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import TimeZonePicker from "$lib/calendar/time-zone-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { phoneCountries } from "$lib/directory/phone-entry.ts";
  import { PARTY_ROLE_OPTIONS } from "$lib/matters/party-api.ts";
  import MatchCodesDialog from "./match-codes-dialog.svelte";
  import {
    assignmentOf,
    FILE_KIND_CHOICES,
    holdsAnyAddress,
    holdsField,
    holdsOptions,
    KEY_ONLY,
    keyColumnOf,
    NOT_BROUGHT_IN,
    type ColumnAssignment,
    type FileMapping,
    type MappingDefaults,
    type MappingProblems,
    type TransferRecordKind,
  } from "./column-mapping.ts";

  let {
    fileName,
    noFile = false,
    preview,
    previewFailure,
    onRetryPreview,
    mapping,
    defaults,
    problems,
    attempted,
    referenceOptions,
    matterTypeOptions,
    memberOptions,
    disabled = false,
    onChange,
    onChooseKind,
  }: {
    fileName: string;
    /** The run has no file to show, so the table stands empty. */
    noFile?: boolean;
    /** The header row and first rows, or null while they are being read. */
    preview: { columns: readonly string[]; rows: readonly (readonly string[])[] } | null;
    previewFailure: StatedFailure | null;
    onRetryPreview: () => void;
    /** Null where nothing says yet what the file holds. */
    mapping: FileMapping | null;
    defaults: MappingDefaults;
    problems: MappingProblems | null;
    /** A run was pressed and refused, so what is unset shows red. */
    attempted: boolean;
    /** The files a client or party column can refer to, by the slug their rows are linked under. */
    referenceOptions: readonly ChoiceOption[];
    matterTypeOptions: readonly ChoiceOption[];
    memberOptions: readonly ChoiceOption[];
    /** The run has ended, so the mapping is read and not changed. */
    disabled?: boolean;
    onChange: (next: FileMapping) => void;
    onChooseKind: (recordKind: TransferRecordKind) => void;
  } = $props();

  const KIND_OPTIONS = FILE_KIND_CHOICES.map((choice) => ({
    value: choice.recordKind,
    label: choice.label,
  }));
  const DATE_ORDER_OPTIONS: readonly ChoiceOption[] = [
    { value: "day-month-year", label: "Day, Month, Year", aside: "31/12/2021" },
    { value: "month-day-year", label: "Month, Day, Year", aside: "12/31/2021" },
    { value: "year-month-day", label: "Year, Month, Day", aside: "2021-12-31" },
  ];
  // A client is its own field, so the roles offered for a party leave it out.
  const ROLE_OPTIONS: readonly ChoiceOption[] = PARTY_ROLE_OPTIONS.filter(
    (role) => role.value !== "client",
  );
  const COUNTRY_OPTIONS: readonly ChoiceOption[] = phoneCountries().map((country) => ({
    value: country.region,
    label: country.name,
    keywords: [country.region],
  }));

  /** Sample columns for the shape of the table while the file's own are being read. */
  const FIXTURE = {
    columns: ["Reference", "First Name", "Last Name", "Email"],
    rows: [
      ["A-1001", "Sample", "Person", "sample@example.com"],
      ["A-1002", "Another", "Person", "another@example.com"],
    ],
  };

  const options = $derived<readonly ChoiceOption[]>(
    mapping === null
      ? []
      : holdsOptions(mapping.recordKind).map((option) => ({
          value: option.value,
          label: option.label,
        })),
  );
  const keyColumn = $derived(
    mapping === null || preview === null ? null : keyColumnOf(mapping, preview.columns),
  );
  const firstDateColumn = $derived.by(() => {
    if (mapping === null || preview === null) return null;
    const current = mapping;
    return (
      preview.columns.find(
        (column) =>
          holdsField(current.recordKind, current.assignments[column]?.holds ?? "").detail === "date",
      ) ??
      preview.columns.find(
        (column) =>
          holdsField(current.recordKind, current.assignments[column]?.holds ?? "").detail ===
          "closedDate",
      ) ??
      null
    );
  });
  const showCountry = $derived(
    mapping !== null && preview !== null && holdsAnyAddress(mapping, preview.columns),
  );

  let matchTypesOpen = $state(false);
  let matchStaffOpen = $state(false);

  function firstValues(index: number, rows: readonly (readonly string[])[]): string {
    return rows.map((row) => (row[index] === undefined || row[index] === "" ? "(empty)" : row[index])).join(" · ");
  }

  function assign(column: string, change: Partial<ColumnAssignment>): void {
    if (mapping === null) return;
    const current = assignmentOf(mapping, column, defaults);
    onChange({
      ...mapping,
      assignments: { ...mapping.assignments, [column]: { ...current, ...change } },
    });
  }

  function countLabel(count: number): string {
    return `${String(count)} matched`;
  }
</script>

{#snippet table(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  current: FileMapping | null,
)}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">The columns of {fileName}</DataTable.Caption>
    <DataTable.Header class="hidden @2xl:table-header-group">
      <DataTable.Row>
        <DataTable.Head>Column in the File</DataTable.Head>
        <DataTable.Head>First Rows</DataTable.Head>
        <DataTable.Head>Holds</DataTable.Head>
        <DataTable.Head>Detail</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each columns as column, index (column)}
        {@const assignment =
          current === null
            ? { holds: NOT_BROUGHT_IN, referenceSourceKind: "", role: "" }
            : assignmentOf(current, column, defaults)}
        {@const detail =
          current === null ? "none" : holdsField(current.recordKind, assignment.holds).detail}
        {@const detailRefused = attempted && (problems?.detailColumns.has(column) ?? false)}
        <DataTable.Row data-placeholder="true" class="block @2xl:table-row">
          <DataTable.Cell class="block font-mono max-@2xl:border-b-0 max-@2xl:pb-0 @2xl:table-cell">
            <span class="break-words">{column}</span>
          </DataTable.Cell>
          <DataTable.Cell
            class="block text-text-muted max-@2xl:border-b-0 max-@2xl:pb-0 @2xl:table-cell"
          >
            <span class="break-words">{firstValues(index, rows)}</span>
          </DataTable.Cell>
          <DataTable.Cell class="block max-@2xl:border-b-0 max-@2xl:pb-0 @2xl:table-cell @2xl:w-3/10">
            <span class="flex flex-col gap-4">
              <FieldLabel class="@2xl:hidden">Holds</FieldLabel>
              <ChoicePicker
                label="Holds"
                {options}
                value={assignment.holds}
                disabled={disabled || current === null}
                invalid={attempted && (problems?.repeatedColumns.has(column) ?? false)}
                fillsCell
                onchange={(holds) => assign(column, { holds })}
              />
            </span>
          </DataTable.Cell>
          <DataTable.Cell class="block @2xl:table-cell @2xl:w-1/4">
            <span class="flex flex-col gap-8">
              {#if keyColumn === column && assignment.holds !== KEY_ONLY}
                <span><Badge variant="success">Key of Each Row</Badge></span>
              {/if}
              {#if current !== null && (detail === "date" || detail === "closedDate") && firstDateColumn === column}
                <ChoicePicker
                  label="Date Order"
                  options={DATE_ORDER_OPTIONS}
                  value={current.dateOrder}
                  {disabled}
                  invalid={attempted && (problems?.dateOrderMissing ?? false)}
                  fillsCell
                  onchange={(dateOrder) =>
                    onChange({ ...current, dateOrder: dateOrder as FileMapping["dateOrder"] })}
                />
              {/if}
              {#if detail === "closedDate"}
                <span class="text-text-muted">Empty means the matter is open</span>
              {/if}
              {#if detail === "client" || detail === "party"}
                <ChoicePicker
                  label="Found Among the Rows Of"
                  options={referenceOptions}
                  value={assignment.referenceSourceKind}
                  {disabled}
                  invalid={detailRefused && assignment.referenceSourceKind === ""}
                  fillsCell
                  onchange={(referenceSourceKind) => assign(column, { referenceSourceKind })}
                />
              {/if}
              {#if detail === "party"}
                <ChoicePicker
                  label="Role"
                  options={ROLE_OPTIONS}
                  value={assignment.role}
                  {disabled}
                  invalid={detailRefused && assignment.role === ""}
                  fillsCell
                  onchange={(role) => assign(column, { role })}
                />
              {/if}
              {#if current !== null && detail === "matterTypes"}
                <span class="flex flex-wrap items-center gap-8">
                  <Badge variant="neutral">
                    {countLabel(Object.keys(current.matterTypes).length)}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    {disabled}
                    onclick={() => (matchTypesOpen = true)}
                  >
                    Match Types
                  </Button>
                </span>
              {/if}
              {#if current !== null && detail === "members"}
                <span class="flex flex-wrap items-center gap-8">
                  <Badge
                    variant={attempted && (problems?.responsibleMemberMissing ?? false)
                      ? "danger"
                      : "neutral"}
                  >
                    {countLabel(Object.keys(current.members).length)}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    {disabled}
                    onclick={() => (matchStaffOpen = true)}
                  >
                    Match Staff
                  </Button>
                </span>
              {/if}
            </span>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={4} title="No Results" />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

<div class="@container flex flex-col gap-16">
  {#if mapping === null && !noFile}
    <div class="max-w-xs">
      <LabelledField label="Contents">
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Contents"
            options={KIND_OPTIONS}
            value=""
            {disabled}
            onchange={(recordKind) => onChooseKind(recordKind as TransferRecordKind)}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/if}

  {#if previewFailure !== null}
    <FailureNotice
      failure={previewFailure.failure}
      subject="This file"
      fallback={previewFailure.fallback}
      whenSilent={previewFailure.whenSilent}
      onRetry={onRetryPreview}
    />
  {:else}
    <LoadingRegion
      loading={preview === null && !noFile}
      label="Reading the first rows of the file"
    >
      {#snippet fixture()}
        {@render table(FIXTURE.columns, FIXTURE.rows, null)}
      {/snippet}
      {#if preview !== null}
        {@render table(preview.columns, preview.rows, mapping)}
      {:else if noFile}
        {@render table([], [], null)}
      {/if}
    </LoadingRegion>

    {#if mapping !== null && problems !== null && problems.missing.length > 0}
      <div class="flex flex-wrap items-center gap-8">
        <FieldLabel>Still Needed</FieldLabel>
        {#each problems.missing as label (label)}
          <Badge variant={attempted ? "danger" : "outline"}>{label}</Badge>
        {/each}
      </div>
    {/if}

    {#if mapping !== null && (mapping.recordKind === "matter" || showCountry)}
      {@const current = mapping}
      <div class="flex flex-wrap gap-16">
        {#if current.recordKind === "matter"}
          <div class="w-full max-w-sm">
            <LabelledField
              label="Time Zone of the Dates"
              error={attempted && (problems?.timeZoneMissing ?? false)
                ? "Choose a time zone."
                : undefined}
            >
              {#snippet children({ props })}
                <TimeZonePicker
                  inputId={props.id}
                  label="Time Zone of the Dates"
                  preferred={[defaults.timeZone]}
                  bind:value={() => current.timeZone, (timeZone) => onChange({ ...current, timeZone })}
                  {disabled}
                />
              {/snippet}
            </LabelledField>
          </div>
        {/if}
        {#if showCountry}
          <div class="w-full max-w-sm">
            <LabelledField label="Country of the Addresses">
              {#snippet children({ props })}
                <ChoicePicker
                  inputId={props.id}
                  label="Country of the Addresses"
                  options={COUNTRY_OPTIONS}
                  value={current.addressCountry}
                  {disabled}
                  onchange={(addressCountry) => onChange({ ...current, addressCountry })}
                />
              {/snippet}
            </LabelledField>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if mapping !== null}
  {@const current = mapping}
  <MatchCodesDialog
    bind:open={matchTypesOpen}
    heading="Match Types"
    {fileName}
    targetLabel="Matter Type"
    targets={matterTypeOptions}
    matches={current.matterTypes}
    onSave={(matterTypes) => onChange({ ...current, matterTypes })}
  />
  <MatchCodesDialog
    bind:open={matchStaffOpen}
    heading="Match Staff"
    {fileName}
    targetLabel="Member"
    targets={memberOptions}
    matches={current.members}
    otherwise={current.otherwiseMember}
    onSave={(members, otherwiseMember) => onChange({ ...current, members, otherwiseMember })}
  />
{/if}
