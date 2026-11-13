/*
 * The firm's AI settings as a draft the settings page can stage and save — server-backed, on the
 * report-policy draft's pattern (report-policy-draft.svelte.ts says why a firm setting with a server
 * behind it keeps no per-browser copy and writes no per-browser history).
 *
 * Three settings, in two plates that are two questions. Whether the firm's content may reach a
 * third-party model AT ALL is the first; whether the assistant is one of the things that may send
 * it, and how much of it a day, is the second. Neither gate implies the other — a firm that enabled
 * inference for drafting has not consented to a free-form assistant, and a firm that switches the
 * assistant off has not withdrawn consent for everything else — so the page asks both and the
 * server reads both.
 *
 * Every question the rows and the footer ask is answered from the one read of
 * GET /api/v1/firm/ai/settings; a save is PATCH on the same route, audited there, and the value in
 * force is what the server said back. A save that fails keeps the stage, with the failure beside it.
 */
import type { Failure } from "$lib/api/request.ts";
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";
import {
  DAILY_TURN_CEILING_MAXIMUM,
  DAILY_TURN_CEILING_MINIMUM,
  readFirmAiSettings,
  updateFirmAiSettings,
  type AiModelChoice,
  type FirmAiSettings,
} from "./ai-settings-api.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const AI_SETTINGS_SECTION_ID = "ai";

const AI_PROCESSING_PLATE = "Third-Party AI Processing";
const MAGNUS_PLATE = "Magnus, the Assistant";

export const AI_PROCESSING_ELIGIBILITY_DEFINITION: SettingDefinition = {
  id: "ai.processing-eligibility",
  sectionId: AI_SETTINGS_SECTION_ID,
  plateLabel: AI_PROCESSING_PLATE,
  label: "Send Content to a Model",
  description:
    "Whether this firm's content may be sent to a third-party model at all. Every AI feature is off while this is off.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

export const MAGNUS_ENABLED_DEFINITION: SettingDefinition = {
  id: "ai.magnus-enabled",
  sectionId: AI_SETTINGS_SECTION_ID,
  plateLabel: MAGNUS_PLATE,
  label: "Magnus",
  description:
    "Whether members of this firm can hold a conversation with the assistant. It needs third-party AI processing above as well.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

export const MAGNUS_DAILY_TURN_CEILING_DEFINITION: SettingDefinition = {
  id: "ai.magnus-daily-turn-ceiling",
  sectionId: AI_SETTINGS_SECTION_ID,
  plateLabel: MAGNUS_PLATE,
  label: "Questions a Day",
  description:
    "How many questions the whole firm may ask the assistant in a day. Asking past it is refused until the next day.",
  kind: "number",
  minimum: DAILY_TURN_CEILING_MINIMUM,
  maximum: DAILY_TURN_CEILING_MAXIMUM,
  unit: "question",
  defaultValue: 500,
  sensitivity: "open",
  audited: true,
};

/**
 * The value the model choice stores for "follow the platform". A roster id is provider-prefixed, so
 * this can never collide with one; it is spelled here once rather than at each place that compares.
 */
export const PLATFORM_MODEL_CHOICE = "platform";

const MODEL_PLATE = "The Model Your Content Reaches";

/**
 * The model choice's definition, MINUS its options: the options are the roster the server sends,
 * so the whole definition is composed per read (`AiSettingsDraft.modelDefinition`). The id and the
 * words are fixed here so the staging, the recap and the row all agree on them.
 */
export const MODEL_CHOICE_DEFINITION_BASE: Omit<SettingDefinition, "options"> = {
  id: "ai.model",
  sectionId: AI_SETTINGS_SECTION_ID,
  plateLabel: MODEL_PLATE,
  label: "Model",
  description:
    "Which model answers. Magna Carta's default moves to newer models as they're checked; a model you choose stays until you change it.",
  kind: "select",
  defaultValue: PLATFORM_MODEL_CHOICE,
  sensitivity: "open",
  audited: true,
};

export const AI_SETTINGS_DEFINITIONS: readonly SettingDefinition[] = [
  AI_PROCESSING_ELIGIBILITY_DEFINITION,
  MODEL_CHOICE_DEFINITION_BASE,
  MAGNUS_ENABLED_DEFINITION,
  MAGNUS_DAILY_TURN_CEILING_DEFINITION,
];

type StagedFields = {
  eligible?: boolean;
  /** A roster id, or PLATFORM_MODEL_CHOICE for following the platform. */
  model?: string;
  enabled?: boolean;
  dailyTurnCeiling?: number;
};

type FieldKey = keyof StagedFields;

const FIELD_BY_DEFINITION: Readonly<Record<string, FieldKey>> = {
  [AI_PROCESSING_ELIGIBILITY_DEFINITION.id]: "eligible",
  [MODEL_CHOICE_DEFINITION_BASE.id]: "model",
  [MAGNUS_ENABLED_DEFINITION.id]: "enabled",
  [MAGNUS_DAILY_TURN_CEILING_DEFINITION.id]: "dailyTurnCeiling",
};

// The closed posture, and the one the page renders before the read lands: both gates shut. It is
// also what the platform ships, so a page that briefly shows it is never showing a firm something
// more permissive than the truth.
const DEFAULT_SETTINGS: FirmAiSettings = {
  aiProcessing: { eligible: false },
  model: null,
  models: [],
  catalog: { version: 0, effectiveDate: "" },
  provider: { status: "not-configured", checkedAt: null, awaitingVerification: [] },
  magnus: { enabled: false, dailyTurnCeiling: 500 },
};

/** How a roster entry reads as a choice: the provider's own name for it. */
function modelChoiceLabel(choice: AiModelChoice): string {
  return choice.displayName;
}

export class AiSettingsDraft extends SettingsDraft {
  /** What the server said the firm's settings are; null until the read lands. */
  committed = $state<FirmAiSettings | null>(null);
  readFailure = $state<Failure | null>(null);
  /** The staged values, held only while they differ from the committed ones. */
  #staged = $state<StagedFields>({});
  saving = $state(false);
  saveFailure = $state<Failure | null>(null);
  #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch) {
    super(AI_SETTINGS_SECTION_ID);
    this.#fetchImpl = fetchImpl;
  }

  get loaded(): boolean {
    return this.committed !== null;
  }

  /**
   * The assistant's EFFECTIVE state as the server will read it: both gates open, staged values
   * included. The page states this rather than leaving a member to compose two switches in their
   * head — an assistant switched on above a closed processing gate does nothing, and a screen that
   * shows only "on" would be telling them it works.
   */
  get magnusReachesAModel(): boolean {
    return (
      this.stagedValue(AI_PROCESSING_ELIGIBILITY_DEFINITION) === true &&
      this.stagedValue(MAGNUS_ENABLED_DEFINITION) === true
    );
  }

  /**
   * The model choice's definition with the roster as its options: "the platform's current model"
   * first, naming what that is today, then every verified entry. Composed from the read rather than
   * written once, so the options are exactly the roster the server will accept.
   */
  get modelDefinition(): SettingDefinition {
    const settings = this.committed ?? DEFAULT_SETTINGS;
    const platform = settings.models.find((choice) => choice.platformDefault);
    return {
      ...MODEL_CHOICE_DEFINITION_BASE,
      options: [
        {
          value: PLATFORM_MODEL_CHOICE,
          label:
            platform === undefined
              ? "Magna Carta's default model"
              : `Magna Carta's default model (${platform.displayName})`,
        },
        ...settings.models.map((choice) => ({
          value: choice.modelId,
          label: modelChoiceLabel(choice),
        })),
      ],
    };
  }

  /**
   * The roster entry the STAGED choice names, so the facts beneath the control describe what is
   * about to be saved rather than what was saved last — a form whose result is invisible reads back
   * what it will do.
   */
  get stagedModelChoice(): AiModelChoice | null {
    const settings = this.committed;
    if (settings === null) return null;
    const staged = this.stagedValue(this.modelDefinition);
    const modelId =
      staged === PLATFORM_MODEL_CHOICE
        ? (settings.models.find((choice) => choice.platformDefault)?.modelId ??
          settings.model?.modelId)
        : String(staged);
    return settings.models.find((choice) => choice.modelId === modelId) ?? null;
  }

  async load(): Promise<void> {
    const outcome = await readFirmAiSettings(this.#fetchImpl);
    if (outcome.kind === "ok") {
      this.committed = outcome.value;
      this.readFailure = null;
    } else {
      this.readFailure = outcome.failure;
    }
  }

  #committedValue(key: FieldKey): SettingValue {
    const settings = this.committed ?? DEFAULT_SETTINGS;
    switch (key) {
      case "eligible":
        return settings.aiProcessing.eligible;
      case "model":
        // A firm following the platform holds the platform choice, whatever model that is today; a
        // firm that has chosen holds the id it chose.
        return settings.model === null || settings.model.selection === "platform"
          ? PLATFORM_MODEL_CHOICE
          : settings.model.modelId;
      case "enabled":
        return settings.magnus.enabled;
      case "dailyTurnCeiling":
        return settings.magnus.dailyTurnCeiling;
    }
  }

  override value(definition: SettingDefinition): SettingValue {
    const key = FIELD_BY_DEFINITION[definition.id];
    return key === undefined ? definition.defaultValue : this.#committedValue(key);
  }

  override stagedValue(definition: SettingDefinition): SettingValue {
    const key = FIELD_BY_DEFINITION[definition.id];
    if (key === undefined) return definition.defaultValue;
    return this.#staged[key] ?? this.#committedValue(key);
  }

  override stage(definition: SettingDefinition, next: SettingValue): void {
    const key = FIELD_BY_DEFINITION[definition.id];
    if (key === undefined) return;
    const staged: StagedFields = { ...this.#staged };
    // A value the field's own type cannot carry, or the committed value staged back, is no change.
    if (next === this.#committedValue(key)) delete staged[key];
    else if (key === "dailyTurnCeiling") {
      if (typeof next !== "number" || !Number.isInteger(next)) return;
      staged[key] = next;
    } else if (key === "model") {
      if (typeof next !== "string" || next === "") return;
      staged[key] = next;
    } else {
      if (typeof next !== "boolean") return;
      staged[key] = next;
    }
    this.#staged = staged;
  }

  override isStaged(definition: SettingDefinition): boolean {
    const key = FIELD_BY_DEFINITION[definition.id];
    return key !== undefined && this.#staged[key] !== undefined;
  }

  override get stagedCount(): number {
    return Object.keys(this.#staged).length;
  }

  override get stagedEntries(): ReadonlyArray<{
    definition: SettingDefinition;
    from: SettingValue;
    to: SettingValue;
  }> {
    return AI_SETTINGS_DEFINITIONS.flatMap((base) => {
      const key = FIELD_BY_DEFINITION[base.id];
      const to = key === undefined ? undefined : this.#staged[key];
      if (key === undefined || to === undefined) return [];
      // The model's recap needs the roster as options, so its label reads as a choice.
      const definition = key === "model" ? this.modelDefinition : base;
      return [{ definition, from: this.#committedValue(key), to }];
    });
  }

  override get requiresConfirm(): boolean {
    return false;
  }

  override discard(): void {
    this.#staged = {};
    this.saveFailure = null;
  }

  override save(): void {
    void this.commit();
  }

  async commit(): Promise<void> {
    const staged = this.#staged;
    if (Object.keys(staged).length === 0 || this.saving) return;
    this.saving = true;
    this.saveFailure = null;
    // One key per attempt: a retry after a failure is a new attempt, and a duplicate of a landed
    // one is what the key on the server catches.
    const outcome = await updateFirmAiSettings(
      this.#fetchImpl,
      {
        ...(staged.eligible === undefined ? {} : { aiProcessing: { eligible: staged.eligible } }),
        ...(staged.model === undefined
          ? {}
          : { model: { modelId: staged.model === PLATFORM_MODEL_CHOICE ? null : staged.model } }),
        ...(staged.enabled === undefined && staged.dailyTurnCeiling === undefined
          ? {}
          : {
              magnus: {
                ...(staged.enabled === undefined ? {} : { enabled: staged.enabled }),
                ...(staged.dailyTurnCeiling === undefined
                  ? {}
                  : { dailyTurnCeiling: staged.dailyTurnCeiling }),
              },
            }),
      },
      crypto.randomUUID(),
    );
    this.saving = false;
    if (outcome.kind !== "ok") {
      this.saveFailure = outcome.failure;
      return;
    }
    this.committed = outcome.value;
    this.#staged = {};
  }
}
