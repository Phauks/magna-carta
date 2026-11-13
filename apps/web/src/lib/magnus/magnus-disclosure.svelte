<script lang="ts">
  /*
   * The member disclosure, shown and accepted before a member's first turn and again whenever the
   * version in force moves.
   *
   * WHAT IT HAS TO SAY IS FIXED, not editorial. Four facts a member must hold before they type:
   * the message leaves the platform for an outside model provider; the assistant sees what they
   * type in that conversation, the text of the files they attach to it and, where they turn it on,
   * their own other conversations on the same matter, and nothing else; it
   * can do nothing but answer and write drafts kept in the conversation; and the transcript, with
   * those drafts, is kept as a firm record. Then the sentence an
   * administrator does not need told and the person typing does:
   * the assistant can be wrong, its output is not legal advice, and verifying anything they rely on
   * is theirs. None of the five may be softened, and the last one may not be dropped.
   *
   * The accepted version is what makes a later change to what the assistant can see or do
   * re-prompt every member automatically, so the version is on screen: a member should be able to
   * see which statement they agreed to.
   */
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";

  let {
    disclosureVersion,
    accepting = false,
    onAccept,
  }: {
    /** The version in force, as the availability read named it. Absent where it did not say. */
    disclosureVersion?: number;
    /** True while the acceptance is on its way to the server. */
    accepting?: boolean;
    onAccept: () => void;
  } = $props();

  /**
   * The statements, in the order a member should meet them: where their words go, what the
   * assistant can see, what it can do, what is kept, and what they remain responsible for.
   */
  const STATEMENTS: readonly { heading: string; body: string }[] = [
    {
      heading: "What you type leaves the platform",
      body: "Your message is sent out through the platform's model gateway to an outside model provider, which is what produces the answer.",
    },
    {
      heading: "Magnus sees what you type, and the files you attach",
      body: "It reads the messages in the conversation you are in, and the readable text of any file you attach to it from the matter's own files. If you turn it on for a conversation kept on a matter, it also reads your own other conversations on that matter, never a colleague's. Nothing else: no other documents, no calendar, no directory. Keeping a conversation on a matter's file does not, by itself, let it read the matter.",
    },
    {
      heading: "Magnus can only answer and draft",
      body: "It answers, and when you ask for a draft it writes it as a document kept in the conversation, with every version. It cannot file, send, or delete anything, or change the firm's records. Whatever it suggests, you do.",
    },
    {
      heading: "Transcripts are kept as firm records",
      body: "What you ask, what it answers and the documents it writes stay on the firm's record, readable by you and by anyone the firm has given permission to read them. They are never visible to clients.",
    },
    {
      heading: "Magnus can be wrong",
      body: "Its output is not legal advice, and you are responsible for verifying anything you rely on.",
    },
  ];
</script>

<Card.Root class="max-w-2xl">
  <Card.Header>
    <Card.Title>Before You Use Magnus</Card.Title>
    <Card.Description>
      Read this once. Accepting it is what lets you ask Magnus anything.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-16">
    <ul class="flex flex-col gap-12">
      {#each STATEMENTS as statement (statement.heading)}
        <li class="flex flex-col gap-4">
          <FieldLabel>{statement.heading}</FieldLabel>
          <p class="text-sm text-text">{statement.body}</p>
        </li>
      {/each}
    </ul>
    {#if disclosureVersion !== undefined}
      <p class="text-xs text-text-muted">
        Disclosure version {disclosureVersion}. If what Magnus can see or do changes, you will be
        asked again.
      </p>
    {/if}
  </Card.Content>
  <Card.Footer>
    <Button onclick={onAccept} disabled={accepting}>
      <ShieldCheck aria-hidden="true" />
      Accept and Continue
    </Button>
  </Card.Footer>
</Card.Root>
