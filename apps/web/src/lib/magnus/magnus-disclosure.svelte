<script lang="ts">
  /*
   * The member disclosure, shown and accepted before a member's first turn and again whenever the
   * version in force moves.
   *
   * WHAT IT HAS TO SAY IS FIXED, not editorial. Four facts a member must hold before they type:
   * the message goes to an outside AI provider; the assistant sees what they
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
      heading: "What you type goes to an outside AI provider",
      body: "Your message goes through Magna Carta to an outside AI provider, which writes the answer.",
    },
    {
      heading: "Magnus sees only what you type and the files you attach",
      body: "Magnus reads the messages in this conversation and the text of any matter file you attach. On a matter, you can also let it read your other conversations on that matter, but never another staff member's. It reads nothing else: no other documents, calendar or directory. Putting a conversation on a matter doesn't let Magnus read the matter.",
    },
    {
      heading: "Magnus can only answer and draft",
      body: "It answers questions and writes drafts, which stay in the conversation with every version. It can't file, send or delete anything, or change the firm's records. You act on what it suggests.",
    },
    {
      heading: "Conversations are firm records",
      body: "Your questions, its answers and its drafts stay on the firm's record. You and anyone the firm allows can read them. Clients never see them.",
    },
    {
      heading: "Magnus can be wrong",
      body: "Its answers aren't legal advice. You're responsible for checking anything you rely on.",
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
