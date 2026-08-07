<script module lang="ts">
  /*
   * VerificationCodeInput — Compound Inputs (segmented one-time-code entry over Bits UI PinInput).
   * No variant axis, so ONE showcase story; `length` and `disabled` are Controls. Bits components
   * whitelist controls (see CLAUDE.md) — its prop type materialises every HTML attribute otherwise.
   * The typing, backspace and paste behaviours ride a hidden test-only story. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import VerificationCodeInput from "../lib/components/verification-code-input/index.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/VerificationCodeInput",
    component: VerificationCodeInput,
    args: { length: 6, disabled: false },
    parameters: {
      controls: { include: ["length", "disabled", "value"] },
    },
  });

  type VerificationCodeInputStoryArgs = ComponentProps<typeof VerificationCodeInput>;
</script>

<script lang="ts">
  // Captures the onComplete callback so the behaviour story can assert it fired with the full code.
  let completedCode = $state("");
</script>

{#snippet template(args: VerificationCodeInputStoryArgs)}
  <VerificationCodeInput aria-label="Authentication code" {...args} />
{/snippet}

<!-- The showcase + Docs Primary; set length / disabled via the Controls panel. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Authentication code");
    await step("Is one field that autofill can target as a one-time code", async () => {
      await expect(field).toHaveAttribute("autocomplete", "one-time-code");
      await expect(field).toHaveAttribute("inputmode", "numeric");
    });
    await step("Typing fills the cells in order", async () => {
      await userEvent.click(field);
      await userEvent.keyboard("491");
      await expect(field).toHaveValue("491");
    });
    await step("Backspace clears the last cell", async () => {
      await userEvent.keyboard("{Backspace}");
      await expect(field).toHaveValue("49");
    });
  }}
/>

<!-- Behaviour: a pasted code fills every cell, and completion fires once the last one lands. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Pasted code");
    await step("Pasting a whole code fills every cell and reports completion", async () => {
      await userEvent.click(field);
      await userEvent.paste("284915");
      await expect(field).toHaveValue("284915");
      await expect(canvas.getByTestId("completed-code")).toHaveTextContent("284915");
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col gap-8">
      <VerificationCodeInput
        aria-label="Pasted code"
        onComplete={(code: string) => (completedCode = code)}
      />
      <span data-testid="completed-code">{completedCode}</span>
    </div>
  {/snippet}
</Story>
