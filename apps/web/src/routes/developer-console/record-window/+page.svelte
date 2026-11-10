<script lang="ts">
  /*
   * Record window states — the record family (the window, the event rail, the print sheet, the
   * attachments tab, the status register and the chain), in every state, on one surface.
   *
   * This page is the REVIEW SURFACE for the record family, and it joins the table-states page
   * beside it rather than being a second thing to learn. It exists because these components are
   * built before any screen consumes them: without it they can be read but not seen, and a
   * standalone mockup would be a second implementation that drifts from the product the moment
   * either side changes and is styled by hand rather than by the components that actually ship.
   * Everything below renders the real design-system components over an invented litigation
   * fixture, so what a reviewer sees is what a matter surface will get.
   *
   * Dev builds only, like the developer console itself: behind the import.meta.env.DEV gate, so
   * production serves the unavailable notice and the whole page tree shakes away.
   */
  import Badge from "@magna-carta/design-system/badge";
  import StatusMark from "@magna-carta/design-system/status-mark";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import Textarea from "@magna-carta/design-system/textarea";
  import RecordAttachments, {
    ATTACHMENTS_TAB_KEY,
    type AttachableDocument,
    type RecordAttachment,
  } from "@magna-carta/design-system/record-attachments";
  import RecordChain from "@magna-carta/design-system/record-chain";
  import RecordWindow from "@magna-carta/design-system/record-window";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import {
    STATUS_VOCABULARIES,
    statusVocabulary,
    type StatusVocabulary,
  } from "@magna-carta/design-system/status-register";
  import {
    GALLERY_ATTACHMENTS,
    GALLERY_HISTORY,
    GALLERY_MATTER,
    GALLERY_MATTER_DOCUMENTS,
    GALLERY_PLATFORM_HISTORY,
    GALLERY_RECORD,
    GALLERY_SINGLE_EVENT,
    GALLERY_SPARSE_SHEET,
  } from "$lib/developer/record-window-fixtures.ts";
  import {
    GALLERY_CHARGE_ON_PAPER,
    GALLERY_RECORD_FIELDS,
    GALLERY_SHEET,
  } from "$lib/developer/record-window-sheet.ts";

  /*
   * One flag per specimen, so opening one window leaves every other trigger on the page alone. The
   * two sheets are their own flags for the same reason, and because the sheet's whole promise is
   * that it layers above what opened it rather than replacing it: the record window's flag stays
   * true while the sheet is showing.
   */
  const showing = $state({
    atRest: false,
    filling: false,
    editRefused: false,
    countlessTabs: false,
    namedTab: false,
    editingInPlace: false,
    sheet: false,
    sparseSheet: false,
  });

  /*
   * What the window reported back. The window itself is the thing under review; where a report
   * hands off is the consuming screen's business, so the page states what it was told rather than
   * pretending to act on it.
   */
  let lastReport = $state<string | null>(null);

  /*
   * The editing specimen's own state. It is a real round trip rather than a frozen "fields" look:
   * the fields are bound, Save writes what was typed back into the record and returns the pane to
   * reading, and abandoning puts the typed text back the way it was — which is what makes the
   * unsaved-changes question walkable instead of describable.
   */
  let editing = $state(false);
  let recordedDescription = $state(GALLERY_CHARGE_ON_PAPER.description);
  let typedDescription = $state(GALLERY_CHARGE_ON_PAPER.description);

  function saveTypedDescription(): void {
    recordedDescription = typedDescription;
    editing = false;
  }

  function forgetWhatWasTyped(): void {
    typedDescription = recordedDescription;
  }

  /*
   * The attachments the record carries. Real state rather than a frozen list, so detaching a row
   * actually ends that association and picking a document actually adds one: a reviewer walking the
   * confirmation needs to see what pressing Detach does, not a control that argues and then nothing.
   */
  let attachments = $state<RecordAttachment[]>([...GALLERY_ATTACHMENTS]);
  let attachmentSequence = $state(0);

  function attachExistingDocument(document: AttachableDocument): void {
    attachmentSequence += 1;
    attachments = [
      ...attachments,
      {
        identifier: `association-added-${String(attachmentSequence)}`,
        documentIdentifier: document.identifier,
        name: document.name,
        contentType: document.contentType,
        attachedAt: new Date().toISOString(),
        attachedBy: "Rosalind Chase",
      },
    ];
  }

  function attachUploadedFiles(files: File[]): void {
    for (const file of files) {
      attachmentSequence += 1;
      attachments = [
        ...attachments,
        {
          identifier: `association-uploaded-${String(attachmentSequence)}`,
          documentIdentifier: `document-uploaded-${String(attachmentSequence)}`,
          name: file.name,
          contentType: file.type === "" ? undefined : file.type,
          attachedAt: new Date().toISOString(),
          attachedBy: "Rosalind Chase",
        },
      ];
    }
  }

  function detachAttachment(attachment: RecordAttachment): void {
    attachments = attachments.filter((held) => held.identifier !== attachment.identifier);
  }

  /*
   * The chain's lock hands over its object as a LINK, and this page is where that link can honestly
   * lead: there is no invoice screen yet, so it returns to this gallery rather than to a route that
   * does not exist. The prose beside the specimen says so.
   */
  const GALLERY_ROUTE = "/developer-console/record-window";

  const VOCABULARY_TITLES: Record<StatusVocabulary, string> = {
    workflowChain: "Work In Progress",
    invoiceStanding: "An Invoice's Standing",
    chargeStanding: "A Charge, Read Off Its Invoice",
    safety: "File Safety",
    custody: "What The Firm Holds",
    matterLifecycle: "A Matter's Lifecycle",
    memberStanding: "A Member's Standing In The Firm",
    conflictHit: "How A Conflict Hit Stands",
    communityRequest: "A Community Request's Standing",
    communityQuestion: "A Community Question's Standing",
    searchIndexStanding: "How A Search Index Stands",
  };

  const VOCABULARY_KEYS = Object.keys(STATUS_VOCABULARIES) as StatusVocabulary[];

  /**
   * Put every window away. The action bar is one snippet shared by all five specimens, so its
   * Discard closes whichever of them is showing rather than naming one of them.
   */
  function closeEveryWindow(): void {
    showing.atRest = false;
    showing.filling = false;
    showing.editRefused = false;
    showing.countlessTabs = false;
    showing.namedTab = false;
    showing.editingInPlace = false;
  }
</script>

<svelte:head><title>Record window states · Magna Carta</title></svelte:head>

{#snippet recordSubtitle()}
  {GALLERY_RECORD.reference} · {GALLERY_MATTER.title}
{/snippet}

<!--
  ONE pane for both modes. The values and the fields are the same snippet in the same geometry, so
  a reviewer can see that editing happens IN this window rather than in a second one, and so the
  two can never drift into layouts that disagree about where a field sits.
-->
{#snippet recordPane({ editing: fieldsOpen }: { editing: boolean })}
  <dl class="grid grid-cols-3 items-baseline gap-x-12 gap-y-8">
    {#each GALLERY_RECORD_FIELDS as field (field.label)}
      <dt class="text-xs text-text-muted">{field.label}</dt>
      <dd class="col-span-2">
        {field.value}
        {#if field.secondary !== undefined}
          <span class="text-xs text-text-subtle">{field.secondary}</span>
        {/if}
      </dd>
    {/each}
  </dl>
  {#if fieldsOpen}
    <div class="flex flex-col gap-4">
      <Label for="gallery-record-description">Description</Label>
      <Textarea id="gallery-record-description" rows={3} bind:value={typedDescription} />
    </div>
  {:else}
    <p>{recordedDescription}</p>
  {/if}
  {#if lastReport !== null}
    <p class="text-xs text-text-muted">The window reported: {lastReport}</p>
  {/if}
{/snippet}

<!-- The rail is told to fill the tab and scroll inside it. The tab panel is a block, so without a
     flex column of the tab's own height the rail grows and the panel scrolls instead. -->
{#snippet historyTab()}
  <div class="flex h-full flex-col">
    <EventRail events={GALLERY_HISTORY} label="This record's history" />
  </div>
{/snippet}

{#snippet attachmentsTab()}
  <RecordAttachments
    {attachments}
    documentSource={GALLERY_MATTER_DOCUMENTS}
    onAttachExisting={attachExistingDocument}
    onAttachUpload={attachUploadedFiles}
    onDetach={detachAttachment}
    onOpen={(attachment) => (lastReport = `open ${attachment.name}`)}
  />
{/snippet}

{#snippet chainTab()}
  <RecordChain
    current="billed"
    reviewGate
    lock={{ object: { label: "Invoice 2026-114", href: GALLERY_ROUTE } }}
  />
{/snippet}

<!--
  The caller's verbs only. Reading a record offers putting it away; while its fields are open the
  window itself appends the abandon and the commit after this, so no record type names them.
-->
{#snippet recordActions({ editing: fieldsOpen }: { editing: boolean })}
  {#if !fieldsOpen}
    <Button variant="secondary" onclick={closeEveryWindow}>Close</Button>
  {/if}
{/snippet}

{#snippet vocabularyChips(vocabulary: StatusVocabulary)}
  <div class="flex flex-wrap items-center gap-8">
    {#each statusVocabulary(vocabulary) as entry (entry.label)}
      {#if entry.presentation === "mark"}
        <StatusMark label={entry.label} />
      {:else}
        <Badge variant={entry.tone} title={entry.meaning}>{entry.label}</Badge>
      {/if}
    {/each}
  </div>
{/snippet}

{#if import.meta.env.DEV}
  <!--
    The tab sets live here rather than in the script because a snippet is a template binding: the
    tab list holds the snippets, so it is built where they are in scope. Counted and countless are
    two lists rather than one with the counts stripped, because a tab whose content is one
    continuous thing has no count to give and that is the state under review.
  -->
  {@const tabsWithCounts = [
    {
      key: ATTACHMENTS_TAB_KEY,
      label: "Attachments",
      count: attachments.length,
      content: attachmentsTab,
    },
    { key: "history", label: "History", count: GALLERY_HISTORY.length, content: historyTab },
    { key: "chain", label: "Standing", content: chainTab },
  ]}
  {@const tabsWithoutCounts = [
    { key: "history", label: "History", content: historyTab },
    { key: "chain", label: "Standing", content: chainTab },
  ]}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader title="Record Window States" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        The record family in every state it has to survive, rendered from the real design system
        over an invented litigation file. Use this instead of a standalone mockup: a mockup is
        styled by hand and drifts the moment either side changes, while everything here is the
        shipping component. The fixture is fixed, so two visits are comparable; nothing in it names
        a real person, client or matter.
      </p>
      <p class="text-sm text-text-muted">
        {GALLERY_MATTER.title} · {GALLERY_MATTER.client} · matter {GALLERY_MATTER.number}
      </p>
    </header>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">The Record Window</h2>
        <p class="text-sm text-text-muted">
          Closed is what this page is showing: the window is a dialog, so at rest it costs the
          surface underneath nothing at all. Each control below opens the same window in one of the
          states it has to be right in. The header carries exactly four controls in one order (Edit,
          Print, expand, close), the action bar keeps its geometry whatever the record's state, and
          only the two panes scroll, so a long record can never push the close control off the
          screen.
        </p>
        <p class="text-sm text-text-muted">
          Whether the window fills the screen is remembered for the session, which is why the toggle
          feels like it stayed pressed: pressing expand in one specimen is carried into the next one
          that does not state its own answer.
        </p>
        <p class="text-sm text-text-muted">
          Editing happens here, in place. Pressing Edit turns the left pane into fields without
          opening anything: the same window, the same tabs, the same bar, with the abandon and the
          commit appended to the bar by the window rather than named by the record. The tabs stay
          reachable throughout, because somebody changing a record routinely needs to see what is
          attached to it. Type into the description and then press Escape, or the close control, or
          Cancel: each asks before it throws the typing away, and each is the same question because
          they are the same gesture.
        </p>
        <p class="text-sm text-text-muted">
          A record that fits opens at the size of its content and scrolls nowhere. Only a record too
          long for the screen caps at it, and then the body alone moves while the header and the
          action bar hold still. The record itself stops at a readable measure however wide the
          window gets; the width past that goes to the tabs, which are the side that can use it.
        </p>
      </div>
      <div class="flex flex-wrap gap-8">
        <Button variant="secondary" onclick={() => (showing.atRest = true)}>
          At rest, edit enabled
        </Button>
        <Button variant="secondary" onclick={() => (showing.filling = true)}>
          Filling the screen
        </Button>
        <Button variant="secondary" onclick={() => (showing.editRefused = true)}>
          Edit refused, carrying its reason
        </Button>
        <Button variant="secondary" onclick={() => (showing.countlessTabs = true)}>
          Tabs with nothing to count
        </Button>
        <Button variant="secondary" onclick={() => (showing.namedTab = true)}>
          Opening on a named tab
        </Button>
        <Button
          variant="secondary"
          onclick={() => {
            editing = true;
            showing.editingInPlace = true;
          }}
        >
          Open in its fields
        </Button>
      </div>
      <p class="max-w-prose text-sm text-text-muted">
        The first specimen carries counted tabs, a live attachments tab and a printable sheet on its
        Print control. The second states expanded for itself. The third refuses Edit and says why
        rather than hiding the control, and keeps Print available, because printing is not editing.
        The fourth drops the counts, for a tab set whose contents are one continuous thing. The
        fifth opens on History rather than the first tab, the way a record arriving with something
        waiting in a tab puts that tab in front of the reader. The sixth opens straight into its
        fields, the way a record entered from nothing does.
      </p>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">The Event Rail</h2>
        <p class="text-sm text-text-muted">
          One presentation for every history the platform has. Oldest first, the latest marker
          filled so the eye finds where the story has got to, the action leading and the instant
          rendered in the viewer's own local time rather than as elapsed time. Anything somebody
          recorded with an event is quoted beneath it, because it is text a person wrote rather than
          the platform's account of what happened.
        </p>
      </div>
      <div class="grid gap-24 md:grid-cols-2">
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">A long history, scrolling</h3>
          <p class="text-sm text-text-muted">
            The rail fills the space it is given and scrolls inside it, so a history that grows for
            years costs its host nothing. The region is focusable and named, so a keyboard alone can
            reach the part that is out of view.
          </p>
          <div class="flex max-h-80 flex-col">
            <EventRail events={GALLERY_HISTORY} label="This record's history" />
          </div>
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">A single event</h3>
          <p class="text-sm text-text-muted">
            One event is the whole history, so it is both the first and the latest: it takes the
            filled marker and the rail ends at it rather than trailing off past it.
          </p>
          <EventRail events={GALLERY_SINGLE_EVENT} label="A history with one event" />
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Nothing recorded yet</h3>
          <p class="text-sm text-text-muted">
            Empty says so in a sentence rather than drawing an empty rail, which would read as a
            history that failed to load.
          </p>
          <EventRail events={[]} label="A history with nothing in it" />
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Still arriving</h3>
          <p class="text-sm text-text-muted">
            Placeholders stand in on the rail's own geometry, so the real events land where the eye
            already is instead of moving the reader's place when they arrive.
          </p>
          <EventRail events={[]} loading label="A history still loading" />
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">The platform as the source</h3>
          <p class="text-sm text-text-muted">
            What caused an event is not always a person. A safety re-scan, an index pass and a
            retention sweep are the platform acting on its own, and the line is called the source
            for exactly that reason.
          </p>
          <EventRail events={GALLERY_PLATFORM_HISTORY} label="A document's own history" />
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">The Print Sheet</h2>
        <p class="text-sm text-text-muted">
          The paper, shown as the reader sees it before it goes to a printer: pressing Print hands
          the browser that same sheet, so what comes out is what was on the screen. It layers above
          whatever opened it and never replaces it, which is why closing it gives the record back
          exactly where it was left.
        </p>
        <p class="text-sm text-text-muted">
          The firm's own note about this matter is on the record and is nowhere on the paper. It is
          removed by the projection that builds the document rather than left out by whoever
          remembered to, so there is no route through which it could reach a client.
        </p>
      </div>
      <div class="flex flex-wrap gap-8">
        <Button
          variant="secondary"
          onclick={() => {
            showing.atRest = true;
            showing.sheet = true;
          }}
        >
          Layered above the record window
        </Button>
        <Button variant="secondary" onclick={() => (showing.sparseSheet = true)}>
          Little recorded on it
        </Button>
      </div>
      <p class="max-w-prose text-sm text-text-muted">
        The first opens the record and puts its sheet above it in one gesture, so the layering is
        the thing on the screen: close the sheet and the record is still there. The second is a cost
        entered a moment ago with two facts, no narrative and a history nothing has been written
        into yet, which is where a sheet is most likely to look unfinished rather than sparse.
      </p>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">Attachments</h2>
        <p class="text-sm text-text-muted">
          The same tab on every kind of record. Detaching ends an association and destroys nothing,
          so the act is called Detach, its glyph is a broken link, and the confirmation says where
          the document will still be afterwards. The matter's own documents are offered first,
          because most of the time the file is already filed and picking it points at it rather than
          copying it; anything this record already carries is left out of what is offered.
        </p>
      </div>
      <div class="grid gap-24 md:grid-cols-3">
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Several files, and both sources</h3>
          <p class="text-sm text-text-muted">
            This one is live: detaching really ends that association and picking a document really
            adds one, so the confirmation can be walked rather than described.
          </p>
          <RecordAttachments
            {attachments}
            documentSource={GALLERY_MATTER_DOCUMENTS}
            onAttachExisting={attachExistingDocument}
            onAttachUpload={attachUploadedFiles}
            onDetach={detachAttachment}
            onOpen={(attachment) => (lastReport = `open ${attachment.name}`)}
          />
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Nothing attached yet</h3>
          <p class="text-sm text-text-muted">
            Both sources stay where they are, because an empty list is the state in which a reader
            most needs to be told how to end it.
          </p>
          <RecordAttachments attachments={[]} documentSource={GALLERY_MATTER_DOCUMENTS} />
        </div>
        <div class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Read-only, refused with its reason</h3>
          <p class="text-sm text-text-muted">
            The controls stay exactly where they are and say what would change the answer. A control
            that vanishes leaves a reader wondering whether they missed it.
          </p>
          <RecordAttachments
            attachments={GALLERY_ATTACHMENTS}
            canEdit={false}
            attachDisabledReason="This record is on a finalized invoice, so what it carries cannot change."
            documentSource={GALLERY_MATTER_DOCUMENTS}
            onDetach={() => undefined}
          />
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">The Status Register</h2>
        <p class="text-sm text-text-muted">
          Every status word the product speaks, in the four vocabularies that speak them, so the
          whole tone set can be read at once. A word that appears in two vocabularies is one entry
          and carries one tone: Draft and Void are the same words in the chain and on an invoice,
          and Paid is the same word on an invoice and on a charge that rides it. What a word means
          rides its hover and is never printed beneath it, and a withdrawn record renders through
          its chip alone, with nothing struck through and nothing dimmed.
        </p>
      </div>
      <div class="grid gap-24 md:grid-cols-2">
        {#each VOCABULARY_KEYS as vocabulary (vocabulary)}
          <div class="flex flex-col gap-8">
            <h3 class="text-sm font-semibold">{VOCABULARY_TITLES[vocabulary]}</h3>
            {@render vocabularyChips(vocabulary)}
          </div>
        {/each}
      </div>
      <p class="max-w-prose text-sm text-text-muted">
        The clean verdict is the one word that is not a chip: a scanned, typed, clean file carries
        the filled mark and nothing else, because a column reading Clean on most of its rows says
        nothing at all.
      </p>
    </section>

    <section class="flex flex-col gap-12">
      <div class="flex max-w-prose flex-col gap-4">
        <h2 class="text-lg font-semibold">The Record Chain</h2>
        <p class="text-sm text-text-muted">
          Where a record has got to, and what that costs it. The stepper is review-flow vocabulary,
          so a firm that has not turned review on does not see it greyed out for a workflow nobody
          uses: it is absent. The lock is not review-flow vocabulary, because a billed record is
          locked either way, so it renders whichever way the gate is set. There is no colour here
          beyond the surface's own: the chain is background for the record, not a second status
          indicator competing with the chip.
        </p>
      </div>
      <!--
        Stacked rather than sat side by side: the stepper is a row of five words, and a third of the
        page wraps it onto two lines. That wrap would be this page's own doing, and a reviewer would
        be looking at a defect the component does not have.
      -->
      <div class="flex flex-col gap-24">
        <div class="flex max-w-prose flex-col gap-8">
          <h3 class="text-sm font-semibold">Review off, and editable</h3>
          <p class="text-sm text-text-muted">
            A draft at a firm that does not review anything has no stepper and no lock, so the
            component renders nothing at all. The empty space beneath this line is the state.
          </p>
          <RecordChain current="draft" />
        </div>
        <div class="flex max-w-prose flex-col gap-8">
          <h3 class="text-sm font-semibold">Review on</h3>
          <p class="text-sm text-text-muted">
            The full chain, with the record at Submitted: what is still ahead is drawn, because
            knowing that is the reason to draw a chain rather than a chip. Each step's meaning rides
            its hover, out of the same register as the chip on the row above it.
          </p>
          <RecordChain current="submitted" reviewGate />
        </div>
        <div class="flex max-w-prose flex-col gap-8">
          <h3 class="text-sm font-semibold">Locked</h3>
          <p class="text-sm text-text-muted">
            A billed record states its lock once and hands over the invoice as a link rather than
            describing it. On this page that link leads back here, because no invoice screen exists
            yet to lead anywhere else.
          </p>
          <RecordChain
            current="billed"
            reviewGate
            lock={{ object: { label: "Invoice 2026-114", href: GALLERY_ROUTE } }}
          />
        </div>
      </div>
    </section>
  </div>

  <RecordWindow
    bind:open={showing.atRest}
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithCounts}
    actions={recordActions}
    onSave={saveTypedDescription}
    onCancel={forgetWhatWasTyped}
    onPrint={() => (showing.sheet = true)}
  />

  <RecordWindow
    bind:open={showing.filling}
    expanded={true}
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithCounts}
    actions={recordActions}
    onSave={saveTypedDescription}
    onCancel={forgetWhatWasTyped}
    onPrint={() => (showing.sheet = true)}
  />

  <!-- The mode itself, opened straight into its fields the way a record that arrives needing a
       change does. Everything else about the window is unchanged: same geometry, same tabs, same
       bar — which is the whole claim being reviewed. -->
  <RecordWindow
    bind:open={showing.editingInPlace}
    bind:editing
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithCounts}
    actions={recordActions}
    unsavedChanges={typedDescription !== recordedDescription}
    onSave={saveTypedDescription}
    onCancel={forgetWhatWasTyped}
    onPrint={() => (showing.sheet = true)}
  />

  <RecordWindow
    bind:open={showing.editRefused}
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithCounts}
    actions={recordActions}
    editDisabledReason="This record is on a finalized invoice. A correction is a credit note beside the bill."
    onPrint={() => (showing.sheet = true)}
  />

  <RecordWindow
    bind:open={showing.countlessTabs}
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithoutCounts}
    actions={recordActions}
    onSave={saveTypedDescription}
    onCancel={forgetWhatWasTyped}
    onPrint={() => (showing.sheet = true)}
  />

  <RecordWindow
    bind:open={showing.namedTab}
    heading={GALLERY_RECORD.heading}
    subtitle={recordSubtitle}
    record={recordPane}
    tabs={tabsWithCounts}
    defaultTab="history"
    actions={recordActions}
    onSave={saveTypedDescription}
    onCancel={forgetWhatWasTyped}
    onPrint={() => (showing.sheet = true)}
  />

  <PrintSheet sheet={GALLERY_SHEET} bind:open={showing.sheet} />
  <PrintSheet sheet={GALLERY_SPARSE_SHEET} bind:open={showing.sparseSheet} />
{:else}
  <p class="p-16 text-sm text-text-muted">
    The record-window states page is only available in development builds.
  </p>
{/if}
