<script module lang="ts">
  /*
   * PasswordInput — Compound Inputs (a field plus its in-field Show/Hide affordance). No variant
   * axis, so ONE showcase story; `disabled`, `placeholder`, and the two toggle labels are Controls,
   * declared on the component so docgen lists them under "Properties". The reveal behaviour and the
   * disabled toggle ride hidden test-only stories. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import PasswordInput from "../lib/components/password-input/index.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/PasswordInput",
    component: PasswordInput,
  });

  type PasswordInputStoryArgs = ComponentProps<typeof PasswordInput>;
</script>

{#snippet template(args: PasswordInputStoryArgs)}
  <PasswordInput aria-label="Password" autocomplete="current-password" {...args} />
{/snippet}

<!-- The showcase + Docs Primary; set disabled / placeholder via the Controls panel. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Password");
    const toggle = canvas.getByRole("button", { name: "Show password" });
    await step("Starts hidden, and the toggle offers to show", async () => {
      await expect(field).toHaveAttribute("type", "password");
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    });
    await step("Pressing the toggle reveals the value and renames itself", async () => {
      await userEvent.click(toggle);
      await expect(field).toHaveAttribute("type", "text");
      await expect(canvas.getByRole("button", { name: "Hide password" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    await step("Pressing it again hides the value", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Hide password" }));
      await expect(field).toHaveAttribute("type", "password");
    });
  }}
/>

<!-- Behaviour: the toggle never submits its form, and typing survives a reveal. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Secret") as HTMLInputElement;
    await step("Typing then revealing keeps the value", async () => {
      await userEvent.type(field, "correct-horse");
      await userEvent.click(canvas.getByRole("button", { name: "Show password" }));
      await expect(field).toHaveValue("correct-horse");
    });
    await step("The toggle is type=button, so it cannot submit the surrounding form", async () => {
      await expect(canvas.getByRole("button", { name: "Hide password" })).toHaveAttribute(
        "type",
        "button",
      );
    });
    await step("A disabled field disables the toggle too", async () => {
      await expect(canvas.getByRole("button", { name: "Reveal the locked value" })).toBeDisabled();
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col gap-8">
      <PasswordInput aria-label="Secret" />
      <PasswordInput
        aria-label="Locked"
        showLabel="Reveal the locked value"
        hideLabel="Conceal the locked value"
        disabled
      />
    </div>
  {/snippet}
</Story>
