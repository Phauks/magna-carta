<script module lang="ts">
  /*
   * Toast — Tier 3 batch (wraps svelte-sonner, not Bits UI). One composed showcase: the <Toaster />
   * host mounted once, plus trigger buttons that fire each intent (success/error/info/warning), a
   * plain toast with a description, and one with an action. Toasts portal to <body> and auto-dismiss,
   * so the play function asserts against `within(document.body)` with tolerant waits (findByText),
   * and dismisses between steps so they don't pile up. svelte-csf v5. Bits-style attribute controls
   * don't apply here, so the whitelist is empty.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import { Toaster, toast } from "../lib/components/toast/index.ts";

  const { Story } = defineMeta({
    title: "Feedback/Toast",
    component: Toaster,
    parameters: {
      controls: { include: [] },
    },
  });

  // Short duration so a toast clears quickly between steps rather than lingering across them.
  const DURATION = 1500;
</script>

{#snippet template()}
  <Toaster duration={DURATION} />
  <div class="flex flex-wrap gap-8">
    <button
      type="button"
      class="mc-button mc-button-primary mc-button-md"
      onclick={() => toast.success("Time entry saved")}
    >
      Success
    </button>
    <button
      type="button"
      class="mc-button mc-button-secondary mc-button-md"
      onclick={() => toast.error("Could not reach the trust ledger")}
    >
      Error
    </button>
    <button
      type="button"
      class="mc-button mc-button-secondary mc-button-md"
      onclick={() => toast.info("Conflicts check is queued")}
    >
      Info
    </button>
    <button
      type="button"
      class="mc-button mc-button-secondary mc-button-md"
      onclick={() => toast.warning("This matter is approaching its budget")}
    >
      Warning
    </button>
    <button
      type="button"
      class="mc-button mc-button-ghost mc-button-md"
      onclick={() =>
        toast("Document uploaded", { description: "engagement-letter.pdf added to ACME-2026-014" })}
    >
      With description
    </button>
    <button
      type="button"
      class="mc-button mc-button-ghost mc-button-md"
      onclick={() =>
        toast("Matter archived", {
          action: { label: "Undo", onClick: () => toast("Restored") },
        })}
    >
      With action
    </button>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    // Toasts auto-dismiss; between steps wait for the previous one to clear so assertions don't
    // collide. findByText/waitFor tolerate the portal + animation timing.
    const settle = async (text: string | RegExp) => {
      await waitFor(() => expect(body.queryByText(text)).toBeNull(), { timeout: 4000 });
    };

    await step("A success trigger shows a success toast on the body", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Success" }));
      // findByText resolves on DOM presence; the toast then plays an enter animation, so wait for
      // the container (not the inner [data-title]) to be visible before asserting.
      const toastEl = await body.findByText("Time entry saved");
      const container = toastEl.closest("[data-sonner-toast]");
      await waitFor(() => expect(container).toBeVisible());
      // Sonner tags the intent on the toast container; confirm it carries the success type so the
      // status-token styling resolves.
      await expect(container).toHaveAttribute("data-type", "success");
      await settle("Time entry saved");
    });

    await step("An error trigger shows an error toast", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Error" }));
      await body.findByText("Could not reach the trust ledger");
      await settle("Could not reach the trust ledger");
    });

    await step("Info and warning triggers show their toasts", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Info" }));
      await body.findByText("Conflicts check is queued");
      await settle("Conflicts check is queued");

      await userEvent.click(canvas.getByRole("button", { name: "Warning" }));
      await body.findByText("This matter is approaching its budget");
      await settle("This matter is approaching its budget");
    });

    await step("A plain toast carries a description", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "With description" }));
      await body.findByText("Document uploaded");
      await body.findByText("engagement-letter.pdf added to ACME-2026-014");
      await settle("Document uploaded");
    });

    await step("A toast can carry an action button", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "With action" }));
      await body.findByText("Matter archived");
      await expect(body.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await settle("Matter archived");
    });
  }}
/>
