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
  import tlds from "tlds";
  import * as Form from "../lib/components/form/index.ts";
  import Input from "../lib/components/input/index.ts";
  import Checkbox from "../lib/components/checkbox/index.ts";
  import Button from "../lib/components/button/index.ts";

  // Validate the address shape, then check its ending against the real top-level domains — so not a
  // length rule ("tre@mail.c") nor a plausible-but-fake ending ("tre@mail.zz") passes, only a TLD
  // that exists. The list is `tlds` (the IANA root zone, auto-published), the same source the app's
  // form schemas use — so there is one list to track, never a hand-maintained set that drifts.
  const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.([a-z]{2,})$/i;
  const KNOWN_TLDS = new Set(tlds);

  function isKnownEmail(value: string): boolean {
    const tld = EMAIL_SHAPE.exec(value)?.[1]?.toLowerCase();
    return tld !== undefined && KNOWN_TLDS.has(tld);
  }

  const schema = z.object({
    email: z.string().refine(isKnownEmail, "Enter a valid email address"),
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

    await step("An unknown TLD is rejected (checked against known endings, not just length)", async () => {
      // .c is too short and .zz is not a real TLD — both must fail, unlike a bare length rule.
      for (const bad of ["tre@mail.c", "tre@mail.zz"]) {
        await userEvent.clear(email);
        await userEvent.type(email, bad);
        await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
        await expect(canvas.getByText("Enter a valid email address")).toBeVisible();
      }
    });

    await step("Correcting the value clears the error", async () => {
      await userEvent.clear(email);
      await userEvent.type(email, "partner@firm.com");
      await waitFor(() => expect(canvas.queryByText("Enter a valid email address")).toBeNull());
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
    });

    await step("Submitting validates in place — no navigation", async () => {
      await userEvent.click(canvas.getByRole("checkbox", { name: "I accept the engagement terms" }));
      await userEvent.click(canvas.getByRole("button", { name: "Submit" }));
      // The dialog/page did not navigate away: the form is still here.
      await expect(canvas.getByRole("button", { name: "Submit" })).toBeVisible();
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
