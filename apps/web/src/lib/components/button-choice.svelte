<script lang="ts" module>
  export interface ButtonChoiceOption<Choice extends string> {
    readonly value: Choice;
    readonly label: string;
    /** What the answer means, on hover. */
    readonly title?: string;
  }
</script>

<script lang="ts" generics="Value extends string">
  /*
   * A short, fixed choice answered by pressing one of its buttons.
   *
   * FOR TWO TO FOUR ANSWERS THAT ARE ALWAYS THE SAME. The searchable picker
   * (`$lib/components/choice-picker.svelte`) stays the answer for any list a reader might need to
   * narrow; a call's type and its direction are two words each, they never grow, and somebody still
   * on the telephone answers them faster by pressing one than by opening a list (owner, 2026-11-09:
   * "make the call text, incoming/outgoing as a toggle, makes it easier").
   *
   * The pressed answer renders as the secondary button and the rest as ghosts, which is the same
   * pressed-state language the view switch and the task window's rungs already speak, so a reader
   * learns it once.
   */
  import Button from "@magna-carta/design-system/button";

  let {
    label,
    options,
    value,
    disabled = false,
    onchange,
  }: {
    /** The question, said to assistive technology as the group's name. */
    label: string;
    options: readonly ButtonChoiceOption<Value>[];
    /** The pressed answer, or null while none has been chosen. */
    value: Value | null;
    disabled?: boolean;
    onchange: (next: Value) => void;
  } = $props();
</script>

<div
  role="group"
  aria-label={label}
  class="inline-flex flex-wrap items-center gap-4 self-start rounded-md border border-border-default p-4"
>
  {#each options as option (option.value)}
    {@const pressed = option.value === value}
    <Button
      size="sm"
      variant={pressed ? "secondary" : "ghost"}
      aria-pressed={pressed}
      {disabled}
      title={option.title}
      onclick={() => {
        if (!pressed) onchange(option.value);
      }}
    >
      {option.label}
    </Button>
  {/each}
</div>
