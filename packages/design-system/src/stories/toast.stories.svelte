<script module lang="ts">
  /*
   * Toast — Tier 3 batch (wraps svelte-sonner, not Bits UI). One composed showcase: the <Toaster />
   * host mounted once, plus trigger buttons that span the persistence spectrum — success/info/plain
   * at the calm 5s default, error held longer (8s, a failure shouldn't be missed), an Undo action
   * toast that is finite (6s — a just-Undo is fine to disappear), and a must-answer Retry action
   * toast that persists (Infinity, stays until acted or dismissed via the close button). Toasts
   * portal to <body>; the play function asserts against `within(document.body)` with tolerant waits
   * (findByText) and dismisses what it opens so nothing leaks across steps. svelte-csf v5. Bits-style
   * attribute controls don't apply here, so the whitelist is empty.
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
</script>

{#snippet template()}
  <Toaster />
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
      onclick={() => toast.error("Could not reach the trust ledger", { duration: 8000 })}
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
          action: { label: "Undo", onClick: () => {} },
          duration: 6000,
        })}
    >
      Undo action
    </button>
    <button
      type="button"
      class="mc-button mc-button-ghost mc-button-md"
      onclick={() =>
        toast("Could not save the time entry", {
          action: { label: "Retry", onClick: () => {} },
          duration: Number.POSITIVE_INFINITY,
        })}
    >
      Persistent action
    </button>
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    // The new durations are calm (5s) to long (8s) to infinite, so we don't wait for natural expiry
    // between steps — we dismiss explicitly (toast.dismiss clears the queue) and wait for the DOM to
    // clear. findByText/waitFor tolerate the portal + animation timing.
    const settle = async (text: string | RegExp) => {
      toast.dismiss();
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

    await step("An error trigger shows an error toast (held longer)", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Error" }));
      await body.findByText("Could not reach the trust ledger");
      await settle("Could not reach the trust ledger");
    });

    await step("Info and plain (description) triggers show their toasts", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Info" }));
      await body.findByText("Conflicts check is queued");
      await settle("Conflicts check is queued");

      await userEvent.click(canvas.getByRole("button", { name: "With description" }));
      await body.findByText("Document uploaded");
      await body.findByText("engagement-letter.pdf added to ACME-2026-014");
      await settle("Document uploaded");
    });

    await step("An Undo action toast is finite — it carries its action button", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Undo action" }));
      await body.findByText("Matter archived");
      await expect(body.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      await settle("Matter archived");
    });

    await step("A persistent action toast stays until acted or dismissed", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Persistent action" }));
      await body.findByText("Could not save the time entry");
      await expect(body.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      // duration is Infinity, so after a short wait it must still be present — proof it does not
      // auto-dismiss like the finite toasts above.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await expect(body.getByText("Could not save the time entry")).toBeInTheDocument();
      // Dismiss it so it doesn't leak across steps (the closeButton offers the same to a user).
      await settle("Could not save the time entry");
    });
  }}
/>
