<script lang="ts">
  /*
   * A language, picked from the ones Google translates between. The product's one field for a closed
   * choice, so it is the choice picker: a member types "spa" and Spanish is there.
   *
   * The source side offers Detect Language first, which is Google working it out; its value is
   * DETECT. A list that has not arrived yet, or could not be read, still shows the chosen value by
   * its code rather than an empty field, so the field never looks unset while it is set.
   */
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import { languageChoices, type TranslationLanguage } from "./translation-api.ts";

  let {
    languages,
    value = $bindable(""),
    inputId,
    label,
    detect = false,
    detectedName = "",
    disabled = false,
    onchange,
  }: {
    languages: readonly TranslationLanguage[];
    value?: string;
    inputId?: string;
    /** The field's own name, which is also its ghost text. */
    label: string;
    /** Whether Detect Language is the first choice. The source side only. */
    detect?: boolean;
    /** What Google found, shown beside Detect Language once a translation has run. */
    detectedName?: string;
    disabled?: boolean;
    onchange?: (value: string) => void;
  } = $props();

  const options = $derived.by((): ChoiceOption[] => {
    const known = languageChoices(languages);
    const chosenMissing =
      value !== "" && value !== DETECT && !known.some((option) => option.value === value);
    return [
      ...(detect
        ? [
            {
              value: DETECT,
              label: detectedName === "" ? "Detect Language" : `${detectedName} (Detected)`,
              keywords: ["detect", "automatic", "auto"],
            },
          ]
        : []),
      ...(chosenMissing ? [{ value, label: value }] : []),
      ...known,
    ];
  });
</script>

<script module lang="ts">
  /** The source value that means Google works the language out. */
  export const DETECT = "detect";
</script>

<ChoicePicker
  {options}
  bind:value
  {inputId}
  {label}
  {disabled}
  {onchange}
  whenNoMatch={(query) => `No language matches "${query}".`}
/>
