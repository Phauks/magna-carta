<script module lang="ts">
  /*
   * Form field family — Tier 4 (formsnap + superforms). Field/Control wire a control's name, id, and
   * the aria plumbing (aria-describedby → Description, aria-invalid + aria-describedby → FieldErrors)
   * automatically over our own inputs, so accessible, validated fields are a composition, not bespoke
   * wiring. The schema is zod 4 (a Standard Schema); the form runs client-side (SPA) so the story
   * validates without a server. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor } from "storybook/test";
  import { superForm, defaults } from "sveltekit-superforms";
  import { zod4 } from "sveltekit-superforms/adapters";
  import { z } from "zod";
  import * as Form from "../lib/components/form/index.ts";
  import Input from "../lib/components/input/index.ts";
  import Checkbox from "../lib/components/checkbox/index.ts";
  import Button from "../lib/components/button/index.ts";

  const schema = z.object({
    email: z.string().email("Enter a valid email address"),
    acceptTerms: z
      .boolean()
      .refine((value) => value === true, "You must accept the engagement terms"),
  });

  const { Story } = defineMeta({
    title: "Inputs/Form",
    parameters: { controls: { disable: true } },
  });
</script>

<script lang="ts">
  const form = superForm(defaults(zod4(schema)), {
    SPA: true,
    validators: zod4(schema),
    // Validate as the user types, so the catalog story shows errors without a server round-trip.
    validationMethod: "oninput",
    // The story renders more than once (sidebar + docs + test), so quiet the shared-id warning.
    warnings: { duplicateId: false },
  });
  const { form: formData, enhance } = form;
</script>

<Story
  name="Validation"
  play={async ({ canvas, step }) => {
    const email = canvas.getByRole("textbox", { name: "Email" });

    await step("A pristine field is not flagged", async () => {
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
    });

    await step("Typing an invalid value surfaces an associated error", async () => {
      await userEvent.type(email, "not-an-email");
      await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
      await expect(await canvas.findByText("Enter a valid email address")).toBeVisible();
      // formsnap points the control at the error via aria-describedby (axe validates the integrity).
      await expect(email).toHaveAttribute("aria-describedby");
    });

    await step("Correcting the value clears the error", async () => {
      await userEvent.clear(email);
      await userEvent.type(email, "partner@firm.example");
      await waitFor(() => expect(canvas.queryByText("Enter a valid email address")).toBeNull());
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
    });
  }}
>
  {#snippet template()}
    <form method="POST" use:enhance class="grid max-w-sm gap-16">
      <div class="mc-form-field">
        <Form.Field {form} name="email">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label>Email</Form.Label>
              <Input {...props} type="email" bind:value={$formData.email} />
            {/snippet}
          </Form.Control>
          <Form.Description>We use this for the engagement letter only.</Form.Description>
          <Form.FieldErrors />
        </Form.Field>
      </div>

      <div class="mc-form-field">
        <Form.Field {form} name="acceptTerms">
          <Form.Control>
            {#snippet children({ props })}
              <div class="flex items-center gap-8">
                <Checkbox {...props} bind:checked={$formData.acceptTerms} />
                <Form.Label>I accept the engagement terms</Form.Label>
              </div>
            {/snippet}
          </Form.Control>
          <Form.FieldErrors />
        </Form.Field>
      </div>

      <Button type="submit">Submit</Button>
    </form>
  {/snippet}
</Story>
