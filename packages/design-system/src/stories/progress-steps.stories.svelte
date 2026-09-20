<script module lang="ts">
  /*
   * ProgressSteps — Tier 2. The named sequence a surface hands work off to and then waits on. The
   * four stories are the four moments a passkey ceremony actually passes through, because a
   * sequence that only ever ships its happy path is the one that misreports a cancelled prompt.
   * The play functions assert the live region and that a failure REPLACES the step's label rather
   * than sitting beside it.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import ProgressSteps from "../lib/components/progress-steps/index.ts";
  import type { ProgressStep } from "../lib/components/progress-steps/index.ts";

  const { Story } = defineMeta({
    title: "Feedback/ProgressSteps",
    component: ProgressSteps,
    parameters: { controls: { include: ["steps"] } },
  });

  const ASKED = "Waiting for your device";
  const EXERCISED = "Verifying with your authenticator";
  const RETURNED = "Passkey created";
  const CEREMONY = [ASKED, EXERCISED, RETURNED];

  function ceremony(reached: number): ProgressStep[] {
    return CEREMONY.map((label, index) => ({
      label,
      status: index < reached ? "done" : index === reached ? "active" : "pending",
    }));
  }
</script>

{#snippet waiting()}
  <div class="max-w-sm"><ProgressSteps steps={ceremony(0)} /></div>
{/snippet}

<Story
  name="Waiting"
  template={waiting}
  play={async ({ canvas, step }) => {
    await step("Announces itself politely as it advances", async () => {
      await expect(canvas.getByRole("list")).toHaveAttribute("aria-live", "polite");
    });
    await step("Renders the whole sequence, not only the step in flight", async () => {
      await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    });
  }}
/>

{#snippet verifying()}
  <div class="max-w-sm"><ProgressSteps steps={ceremony(1)} /></div>
{/snippet}

<Story name="Verifying" template={verifying} />

{#snippet settled()}
  <div class="max-w-sm"><ProgressSteps steps={ceremony(3)} /></div>
{/snippet}

<Story name="Settled" template={settled} />

{#snippet cancelled()}
  <div class="max-w-sm">
    <ProgressSteps
      steps={[
        { label: ASKED, status: "done" },
        {
          label: EXERCISED,
          status: "failed",
          failure: "Cancelled or timed out. No passkey was created.",
        },
      ]}
    />
  </div>
{/snippet}

<Story
  name="Cancelled"
  template={cancelled}
  play={async ({ canvas, step }) => {
    await step("The failure replaces the step's own label", async () => {
      await expect(canvas.getByText(/No passkey was created/)).toBeInTheDocument();
      await expect(canvas.queryByText(EXERCISED)).not.toBeInTheDocument();
    });
  }}
/>

{#snippet streamed()}
  <!-- The streamed posture: only the steps that have happened, each with the second it did as its
       note, and the one under way. The notes are hidden from the live region, since a note that
       ticks would be announced on every tick. -->
  <div class="max-w-sm">
    <ProgressSteps
      steps={[
        { label: "Editing session opened.", status: "done", note: "0.4 s" },
        { label: "Editor started.", status: "done", note: "28.1 s" },
        { label: "Loading the editor's page into the tab.", status: "active", note: "30.0 s" },
      ]}
    />
  </div>
{/snippet}

<Story
  name="Streamed with notes"
  template={streamed}
  play={async ({ canvas, step }) => {
    await step("Keeps the note out of what is announced", async () => {
      await expect(canvas.getByText("28.1 s")).toHaveAttribute("aria-hidden", "true");
    });
  }}
/>
