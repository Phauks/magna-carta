<script module lang="ts">
  /*
   * VerificationCodeInput — Compound Inputs (segmented one-time-code entry over Bits UI PinInput).
   * `charset` IS a variant axis and gets a story each: the two settings raise different keyboards
   * and accept different characters, because they model two different issuers. `length` and
   * `disabled` stay Controls. Bits components whitelist controls (see CLAUDE.md) — its prop type
   * materialises every HTML attribute otherwise. The typing, backspace and paste behaviours ride a
   * hidden test-only story. svelte-csf v5.
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
    argTypes: {
      charset: { control: "select", options: ["numeric", "alphanumeric"] },
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

{#snippet alphanumericTemplate()}
  <VerificationCodeInput aria-label="Emailed code" charset="alphanumeric" length={8} />
{/snippet}

<!--
  The setting for a code this platform generates and sends. A numeric-only field would reject a
  code we issued ourselves, which reads to the holder as "the code is wrong".
-->
<Story
  name="Alphanumeric"
  template={alphanumericTemplate}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Emailed code");
    await step("Raises a text keyboard, and accepts letters", async () => {
      await expect(field).toHaveAttribute("inputmode", "text");
      await userEvent.click(field);
      await userEvent.keyboard("k7f2");
    });
    await step("Uppercases as it is typed, so a transcription cannot be mangled", async () => {
      await expect(field).toHaveValue("K7F2");
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
