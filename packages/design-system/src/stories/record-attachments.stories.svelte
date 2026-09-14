<script module lang="ts">
  /*
   * RecordAttachments — the files riding a record, the same tab on every kind of record. The catalog
   * shows it in each of the states it has to survive: files on it, nothing on it yet, still loading,
   * a fetch that failed, an account that may read but not change it, and a record carrying more
   * files than fit.
   *
   * The two things worth watching are behaviours rather than looks. Detaching ends an association
   * and destroys nothing, so its confirmation says where the document will still be afterwards; and
   * the first attach source searches the matter's own documents, leaving out anything this record
   * already carries. Both are asserted in the first story's play.
   *
   * Every story pins the instant formatter to one locale and zone, so a stamp reads the same in
   * every reviewer's browser (the component's own default is the reader's local time, which is the
   * rule everywhere else). Render is always an explicit named `template` snippet.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor, within } from "storybook/test";
  import RecordAttachments from "../lib/components/record-attachments/record-attachments.svelte";
  import { formatInstant, type Instant } from "../lib/formatters/instant.ts";
  import type {
    AttachableDocumentFolder,
    RecordAttachment,
  } from "../lib/components/record-attachments/types.ts";

  const { Story } = defineMeta({
    title: "Data Display/RecordAttachments",
    component: RecordAttachments,
    parameters: {
      // Bits' prop types materialize every HTML attribute as a control; whitelist the props that
      // actually change this showcase. Snippets and the callbacks are not controls.
      controls: {
        include: ["canEdit", "attachDisabledReason", "loading", "errorMessage", "errorIdentifier"],
      },
      // The picker's results list scrolls but is driven by the search input's aria-activedescendant
      // (arrow keys move the highlight and scroll it into view), so it needs no tabbable content of
      // its own. axe's scrollable-region-focusable cannot model that and reports a false positive.
      a11y: { config: { rules: [{ id: "scrollable-region-focusable", enabled: false }] } },
    },
  });

  type RecordAttachmentsStoryArgs = ComponentProps<typeof RecordAttachments>;

  function pinnedInstant(at: Instant): string {
    return formatInstant(at, { locale: "en-US", timeZone: "America/New_York" });
  }

  const ATTACHED: readonly RecordAttachment[] = [
    {
      identifier: "association-1",
      documentIdentifier: "document-transcript",
      name: "Deposition transcript.pdf",
      contentType: "application/pdf",
      attachedAt: "2026-08-14T15:04:00Z",
      attachedBy: "Adaeze Okafor",
    },
    {
      identifier: "association-2",
      documentIdentifier: "document-exhibit-board",
      name: "Exhibit board.png",
      contentType: "image/png",
      attachedAt: "2026-08-14T15:11:00Z",
      attachedBy: "Adaeze Okafor",
    },
    {
      identifier: "association-3",
      documentIdentifier: "document-research-memorandum",
      name: "Research memorandum.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      attachedAt: "2026-08-15T09:02:00Z",
      attachedBy: "Bartholomew Rees",
    },
  ];

  /*
   * The matter's files. It deliberately holds the transcript that is ALREADY attached above, so the
   * picker can be seen leaving it out rather than offering a second association with the same file.
   */
  const MATTER_DOCUMENTS: readonly AttachableDocumentFolder[] = [
    {
      identifier: "folder-discovery",
      name: "Discovery",
      documents: [
        { identifier: "document-transcript", name: "Deposition transcript.pdf" },
        { identifier: "document-interrogatories", name: "Interrogatories, first set.pdf" },
        { identifier: "document-production-log", name: "Production log.xlsx" },
      ],
    },
    {
      identifier: "folder-correspondence",
      name: "Correspondence",
      documents: [
        { identifier: "document-demand-letter", name: "Demand letter.pdf" },
        { identifier: "document-scheduling-email", name: "Scheduling, opposing counsel.eml" },
      ],
    },
  ];

  const MANY_ATTACHED: readonly RecordAttachment[] = Array.from({ length: 14 }, (_unused, index) => {
    const number = String(index + 1).padStart(3, "0");
    return {
      identifier: `association-dense-${number}`,
      documentIdentifier: `document-dense-${number}`,
      name: `Production batch ${number}.pdf`,
      contentType: "application/pdf",
      attachedAt: "2026-08-16T13:20:00Z",
      attachedBy: "Bartholomew Rees",
    };
  });
</script>

<script lang="ts">
  // One record's worth of state, so the first story's acts are visible in the story itself.
  let attachments = $state<RecordAttachment[]>([...ATTACHED]);
  let opened = $state<string>("nothing");
  let uploaded = $state<number>(0);
  let retried = $state<number>(0);
</script>

{#snippet defaultTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      {attachments}
      documentSource={MATTER_DOCUMENTS}
      formatInstant={pinnedInstant}
      onOpen={(attachment) => (opened = attachment.name)}
      onDetach={(attachment) => {
        attachments = attachments.filter((entry) => entry.identifier !== attachment.identifier);
      }}
      onAttachExisting={(chosen) => {
        attachments = [
          ...attachments,
          {
            identifier: `association-${chosen.identifier}`,
            documentIdentifier: chosen.identifier,
            name: chosen.name,
            attachedAt: "2026-08-16T10:00:00Z",
            attachedBy: "Adaeze Okafor",
          },
        ];
      }}
      onAttachUpload={(files) => (uploaded += files.length)}
    />
    <p>Opened: {opened}. Uploaded: {uploaded}.</p>
  </div>
{/snippet}

<Story
  name="Default"
  template={defaultTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Every file on the record is listed, with who attached it and when", async () => {
      await expect(canvas.getByText("Deposition transcript.pdf")).toBeVisible();
      await expect(canvas.getByText("Exhibit board.png")).toBeVisible();
      await expect(canvas.getByText("Research memorandum.docx")).toBeVisible();
      await expect(canvas.getAllByText("Adaeze Okafor").length).toBeGreaterThan(0);
      // An absolute stamp, never elapsed time: "2 hours ago" decays while it is being read. Asked
      // of ALL of them rather than one, because several files attached on the same day is the
      // ordinary case, and a single-match query would fail on the realistic fixture rather than on
      // a real defect.
      const stamps = canvas.getAllByText(/Aug 14, 2026/);
      expect(stamps.length).toBeGreaterThan(0);
      for (const stamp of stamps) await expect(stamp).toBeVisible();
    });

    await step("Pressing a file's name opens it, and the record stays put", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Exhibit board.png" }));
      await expect(canvas.getByText(/Opened: Exhibit board\.png/)).toBeVisible();
    });

    await step("Detaching asks first, and says where the document will still be", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Detach Exhibit board.png" }));
      const confirmation = await body.findByRole("alertdialog");
      await waitFor(() => expect(confirmation).toBeVisible());
      await expect(confirmation).toHaveAccessibleName("Detach This Document");
      // The panel's description NAMES THE DOCUMENT, so a reader who cannot see the row is told
      // which file this is about before anything else. Where it will still be afterwards is the
      // panel's body, beside the act, rather than the line that identifies the subject.
      await expect(confirmation).toHaveAccessibleDescription("Exhibit board.png");
      await expect(confirmation).toHaveTextContent(/stays in this matter's files/);
      // The word the reader must never see here is Delete: this destroys nothing.
      await expect(confirmation).not.toHaveTextContent(/delete/i);
    });

    await step("Backing out leaves the file exactly where it was", async () => {
      await userEvent.click(body.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull());
      await expect(canvas.getByText("Exhibit board.png")).toBeVisible();
    });

    await step("Confirming ends the association and leaves the rest alone", async () => {
      const detach = canvas.getByRole("button", { name: "Detach Exhibit board.png" });
      await waitFor(() => expect(detach).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(detach);
      await body.findByRole("alertdialog");
      await userEvent.click(body.getByRole("button", { name: "Detach" }));
      await waitFor(() => expect(canvas.queryByText("Exhibit board.png")).toBeNull());
      await expect(canvas.getByText("Deposition transcript.pdf")).toBeVisible();
    });

    await step("The matter's own documents are the first source offered", async () => {
      const sources = canvas.getAllByRole("button");
      const fromTheMatter = canvas.getByRole("button", { name: /From the Matter/ });
      const upload = canvas.getByLabelText("Upload a file from this computer");
      await expect(sources.indexOf(fromTheMatter)).toBeGreaterThan(-1);
      await expect(
        fromTheMatter.compareDocumentPosition(upload) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    await step("A document already on the record is not offered again", async () => {
      const trigger = canvas.getByRole("button", { name: /From the Matter/ });
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      const listbox = await body.findByRole("listbox");
      await waitFor(() => expect(listbox).toBeVisible());
      const panel = within(listbox);
      await expect(panel.getByText("Discovery")).toBeVisible();
      await expect(panel.getByText("Interrogatories, first set.pdf")).toBeVisible();
      // The transcript is already attached above, so it is absent from what is on offer.
      await expect(panel.queryByText("Deposition transcript.pdf")).toBeNull();
    });

    await step("Picking one points the record at it", async () => {
      await userEvent.click(
        within(body.getByRole("listbox")).getByText("Interrogatories, first set.pdf"),
      );
      await waitFor(() => expect(body.queryByRole("listbox")).toBeNull());
      await expect(canvas.getByText("Interrogatories, first set.pdf")).toBeVisible();
    });
  }}
/>

{#snippet emptyTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      attachments={[]}
      documentSource={MATTER_DOCUMENTS}
      formatInstant={pinnedInstant}
      onAttachExisting={() => undefined}
      onAttachUpload={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="NothingAttachedYet"
  template={emptyTemplate}
  play={async ({ canvas, step }) => {
    await step("It states what belongs here and leaves both ways to add one in reach", async () => {
      await expect(canvas.getByText("Nothing Attached Yet")).toBeVisible();
      await expect(canvas.getByRole("button", { name: /From the Matter/ })).toBeEnabled();
      await expect(canvas.getByLabelText("Upload a file from this computer")).toBeEnabled();
    });
  }}
/>

{#snippet everythingAttachedTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      attachments={MATTER_DOCUMENTS.flatMap((folder) =>
        folder.documents.map((entry) => ({
          identifier: `association-${entry.identifier}`,
          documentIdentifier: entry.identifier,
          name: entry.name,
        })),
      )}
      documentSource={MATTER_DOCUMENTS}
      formatInstant={pinnedInstant}
      onAttachExisting={() => undefined}
      onAttachUpload={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="EverythingIsAlreadyAttached"
  template={everythingAttachedTemplate}
  play={async ({ canvas, step }) => {
    const body = within(document.body);

    await step("Nothing left to offer says so, rather than showing an empty search", async () => {
      const trigger = canvas.getByRole("button", { name: /From the Matter/ });
      await waitFor(() => expect(trigger).not.toHaveStyle({ pointerEvents: "none" }));
      await userEvent.click(trigger);
      await waitFor(() =>
        expect(
          body.getByText("Every document in this matter is already attached to this record."),
        ).toBeVisible(),
      );
      // Dismiss it, so the panel does not follow the next story into its assertions.
      await userEvent.keyboard("{Escape}");
    });
  }}
/>

{#snippet loadingTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments {...args} attachments={[]} loading formatInstant={pinnedInstant} />
  </div>
{/snippet}

<Story
  name="Loading"
  template={loadingTemplate}
  play={async ({ canvas, step }) => {
    await step("Placeholder rows stand in, and the wait is announced", async () => {
      await expect(canvas.getByText("Loading what is attached")).toBeInTheDocument();
    });

    await step("Attaching is not offered onto a list nobody has read yet", async () => {
      await expect(canvas.queryByRole("button", { name: /From the Matter/ })).toBeNull();
    });
  }}
/>

{#snippet failedTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      attachments={[]}
      errorMessage="The connection dropped before the attachments arrived."
      errorIdentifier="err_7f3c1a92"
      formatInstant={pinnedInstant}
      onRetry={() => (retried += 1)}
    />
    <p>Retried {retried} times.</p>
  </div>
{/snippet}

<Story
  name="CouldNotBeLoaded"
  template={failedTemplate}
  play={async ({ canvas, step }) => {
    await step("The failure states itself and names the one that was hit", async () => {
      await expect(canvas.getByText(/The connection dropped/)).toBeVisible();
      await expect(canvas.getByText("Error err_7f3c1a92")).toBeVisible();
    });

    await step("It is recoverable: trying again is right there", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Try Again" }));
      await expect(canvas.getByText("Retried 1 times.")).toBeVisible();
    });
  }}
/>

{#snippet readOnlyTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      attachments={ATTACHED}
      documentSource={MATTER_DOCUMENTS}
      canEdit={false}
      attachDisabledReason="This record is on a finalized bill, so what is attached is fixed."
      formatInstant={pinnedInstant}
      onDetach={() => undefined}
      onOpen={() => undefined}
      onAttachExisting={() => undefined}
      onAttachUpload={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="ReadOnlyWithItsReason"
  template={readOnlyTemplate}
  parameters={{
    // The disabled prompt text fails the contrast threshold at 2.69:1, and that is NOT this
    // component's doing: it renders the platform's disabled pair, so every disabled control in the
    // product carries the same ratio. Contrast minimums formally exempt an inactive control, which
    // is why this stands rather than being worked around here — but the standing rule that a
    // disabled control must read AT REST is a stricter promise than the exemption, and at this ratio
    // the platform is not keeping it. Raised as a token question; the fix belongs to the pair, not
    // to this story, and this exception comes off the day the pair changes.
    a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
  }}
  play={async ({ canvas, step }) => {
    await step("The controls stay where they are, refused rather than absent", async () => {
      const detach = canvas.getByRole("button", {
        name: "Detach Deposition transcript.pdf: This record is on a finalized bill, so what is attached is fixed.",
      });
      await expect(detach).toBeDisabled();
      await expect(canvas.getByRole("button", { name: /From the Matter/ })).toBeDisabled();
    });

    await step("The reason is stated once, not left to a hover", async () => {
      await expect(
        canvas.getByText("This record is on a finalized bill, so what is attached is fixed."),
      ).toBeVisible();
    });

    await step("The files themselves are still readable", async () => {
      await expect(canvas.getByRole("button", { name: "Deposition transcript.pdf" })).toBeEnabled();
    });
  }}
/>

{#snippet denseTemplate(args: RecordAttachmentsStoryArgs)}
  <div class="max-w-sm">
    <RecordAttachments
      {...args}
      attachments={MANY_ATTACHED}
      documentSource={MATTER_DOCUMENTS}
      formatInstant={pinnedInstant}
      onDetach={() => undefined}
      onOpen={() => undefined}
      onAttachExisting={() => undefined}
      onAttachUpload={() => undefined}
    />
  </div>
{/snippet}

<Story
  name="Dense"
  template={denseTemplate}
  play={async ({ canvas, step }) => {
    await step("A record carries as many files as the work produced", async () => {
      await expect(canvas.getAllByRole("button", { name: /^Detach / }).length).toBe(14);
    });

    await step("Both sources stay reachable beneath the whole list", async () => {
      await expect(canvas.getByRole("button", { name: /From the Matter/ })).toBeEnabled();
      await expect(canvas.getByLabelText("Upload a file from this computer")).toBeEnabled();
    });
  }}
/>
