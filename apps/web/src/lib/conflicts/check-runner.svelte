<script lang="ts">
  /*
   * Running a conflicts check — the composable runner, so the standalone surface and the intake
   * flow ask the same question in the same words rather than growing two forms that drift.
   *
   * WHAT THE OPERATOR TYPES, AND WHAT THE SYSTEM DOES WITH IT. The operator names the parties and
   * the band; the engine expands each party out through the firm's recorded relationships and
   * matches every entity it reaches. A conflict arrives through a relationship at least as often as
   * through a name, which is why the traversal is part of the form rather than buried in a setting:
   * a check that walked nowhere is a different search from one that walked two relationships out,
   * and the person running it has to be able to say which they ran.
   *
   * THE FLOOR IS THE FIRM'S, NOT THIS FORM'S. A narrower request is raised to the firm's floor
   * before the search runs, and the check records that it was raised. So the party class is offered
   * checked and unchangeable, and every number left empty means the firm's own setting rather than
   * a value this form invented.
   *
   * A TRIGGER NAMES THE EVENT. Only the two triggers a person can honestly claim are offered; the
   * rest name a corpus change or the clock, and filing a manual run under one of those would claim
   * the firm's system caught something when somebody clicked.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Separator from "@magna-carta/design-system/separator";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import { MaturityBadge, soonControlProperties } from "@magna-carta/design-system/maturity";
  import EntityPicker, { type PickableEntity } from "@magna-carta/design-system/entity-picker";
  import { directoryPickerSearch } from "$lib/directory/directory-picker-source.ts";
  import { gapReason } from "./conflicts-gaps.ts";
  import {
    readFirmConflictsPolicy,
    runConflictsCheck,
    RUN_CHECK_PERMISSION,
    type FirmConflictsPolicy,
    type BudgetedEdgeClass,
    type ConflictsTrigger,
    type SourceClass,
    type Strictness,
  } from "./conflicts-api.ts";
  import {
    BUDGETED_EDGE_CLASSES,
    EDGE_CLASS_VOCABULARY,
    OPERATOR_TRIGGERS,
    SOURCE_VOCABULARY,
    STRICTNESS_LEVELS,
    STRICTNESS_VOCABULARY,
    edgeClassLabel,
    sourceVocabulary,
    strictnessVocabulary,
    triggerVocabulary,
  } from "./conflicts-vocabulary.ts";

  let {
    matterId = null,
    matterLabel = null,
    permissions = null,
    defaultTrigger = "comprehensive",
    onRan,
  }: {
    /** The matter the check is for, where the consumer has one. Lets imputation run. */
    matterId?: string | null;
    /** How that matter reads, so the form states what it is checking against. */
    matterLabel?: string | null;
    /** The signed-in member's permissions; null until the session lands. */
    permissions?: readonly string[] | null;
    defaultTrigger?: ConflictsTrigger;
    /** The check was written. The consumer decides where that leads. */
    onRan: (checkId: string) => void;
  } = $props();

  const fieldPrefix = $props.id();
  const contentDescription = `${fieldPrefix}-content`;
  const floorDescription = `${fieldPrefix}-floor`;

  /** What the Content class waits on. It is a standing fact about the platform, not about a run. */
  const CONTENT_DEPENDENCY =
    "an index over document text and a wired message-body index, neither of which exists";

  let parties = $state<PickableEntity[]>([]);
  const partySearch = directoryPickerSearch(fetch);
  // The opening value only: a consumer sets which trigger the form starts on, and from then on the
  // choice belongs to the person filling it in.
  // svelte-ignore state_referenced_locally
  let trigger = $state<ConflictsTrigger>(defaultTrigger);
  let strictness = $state<Strictness>("balanced");
  let searchGraph = $state(true);
  let searchImputation = $state(true);
  let budgets = $state<Record<BudgetedEdgeClass, string>>({
    control: "",
    family: "",
    representation: "",
  });
  let closureCap = $state("");
  let candidateCap = $state("");
  let running = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const soonContent = soonControlProperties(CONTENT_DEPENDENCY, contentDescription);

  /*
   * The firm's own floor, read so the empty fields above can say what they will actually take.
   * A reader composing a narrower scope is not being refused — resolveScope raises a request to the
   * floor server-side either way — they are being told what the floor is, which is the difference
   * between a form that looks configurable and one that is honest about its bounds.
   */
  let policy = $state<FirmConflictsPolicy | null>(null);
  $effect(() => {
    void (async () => {
      const outcome = await readFirmConflictsPolicy(fetch);
      if (outcome.kind === "ok") policy = outcome.value;
      // A floor that cannot be read is left unstated rather than guessed at: this panel already
      // says an empty field takes the firm's setting, which stays true whether or not it is shown.
    })();
  });

  // Imputation joins the firm's own members against a matter's parties, so with no matter there is
  // nothing to join and a check records the source unavailable rather than searched.
  const imputationAvailable = $derived(matterId !== null);
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));

  /** A budget field's value as the contract wants it: a whole number, or nothing at all. */
  function budgetOf(text: string): number | undefined {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  /** A field holding something unusable, so the control refuses before the server has to. */
  function malformed(text: string): boolean {
    return text.trim() !== "" && budgetOf(text) === undefined;
  }

  const refusal = $derived.by((): string | null => {
    if (permissions !== null && !mayRun) {
      return "Running a check needs the conflicts:run permission, which this account does not hold.";
    }
    if (parties.length === 0 && matterId === null) {
      return "A check searches for the parties it is given. Name at least one.";
    }
    const numeric: readonly (readonly [string, string])[] = [
      [edgeClassLabel("control"), budgets.control],
      [edgeClassLabel("family"), budgets.family],
      [edgeClassLabel("representation"), budgets.representation],
      ["Closure Cap", closureCap],
      ["Candidate Cap", candidateCap],
    ];
    for (const [name, text] of numeric) {
      if (malformed(text)) return `${name} takes a whole number, or nothing for the firm's own.`;
    }
    return null;
  });

  function sourcesAsked(): SourceClass[] {
    // Party is the firm-wide floor rather than a choice, so it is always asked for and the server
    // unions it back in regardless. Content has no corpus and is never asked for.
    const sources: SourceClass[] = ["party"];
    if (searchGraph) sources.push("graph");
    if (searchImputation && imputationAvailable) sources.push("imputation");
    return sources;
  }

  function resolvedBudgets(): Partial<Record<BudgetedEdgeClass, number>> {
    const resolved: Partial<Record<BudgetedEdgeClass, number>> = {};
    for (const edgeClass of BUDGETED_EDGE_CLASSES) {
      const budget = budgetOf(budgets[edgeClass]);
      if (budget !== undefined) resolved[edgeClass] = budget;
    }
    return resolved;
  }

  async function run(): Promise<void> {
    if (refusal !== null || running) return;
    running = true;
    failure = null;
    const edgeClassBudgets = resolvedBudgets();
    const closure = budgetOf(closureCap);
    const candidates = budgetOf(candidateCap);

    const outcome = await runConflictsCheck(
      fetch,
      {
        trigger,
        ...(matterId === null ? {} : { matterId }),
        subjectEntityIds: parties.map((party) => party.identifier),
        scope: {
          sources: sourcesAsked(),
          strictness,
          ...(Object.keys(edgeClassBudgets).length === 0 ? {} : { edgeClassBudgets }),
          ...(closure === undefined ? {} : { closureCap: closure }),
          ...(candidates === undefined ? {} : { candidateCap: candidates }),
        },
      },
      // A retried submit must not write a second check into the firm's append-only log.
      crypto.randomUUID(),
    );
    running = false;
    if (outcome.kind === "ok") {
      onRan(outcome.value.id);
      return;
    }
    failure = stated(
      outcome.failure,
      "The check was refused.",
      "The check could not be sent. Nothing was recorded.",
    );
  }
</script>

<div class="flex max-w-3xl flex-col gap-24">
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Check Did Not Run"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}

  <section class="flex flex-col gap-16">
    <h2 class="text-base font-semibold">Who The Check Is About</h2>

    <div class="flex flex-col gap-8">
      <Label for="{fieldPrefix}-parties">Subject Parties</Label>
      <!-- A check takes directory entities, never typed names: the one picker, in multiple mode. -->
      <EntityPicker
        search={partySearch}
        multiple
        bind:values={parties}
        label="Subject party"
        inputId="{fieldPrefix}-parties"
        disabled={running}
        disabledReason={running ? "The check is running." : undefined}
      />
    </div>

    {#if matterLabel !== null}
      <div class="flex flex-col gap-8">
        <Label>Matter</Label>
        <p class="text-sm">{matterLabel}</p>
      </div>
    {/if}

    <div class="flex flex-col gap-8">
      <Label id="{fieldPrefix}-trigger-label">Trigger</Label>
      <RadioGroup.Root bind:value={trigger} aria-labelledby="{fieldPrefix}-trigger-label">
        {#each OPERATOR_TRIGGERS as candidate (candidate)}
          {@const word = triggerVocabulary(candidate)}
          <div class="flex items-center gap-8">
            <RadioGroup.Item value={candidate} id="{fieldPrefix}-trigger-{candidate}" />
            <Label for="{fieldPrefix}-trigger-{candidate}" title={word.meaning}>{word.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
  </section>

  <Separator />

  <section class="flex flex-col gap-16">
    <h2 class="text-base font-semibold">What To Search</h2>

    <div class="flex flex-col gap-8">
      <div class="flex items-center gap-8">
        <Checkbox
          id="{fieldPrefix}-source-party"
          checked
          disabled
          title="The party class is the firm-wide floor rather than a choice: every check searches it."
        />
        <Label for="{fieldPrefix}-source-party" title={SOURCE_VOCABULARY.party?.meaning}>
          {SOURCE_VOCABULARY.party?.label}
        </Label>
      </div>

      <div class="flex items-center gap-8">
        <Checkbox id="{fieldPrefix}-source-graph" bind:checked={searchGraph} disabled={running} />
        <Label for="{fieldPrefix}-source-graph" title={SOURCE_VOCABULARY.graph?.meaning}>
          {SOURCE_VOCABULARY.graph?.label}
        </Label>
      </div>

      <div class="flex items-center gap-8">
        <Checkbox
          id="{fieldPrefix}-source-imputation"
          bind:checked={searchImputation}
          disabled={running || !imputationAvailable}
          title={imputationAvailable
            ? undefined
            : "No matter is named, so there are no matter parties to join the firm's members against."}
        />
        <Label for="{fieldPrefix}-source-imputation" title={SOURCE_VOCABULARY.imputation?.meaning}>
          {SOURCE_VOCABULARY.imputation?.label}
        </Label>
      </div>

      <div class="flex items-center gap-8">
        <Checkbox id="{fieldPrefix}-source-content" checked={false} {...soonContent} />
        <Label for="{fieldPrefix}-source-content" title={SOURCE_VOCABULARY.content?.meaning}>
          {SOURCE_VOCABULARY.content?.label}
        </Label>
        <MaturityBadge stage="soon" />
      </div>
      <p id={contentDescription} class="text-xs text-text-muted">{soonContent.title}</p>
    </div>

    <div class="flex flex-col gap-8">
      <Label id="{fieldPrefix}-strictness-label">Strictness</Label>
      <RadioGroup.Root bind:value={strictness} aria-labelledby="{fieldPrefix}-strictness-label">
        {#each STRICTNESS_LEVELS as level (level)}
          {@const word = STRICTNESS_VOCABULARY[level]}
          <div class="flex items-center gap-8">
            <RadioGroup.Item value={level} id="{fieldPrefix}-strictness-{level}" />
            <Label for="{fieldPrefix}-strictness-{level}" title={word.meaning}>{word.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
  </section>

  <Separator />

  <section class="flex flex-col gap-16">
    <h2 class="text-base font-semibold">How Far To Search</h2>

    <div class="grid grid-cols-1 gap-16 sm:grid-cols-3">
      {#each BUDGETED_EDGE_CLASSES as edgeClass (edgeClass)}
        <div class="flex flex-col gap-8">
          <Label
            for="{fieldPrefix}-budget-{edgeClass}"
            title={EDGE_CLASS_VOCABULARY[edgeClass]?.meaning}
          >
            {edgeClassLabel(edgeClass)}
          </Label>
          <Input
            id="{fieldPrefix}-budget-{edgeClass}"
            type="number"
            min="0"
            max="6"
            inputmode="numeric"
            placeholder={edgeClassLabel(edgeClass)}
            disabled={running}
            value={budgets[edgeClass]}
            oninput={(event) =>
              (budgets = { ...budgets, [edgeClass]: event.currentTarget.value })}
          />
        </div>
      {/each}
    </div>

    <div class="flex flex-col gap-8">
      <Label>{EDGE_CLASS_VOCABULARY.corporate?.label}</Label>
      <!-- Stated rather than offered: a rename, merger or successor chain of any length is the same
           legal person continuing, so it carries no hop budget for anyone to set. -->
      <p class="text-sm" title={EDGE_CLASS_VOCABULARY.corporate?.meaning}>
        Traversed transitively, bounded only by the closure cap.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-16 sm:grid-cols-2">
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-closure-cap">Closure Cap</Label>
        <Input
          id="{fieldPrefix}-closure-cap"
          type="number"
          min="0"
          inputmode="numeric"
          placeholder="Closure Cap"
          disabled={running}
          bind:value={closureCap}
        />
      </div>
      <div class="flex flex-col gap-8">
        <Label for="{fieldPrefix}-candidate-cap">Candidate Cap</Label>
        <Input
          id="{fieldPrefix}-candidate-cap"
          type="number"
          min="0"
          inputmode="numeric"
          placeholder="Candidate Cap"
          disabled={running}
          bind:value={candidateCap}
        />
      </div>
    </div>

    <p class="text-sm text-text-muted">An empty field takes the firm's own setting.</p>
    {#if policy !== null}
      <!-- The floor, stated. A per-run scope may only ADD to it: a narrower request is raised back
           to the floor before it runs, so what a reader chooses here can widen the search and can
           never narrow it below what the firm requires. -->
      <dl id={floorDescription} class="flex flex-col gap-2 text-xs text-text-muted">
        <div class="flex gap-8">
          <dt>Firm floor</dt>
          <dd class="text-text-default">
            {policy.floorSources.map((source) => sourceVocabulary(source).label).join(", ")} ·
            {strictnessVocabulary(policy.floorStrictness).label}
          </dd>
        </div>
        <div class="flex gap-8">
          <dt>Defaults</dt>
          <dd class="text-text-default tabular-nums">
            depth {policy.defaultDepth} · closure cap {policy.closureCap} · candidate cap
            {policy.candidateCap}
          </dd>
        </div>
      </dl>
    {/if}
  </section>

  <div class="flex flex-wrap items-center gap-16">
    <Button
      variant="primary"
      disabled={refusal !== null || running}
      title={refusal ?? undefined}
      onclick={() => void run()}
    >
      <ShieldAlert class="size-16" aria-hidden="true" />
      {running ? "Running the check" : "Run the check"}
    </Button>
    {#if refusal !== null}
      <span class="text-xs text-text-muted">{refusal}</span>
    {/if}
  </div>
</div>
