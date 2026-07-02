<script module lang="ts">
  /*
   * Input — Tier 1 (form control). Catalog model: Input is the deliberate EXCEPTION to "type is a
   * Control, not a story" — the text-like types aren't interchangeable (each has its own validation
   * + picker), so each gets its own story. `type` stays a `control: "select"`.
   *
   * Consolidated controls rule (every story follows it): `args` holds ONLY the component's declared
   * props (type, placeholder, disabled) — they land in the "Properties" group. Per-instance
   * attributes (the accessible name; number's min/max/step) live in the TEMPLATE, never `args`, so
   * nothing floats above "Properties". `ref` is hidden and the table is alpha-sorted globally
   * (preview.ts). svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent } from "storybook/test";
  import Input from "../lib/components/input/index.ts";

  const { Story } = defineMeta({
    title: "Inputs/Input",
    component: Input,
    argTypes: {
      type: {
        control: "select",
        options: [
          "text",
          "email",
          "password",
          "search",
          "tel",
          "url",
          "number",
          "date",
          "datetime-local",
          "month",
          "week",
          "time",
        ],
        // The value must stay the HTML-standard token (`<input type="tel">`; `type="telephone"` is
        // invalid and degrades to text), so spell it out for the picker via a display label only.
        labels: {
          tel: "Telephone",
          url: "URL",
          "datetime-local": "Date and time",
        },
      },
    },
  });

  type InputStoryArgs = ComponentProps<typeof Input>;
</script>

<!-- Shared frame: a constrained field stands in for the form. The accessible name lives here (not in
     args) so it never floats above the Properties table. -->
{#snippet template(args: InputStoryArgs)}
  <div class="max-w-xs">
    <Input aria-label="Example field" {...args} />
  </div>
{/snippet}

<!-- text — the default; free-form single-line text (the Docs-page Primary). -->
<Story
  name="Text"
  {template}
  args={{ type: "text", placeholder: "Matter reference" }}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Example field");
    await step("Is a text field", async () => {
      await expect(field).toHaveAttribute("type", "text");
    });
    await step("Accepts typed text", async () => {
      await userEvent.type(field, "ACME-2026-014");
      await expect(field).toHaveValue("ACME-2026-014");
    });
  }}
/>

<!-- email — format-validated (the browser rejects a value that isn't an address). -->
<Story
  name="Email"
  {template}
  args={{ type: "email", placeholder: "client@example.com" }}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Example field") as HTMLInputElement;
    await step("Is an email field", async () => {
      await expect(field).toHaveAttribute("type", "email");
    });
    await step("Rejects a value that isn't an address", async () => {
      await userEvent.type(field, "not-an-email");
      await expect(field.checkValidity()).toBe(false);
    });
  }}
/>

<!-- password — masked entry (the show/hide eye toggle is a compound PasswordInput, slice 0·7b). -->
<Story
  name="Password"
  {template}
  args={{ type: "password", placeholder: "Enter your password" }}
  play={async ({ canvas, step }) => {
    await step("Is a masked password field", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "password");
    });
  }}
/>

<!-- search — a search field (UA may add a clear affordance). -->
<Story
  name="Search"
  {template}
  args={{ type: "search", placeholder: "Search matters…" }}
  play={async ({ canvas, step }) => {
    await step("Is a search field", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "search");
    });
  }}
/>

<!-- tel — a telephone number (NOT format-validated). The dial/country code is a separate selector
     (the PhoneInput compound), so the example is national-format only. -->
<Story
  name="Telephone"
  {template}
  args={{ type: "tel", placeholder: "020 7946 0000" }}
  play={async ({ canvas, step }) => {
    await step("Is a telephone field", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "tel");
    });
  }}
/>

<!-- url — URL-validated (the browser rejects a value that isn't a URL). -->
<Story
  name="URL"
  {template}
  args={{ type: "url", placeholder: "https://example.com" }}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Example field") as HTMLInputElement;
    await step("Is a URL field", async () => {
      await expect(field).toHaveAttribute("type", "url");
    });
    await step("Rejects a value that isn't a URL", async () => {
      await userEvent.type(field, "not a url");
      await expect(field.checkValidity()).toBe(false);
    });
  }}
/>

<!-- number — numeric only; the min/max/step constraints live in the template (per-instance, not a
     global control). -->
<Story
  name="Number"
  args={{ type: "number", placeholder: "Hours" }}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Example field") as HTMLInputElement;
    await step("Is a number field", async () => {
      await expect(field).toHaveAttribute("type", "number");
    });
    await step("Accepts a value within min/max/step", async () => {
      await userEvent.type(field, "8.5");
      await expect(field).toHaveValue(8.5);
      await expect(field.checkValidity()).toBe(true);
    });
  }}
>
  {#snippet template(args: InputStoryArgs)}
    <div class="max-w-xs">
      <Input aria-label="Example field" min={0} max={24} step={0.1} {...args} />
    </div>
  {/snippet}
</Story>

<!-- date — a calendar-day picker; the value is an ISO date (no free text). -->
<Story
  name="Date"
  {template}
  args={{ type: "date" }}
  play={async ({ canvas, step }) => {
    await step("Is a date picker", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "date");
    });
  }}
/>

<!-- datetime-local — a date + wall-clock time (no timezone), for local appointments. -->
<Story
  name="Date and time"
  {template}
  args={{ type: "datetime-local" }}
  play={async ({ canvas, step }) => {
    await step("Is a date-and-time picker", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute(
        "type",
        "datetime-local",
      );
    });
  }}
/>

<!-- month — a year + month picker. -->
<Story
  name="Month"
  {template}
  args={{ type: "month" }}
  play={async ({ canvas, step }) => {
    await step("Is a month picker", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "month");
    });
  }}
/>

<!-- week — a year + ISO week-number picker; native week is ISO Monday-start only (a configurable
     week-start is the custom Calendar/DatePicker's job). -->
<Story
  name="Week"
  {template}
  args={{ type: "week" }}
  play={async ({ canvas, step }) => {
    await step("Is a week picker", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "week");
    });
  }}
/>

<!-- time — a wall-clock time picker. -->
<Story
  name="Time"
  {template}
  args={{ type: "time" }}
  play={async ({ canvas, step }) => {
    await step("Is a time picker", async () => {
      await expect(canvas.getByLabelText("Example field")).toHaveAttribute("type", "time");
    });
  }}
/>

<!-- Behaviour: disabled blocks input. Hidden from the catalog, still run by the test addon. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const field = canvas.getByLabelText("Disabled field");
    await step("Disabled input ignores typing", async () => {
      await expect(field).toBeDisabled();
      await userEvent.type(field, "nope", { pointerEventsCheck: 0 });
      await expect(field).toHaveValue("Read only");
    });
  }}
>
  {#snippet template()}
    <Input aria-label="Disabled field" disabled value="Read only" />
  {/snippet}
</Story>
