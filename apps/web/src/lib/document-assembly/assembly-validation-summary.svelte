<script lang="ts">
  /*
   * The validation summary — one place that says what is standing between this form and an
   * assembled document, and what will merely come out blank.
   *
   * Errors and warnings are kept apart on purpose. An error is something a person must fix; a
   * warning names a field that will resolve from the matter's data or appear as a blank, which is
   * information they need before filing but not a reason to stop them. Collapsing the two is how a
   * form either blocks on things that are fine, or lets a blank reach a filing unremarked.
   *
   * Announcement is the Alert's own: each variant already carries the right ARIA role (assertive
   * for danger and warning, polite for info and success), so the container adds no live region of
   * its own — two overlapping live regions read the same text twice.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import type { AssemblyValidationSummary } from "./assembly-input-model.ts";

  let {
    summary,
    attempted = false,
  }: {
    summary: AssemblyValidationSummary;
    /** Whether the person has tried to assemble yet. Before that, errors are not shouted about. */
    attempted?: boolean;
  } = $props();

  const errors = $derived(summary.issues.filter((issue) => issue.severity === "error"));
  const warnings = $derived(summary.issues.filter((issue) => issue.severity === "warning"));
  const showErrors = $derived(attempted && errors.length > 0);
</script>

<div class="flex flex-col gap-8">
  {#if showErrors}
    <Alert.Root variant="danger">
      <Alert.Title>
        {errors.length === 1
          ? "One field needs attention before this can be assembled"
          : `${errors.length} fields need attention before this can be assembled`}
      </Alert.Title>
      <Alert.Description>
        <ul class="flex flex-col gap-4">
          {#each errors as issue (issue.key ?? issue.label)}
            <li><span class="font-semibold">{issue.label}</span> — {issue.message}</li>
          {/each}
        </ul>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if warnings.length > 0}
    <Alert.Root variant="warning">
      <Alert.Title>
        {warnings.length === 1
          ? "One field will be filled from the matter, or left blank"
          : `${warnings.length} fields will be filled from the matter, or left blank`}
      </Alert.Title>
      <Alert.Description>
        <ul class="flex flex-col gap-4">
          {#each warnings as issue (issue.key ?? issue.label)}
            <li><span class="font-semibold">{issue.label}</span> — {issue.message}</li>
          {/each}
        </ul>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if attempted && summary.ready && warnings.length === 0}
    <Alert.Root variant="success">
      <Alert.Title>All fields in this template have a value.</Alert.Title>
    </Alert.Root>
  {/if}
</div>
