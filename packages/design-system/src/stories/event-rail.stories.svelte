<script module lang="ts">
  /*
   * EventRail — the history presentation, wherever the platform has a history.
   *
   * The stories are the states a real history actually passes through: several events with one
   * carrying somebody's recorded words, a history with a single event, nothing recorded yet (the
   * frame standing before its first event), the fetch still in flight, a long one that has to
   * scroll inside the space it is given, and one carrying the rail's own note beneath its events. The two
   * fixtures deliberately come from different worlds — a record's own history and a document's
   * version history — because the whole claim of this component is that it does not know which.
   *
   * Every story pins the instant formatter to one locale and zone. The component's own default
   * renders the VIEWER's local time, which is the rule; pinning here is what makes the catalog and
   * its screenshots read the same on every machine instead of chasing the runner's clock.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import EventRail from "../lib/components/event-rail/index.ts";
  import { eventInstantText } from "../lib/components/event-rail/index.ts";
  import type { EventInstant, EventRailEvent } from "../lib/components/event-rail/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/EventRail",
    component: EventRail,
    parameters: {
      controls: {
        include: [
          "events",
          "label",
          "emptyMessage",
          "note",
          "loading",
          "loadingMessage",
          "placeholderCount",
        ],
      },
    },
  });

  function pinnedInstant(at: EventInstant): string {
    return eventInstantText(at, { locale: "en-US", timeZone: "America/New_York" });
  }

  const RECORD_HISTORY: readonly EventRailEvent[] = [
    {
      id: "entered",
      action: "Entered as a draft",
      at: "2026-08-10T14:12:00.000Z",
      source: "Marguerite Okonkwo",
    },
    {
      id: "submitted",
      action: "Submitted for review",
      at: "2026-08-11T09:41:00.000Z",
      source: "Marguerite Okonkwo",
    },
    {
      id: "kicked-back",
      action: "Kicked back to draft",
      at: "2026-08-11T16:03:00.000Z",
      source: "Halvard Nyquist",
      detail: "The second conference is already covered by the entry on the ninth. Split the time.",
    },
    {
      id: "resubmitted",
      action: "Submitted for review",
      at: "2026-08-12T08:20:00.000Z",
      source: "Marguerite Okonkwo",
    },
    {
      id: "approved",
      action: "Approved",
      at: "2026-08-12T11:55:00.000Z",
      source: "Halvard Nyquist",
    },
  ];

  const SINGLE_EVENT: readonly EventRailEvent[] = [RECORD_HISTORY[0]!];

  // A different world entirely, on the same rail: a document's versions, with the platform itself
  // as the source of the events nobody performed by hand.
  const VERSION_HISTORY: readonly EventRailEvent[] = [
    { id: "v1", action: "Version 1 uploaded", at: "2026-05-04T13:00:00.000Z", source: "Ines Trewin" },
    {
      id: "scan-1",
      action: "Safety check completed, nothing found",
      at: "2026-05-04T13:01:00.000Z",
      source: "Magna Carta",
    },
    { id: "v2", action: "Version 2 uploaded", at: "2026-05-06T10:22:00.000Z", source: "Ines Trewin" },
    {
      id: "renamed",
      action: "Renamed to Settlement Agreement (executed)",
      at: "2026-05-06T10:24:00.000Z",
      source: "Ines Trewin",
    },
    { id: "v3", action: "Version 3 uploaded", at: "2026-05-19T15:47:00.000Z", source: "Bertrand Achebe" },
    {
      id: "moved",
      action: "Moved from Correspondence to Settlement",
      at: "2026-05-19T15:50:00.000Z",
      source: "Bertrand Achebe",
    },
    {
      id: "rescan",
      action: "Safety check re-run on an updated engine, nothing found",
      at: "2026-06-02T02:10:00.000Z",
      source: "Magna Carta",
    },
    { id: "v4", action: "Version 4 uploaded", at: "2026-06-14T09:05:00.000Z", source: "Ines Trewin" },
    {
      id: "shared",
      action: "Shared to the client portal",
      at: "2026-06-14T09:30:00.000Z",
      source: "Bertrand Achebe",
      detail: "Sent with the cover letter agreed on the call.",
    },
    { id: "v5", action: "Version 5 uploaded", at: "2026-07-01T11:11:00.000Z", source: "Ines Trewin" },
    {
      id: "retained",
      action: "Retention period extended to seven years",
      at: "2026-07-01T11:12:00.000Z",
      source: "Magna Carta",
    },
    {
      id: "v6",
      action: "Version 6 uploaded",
      at: "2026-08-03T16:38:00.000Z",
      source: "Bertrand Achebe",
    },
  ];
</script>

{#snippet history()}
  <div class="max-w-md">
    <EventRail events={RECORD_HISTORY} label="History" formatInstant={pinnedInstant} />
  </div>
{/snippet}

<Story
  name="History"
  template={history}
  play={async ({ canvas, step }) => {
    const events = canvas.getAllByRole("listitem");

    await step("Reads oldest first, so the history reads the way it happened", async () => {
      await expect(events[0]).toHaveTextContent("Entered as a draft");
      await expect(events[events.length - 1]).toHaveTextContent("Approved");
    });

    await step("Only the latest event's marker is filled", async () => {
      await expect(events[events.length - 1]).toHaveAttribute("data-latest", "true");
      for (const earlier of events.slice(0, -1)) {
        await expect(earlier).not.toHaveAttribute("data-latest");
      }
    });

    await step("Every event states the actual instant, never elapsed time", async () => {
      for (const event of events) {
        await expect(event).toHaveTextContent(/\d{4}/);
        await expect(event).not.toHaveTextContent(/just now|ago/i);
      }
    });

    await step("What caused an event is announced as its source", async () => {
      await expect(canvas.getAllByText("Source")).toHaveLength(events.length);
    });

    await step("Recorded words are quoted beneath the event they belong to", async () => {
      await expect(canvas.getByText(/Split the time/)).toBeVisible();
    });

    await step("The rail is a named region a keyboard can reach and scroll", async () => {
      const rail = canvas.getByRole("region", { name: "History" });
      await expect(rail).toHaveAttribute("tabindex", "0");
    });
  }}
/>

{#snippet oneEvent()}
  <div class="max-w-md">
    <EventRail events={SINGLE_EVENT} label="History" formatInstant={pinnedInstant} />
  </div>
{/snippet}

<Story
  name="A single event"
  template={oneEvent}
  play={async ({ canvas, step }) => {
    await step("The only event is also the latest, so its marker is filled", async () => {
      await expect(canvas.getByRole("listitem")).toHaveAttribute("data-latest", "true");
    });
  }}
/>

{#snippet nothingRecorded()}
  <div class="max-w-md">
    <EventRail events={[]} label="History" formatInstant={pinnedInstant} />
  </div>
{/snippet}

<Story
  name="Nothing recorded yet"
  template={nothingRecorded}
  play={async ({ canvas, canvasElement, step }) => {
    await step("The rail's frame stands, with the words about the emptiness inside it", async () => {
      const rail = canvas.getByRole("region", { name: "History" });
      const message = canvas.getByText("Nothing has been recorded here yet.");
      await expect(message).toBeVisible();
      await expect(rail.contains(message)).toBe(true);
      await expect(canvasElement.querySelector(".mc-event-rail-marker")).not.toBeNull();
      await expect(message.closest('[data-placeholder="true"]')).not.toBeNull();
    });

    await step("There is no event to list, so nothing is listed", async () => {
      await expect(canvas.queryByRole("list")).toBeNull();
      await expect(canvas.queryByRole("listitem")).toBeNull();
    });
  }}
/>

{#snippet withANote()}
  <div class="max-w-md">
    <EventRail
      events={SINGLE_EVENT}
      label="History"
      note="Every later event is on the firm's audit trail, which is not built yet."
      formatInstant={pinnedInstant}
    />
  </div>
{/snippet}

<Story
  name="With a note beneath the events"
  template={withANote}
  play={async ({ canvas, step }) => {
    await step("The note is the rail's own last line, inside the frame", async () => {
      const rail = canvas.getByRole("region", { name: "History" });
      const note = canvas.getByText(/audit trail/);
      await expect(note).toBeVisible();
      await expect(rail.contains(note)).toBe(true);
      await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
    });
  }}
/>

{#snippet stillLoading()}
  <div class="max-w-md">
    <EventRail events={[]} label="History" loading formatInstant={pinnedInstant} />
  </div>
{/snippet}

<Story
  name="Still loading"
  template={stillLoading}
  play={async ({ canvas, step }) => {
    await step("The region reports itself busy while the events are fetched", async () => {
      await expect(canvas.getByRole("region", { name: "History" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });

    await step("A reader is told it is loading, not left with silent placeholders", async () => {
      await expect(canvas.getByText("Loading the history")).toBeInTheDocument();
    });
  }}
/>

{#snippet longHistory()}
  <div class="h-96 max-w-md">
    <EventRail
      events={VERSION_HISTORY}
      label="Version history"
      formatInstant={pinnedInstant}
      class="h-full"
    />
  </div>
{/snippet}

<Story
  name="A long history"
  template={longHistory}
  play={async ({ canvas, step }) => {
    const rail = canvas.getByRole("region", { name: "Version history" });

    await step("A long history scrolls inside the rail instead of growing it", async () => {
      await expect(rail.scrollHeight).toBeGreaterThan(rail.clientHeight);
      await expect(rail.clientHeight).toBeLessThanOrEqual(96);
    });

    await step("The source is true for a platform action as much as for a person", async () => {
      await expect(canvas.getAllByText("Magna Carta").length).toBeGreaterThan(0);
    });
  }}
/>
