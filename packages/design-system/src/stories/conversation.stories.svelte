<script module lang="ts">
  /*
   * Conversation — the transcript surface the assistant is read in.
   *
   * By default it reads as a RECORD, not a chat window: no bubbles, no avatars, no coloured left/right
   * alignment. (The `exchange` arrangement, in the last story, is the deliberate exception for a
   * conversation several members hold with the assistant.) A turn is a speaker label over a body, hairline-separated, in the register the rest
   * of the platform reads its records in. The member's turn and the assistant's are told apart by
   * the label and by the body's weight, never by which side of the canvas they sit on.
   *
   * The stories are the states a real transcript passes through: a settled exchange, an answer that
   * has not arrived, an answer that failed, an answer built from a partial conversation, a long
   * transcript that has to scroll inside the space it is given, and the composer with its send
   * control offered and refused.
   *
   * Every user-facing sentence here belongs to the STORY, not to the component. The component holds
   * no copy at all: the speaker labels, the notes and the composer's controls all arrive as
   * children, so an app can say what its own surface has to say.
   *
   * A pending turn carries no shimmer, spinner or skeleton of its own. Loading in this repository is
   * LoadingRegion and nothing else; a pending turn is a turn whose body has not arrived, and the
   * quiet treatment is the whole of what the component says about it.
   *
   * EVERY STORY IS A SQUARE PANEL, sized by `w-xl aspect-square` rather than by a height utility.
   * `h-96` is NOT 24rem here: the generated spacing scale is `0 4 8 12 16 20 24 32 40 48 64 96` and
   * `--spacing-96` is 96 PIXELS, so `h-96` compiles cleanly to a box too short to review a
   * transcript in — every story rendered as a strip, and nothing failed, because a region 96px tall
   * satisfies "it scrolls inside itself" trivially. The aspect ratio derives the height from a width
   * that IS on the container scale, so the review box is a realistic panel and is the same size on
   * every canvas, which a viewport height would not be. `min-h-0` is load-bearing beside it: a box
   * sized only by an aspect ratio keeps an automatic minimum of its own content, so without it the
   * wrapper grew to fit the whole dense transcript and the region never scrolled at all. The floor
   * below is asserted in every story that draws a transcript, so the box can never quietly shrink
   * again.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Button from "../lib/components/button/index.ts";
  import Label from "../lib/components/label/index.ts";
  import Textarea from "../lib/components/textarea/index.ts";
  import * as Conversation from "../lib/components/conversation/index.ts";
  import ConversationRoot from "../lib/components/conversation/conversation.svelte";

  const { Story } = defineMeta({
    title: "Data Display/Conversation",
    component: ConversationRoot,
  });

  /*
   * The height a transcript must have for a story to be worth looking at. It is a floor, not a
   * measurement: it exists so a wrapper that collapses (the `h-96` trap in the header) fails the
   * story instead of shipping a strip nobody can review.
   */
  const REVIEWABLE_TRANSCRIPT_HEIGHT = 320;

  const MEMBER = "Marguerite Okonkwo";
  const ASSISTANT = "Magnus";

  // A question typed over three lines. The body preserves the author's own breaks, so this reads as
  // three lines rather than one run-on paragraph.
  const MULTI_LINE_QUESTION = `Three questions about the retainer letter:
Does the fee arrangement need to be restated on every amendment?
And is a scanned signature enough?`;

  const SETTLED_ANSWER =
    "A retainer amendment restates the fee arrangement only where the amendment changes it. " +
    "A scanned signature is generally enough where the engagement does not call for a wet " +
    "signature, but check the engagement letter's own execution clause before relying on that.";

  // A long transcript, so the dense case is a real one rather than three turns repeated.
  const DENSE_TRANSCRIPT: readonly { speaker: "member" | "magnus"; label: string; body: string }[] =
    [
      {
        speaker: "member",
        label: MEMBER,
        body: "What distinguishes a fixed fee from a flat fee in the way we bill them?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "They are usually the same arrangement under two names: one price for a defined scope of work, billed without reference to time recorded. Where a firm distinguishes them, the distinction is local and worth stating in the engagement letter rather than assumed.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "How should an unearned fixed fee be held?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "In most United States jurisdictions an unearned fee is client money and belongs in trust until it is earned. The rule and the earning schedule are jurisdictional, so confirm both against the state's own conduct rules.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "What usually goes wrong when a fixed fee is drawn down?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "The two recurring faults are drawing before the milestone the engagement names, and drawing without a contemporaneous record of what was earned. Both are ledger problems before they are billing problems.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "Is a milestone schedule worth writing into the engagement letter?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "It is, because it converts an argument about whether work was earned into a reading of the letter. Name the milestone, name the amount it releases, and name what happens if the matter ends between two of them.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "And if the client ends the engagement halfway through a milestone?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "The unearned remainder is refundable, and the calculation is the one the engagement letter set out. A letter with no answer to that question leaves the firm arguing quantum meruit against its own client.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "Does any of that change where the fee is paid by somebody other than the client?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "The money changes hands differently and nothing else does. The client is still the client, the duty of confidentiality still runs to them alone, and the payer buys no say in the representation. Most jurisdictions want the arrangement disclosed to the client and consented to in writing before the first payment.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "What should the ledger show in that case?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "The client remains the ledger's subject, with the payer recorded as the source of each receipt rather than as a second account. Opening a ledger in the payer's name is what makes an unearned balance ambiguous at the moment it most needs to be clear.",
      },
      {
        speaker: "member",
        label: MEMBER,
        body: "Last one: how long should the engagement letter and its amendments be kept?",
      },
      {
        speaker: "magnus",
        label: ASSISTANT,
        body: "Longer than the matter. The engagement letter is the document a fee dispute is read against, and disputes surface years after a file closes, so it follows the firm's own retention schedule for the matter rather than any shorter rule about correspondence.",
      },
    ];
</script>

{#snippet settledExchange()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>{MULTI_LINE_QUESTION}</Conversation.TurnBody>
          <Conversation.TurnNote>12 Aug 2026 at 11:54</Conversation.TurnNote>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus">
          <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>{SETTLED_ANSWER}</Conversation.TurnBody>
          <Conversation.TurnNote>12 Aug 2026 at 11:55</Conversation.TurnNote>
        </Conversation.Turn>
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="A settled exchange"
  template={settledExchange}
  play={async ({ canvas, canvasElement, step }) => {
    const turns = canvas.getAllByRole("article");

    const transcript = canvas.getByRole("log", { name: "Conversation with Magnus" });

    await step("The transcript is a named log, so an arriving turn is announced", async () => {
      await expect(transcript).toBeVisible();
      await expect(transcript).toHaveAttribute("tabindex", "0");
    });

    await step("A short exchange sits whole in the record, with room to spare", async () => {
      // toBeVisible() cannot see clipping, so a turn scrolled out of a too-short box still passes
      // it. This is the assertion that says the reader can actually SEE both turns at once.
      await expect(transcript.clientHeight).toBeGreaterThan(REVIEWABLE_TRANSCRIPT_HEIGHT);
      await expect(transcript.scrollHeight).toBeLessThanOrEqual(transcript.clientHeight);
    });

    await step("Each turn states its own speaker and settled state", async () => {
      await expect(turns).toHaveLength(2);
      await expect(turns[0]).toHaveAttribute("data-speaker", "member");
      await expect(turns[0]).toHaveAttribute("data-state", "settled");
      await expect(turns[1]).toHaveAttribute("data-speaker", "magnus");
      await expect(turns[1]).toHaveAttribute("data-state", "settled");
    });

    await step("The speaker is a label over the body, not a name beside it", async () => {
      await expect(canvas.getByText(MEMBER)).toBeVisible();
      await expect(canvas.getByText(ASSISTANT)).toBeVisible();
    });

    await step("The author's own line breaks survive into the record", async () => {
      const body = canvasElement.querySelector(".mc-conversation-turn-body") as HTMLElement;
      await expect(body.textContent?.split("\n")).toHaveLength(3);
      await expect(getComputedStyle(body).whiteSpace).toBe("pre-wrap");
    });

    await step("Neither turn is pushed to a side of the canvas", async () => {
      const first = turns[0]!.getBoundingClientRect();
      const second = turns[1]!.getBoundingClientRect();
      await expect(Math.round(first.left)).toBe(Math.round(second.left));
      await expect(Math.round(first.right)).toBe(Math.round(second.right));
    });
  }}
/>

{#snippet pendingAnswer()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            Does a cost advanced on a matter belong on the client ledger or the firm's?
          </Conversation.TurnBody>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus" state="pending">
          <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
          <Conversation.TurnNote>Asked at 11:56</Conversation.TurnNote>
        </Conversation.Turn>
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="An answer that has not arrived"
  template={pendingAnswer}
  play={async ({ canvas, canvasElement, step }) => {
    const turns = canvas.getAllByRole("article");

    await step("The waiting turn stands in the record, marked pending", async () => {
      await expect(turns[1]).toHaveAttribute("data-state", "pending");
      await expect(turns[1]).toHaveTextContent(ASSISTANT);
    });

    await step("A turn with no body yet renders no body at all", async () => {
      await expect(turns[1]!.querySelector(".mc-conversation-turn-body")).toBeNull();
    });

    await step("Waiting is quiet: no shimmer, no spinner, no placeholder bones", async () => {
      await expect(canvasElement.querySelector(".mc-skeleton")).toBeNull();
      await expect(canvasElement.querySelector(".animate-pulse")).toBeNull();
      await expect(canvas.queryByRole("progressbar")).toBeNull();
    });
  }}
/>

{#snippet failedTurn()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            Summarize the difference between a retaining lien and a charging lien.
          </Conversation.TurnBody>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus" state="failed">
          <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
          <Conversation.TurnNote tone="warning">
            The model was unavailable, so this question was not answered. Ask it again.
          </Conversation.TurnNote>
        </Conversation.Turn>
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="An answer that failed"
  template={failedTurn}
  play={async ({ canvas, step }) => {
    const turns = canvas.getAllByRole("article");
    const note = canvas.getByText(/The model was unavailable/);

    await step("The failed turn stays in the record, marked failed", async () => {
      await expect(turns[1]).toHaveAttribute("data-state", "failed");
    });

    await step("The failure says what happened, in words a member can act on", async () => {
      await expect(note).toBeVisible();
      await expect(note).not.toHaveTextContent(/something went wrong/i);
    });

    await step("The note carries the warning tone, in the subtle register", async () => {
      await expect(note).toHaveAttribute("data-tone", "warning");
      // The subtle trio is a tint the turn behind it does not carry, so the two differ.
      await expect(getComputedStyle(note).backgroundColor).not.toBe(
        getComputedStyle(turns[1]!).backgroundColor,
      );
    });
  }}
/>

{#snippet truncatedContext()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            Going back to what we settled earlier, which of those two routes did you prefer?
          </Conversation.TurnBody>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus">
          <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            On what is in front of me, the milestone schedule is the better of the two: it settles
            the earning question in the engagement letter rather than after the fact.
          </Conversation.TurnBody>
          <Conversation.TurnNote tone="warning">
            This conversation was too long to send in full, so the answer was built from the most
            recent part of it.
          </Conversation.TurnNote>
        </Conversation.Turn>
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="An answer built from a partial conversation"
  template={truncatedContext}
  play={async ({ canvas, step }) => {
    const turns = canvas.getAllByRole("article");

    await step("The answer settled, so the turn is not marked failed or pending", async () => {
      await expect(turns[1]).toHaveAttribute("data-state", "settled");
    });

    await step("What was dropped is stated on the answer it affected", async () => {
      const note = canvas.getByText(/too long to send in full/);
      await expect(turns[1]).toContainElement(note);
      await expect(note).toHaveAttribute("data-tone", "warning");
    });
  }}
/>

{#snippet denseTranscript()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        {#each DENSE_TRANSCRIPT as turn, position (position)}
          <Conversation.Turn speaker={turn.speaker}>
            <Conversation.TurnSpeaker>{turn.label}</Conversation.TurnSpeaker>
            <Conversation.TurnBody>{turn.body}</Conversation.TurnBody>
          </Conversation.Turn>
        {/each}
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="A dense transcript"
  template={denseTranscript}
  play={async ({ canvas, step }) => {
    const transcript = canvas.getByRole("log", { name: "Conversation with Magnus" });

    await step("Every turn of a long exchange is in the record", async () => {
      await expect(canvas.getAllByRole("article")).toHaveLength(DENSE_TRANSCRIPT.length);
    });

    await step("The record is a panel worth reviewing, not a strip", async () => {
      await expect(transcript.clientHeight).toBeGreaterThan(REVIEWABLE_TRANSCRIPT_HEIGHT);
    });

    await step("Ten turns genuinely overflow it rather than merely exceeding it", async () => {
      // Twice the region's own height: a transcript that only just spilled would satisfy a bare
      // `scrollHeight > clientHeight` at any box size, which is how a 96px wrapper passed for
      // "dense". This says the reader has several screens of record under them.
      await expect(transcript.scrollHeight).toBeGreaterThan(transcript.clientHeight * 2);
    });

    await step("It scrolls inside itself rather than growing its host", async () => {
      const host = transcript.parentElement!.parentElement!;
      await expect(transcript.clientHeight).toBeLessThanOrEqual(host.clientHeight);
      await expect(host.scrollHeight).toBeLessThanOrEqual(host.clientHeight);
    });

    await step("A keyboard alone can reach and scroll the record", async () => {
      transcript.focus();
      await expect(transcript).toHaveFocus();
    });
  }}
/>

{#snippet sendOffered()}
  <Button variant="primary" size="sm">Send</Button>
{/snippet}

{#snippet composerReady()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            What has to be on a trust reconciliation for it to stand up to review?
          </Conversation.TurnBody>
        </Conversation.Turn>
      </Conversation.Transcript>
      <Conversation.Composer actions={sendOffered}>
        <Label for="conversation-composer-ready">Your question</Label>
        <Textarea id="conversation-composer-ready" rows={2} />
      </Conversation.Composer>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="A composer ready to send"
  template={composerReady}
  play={async ({ canvas, step }) => {
    await step("The composer holds the field the app put in it", async () => {
      await expect(canvas.getByLabelText("Your question")).toBeVisible();
    });

    await step("The send control sits in the composer's actions, offered", async () => {
      const send = canvas.getByRole("button", { name: "Send" });
      await expect(send).toBeVisible();
      await expect(send).toBeEnabled();
    });

    await step("The composer sits at the foot, beneath a transcript with real height", async () => {
      const transcript = canvas.getByRole("log", { name: "Conversation with Magnus" });
      const send = canvas.getByRole("button", { name: "Send" });
      await expect(transcript.clientHeight).toBeGreaterThan(REVIEWABLE_TRANSCRIPT_HEIGHT);
      await expect(send.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        transcript.getBoundingClientRect().bottom,
      );
    });
  }}
/>

{#snippet sendRefused()}
  <Button variant="primary" size="sm" disabled>Send</Button>
{/snippet}

{#snippet composerRefused()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript label="Conversation with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
          <Conversation.TurnBody>
            What has to be on a trust reconciliation for it to stand up to review?
          </Conversation.TurnBody>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus" state="pending">
          <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
          <Conversation.TurnNote>Asked at 09:12</Conversation.TurnNote>
        </Conversation.Turn>
      </Conversation.Transcript>
      <Conversation.Composer actions={sendRefused}>
        <Label for="conversation-composer-refused">Your question</Label>
        <Textarea id="conversation-composer-refused" rows={2} disabled />
        <Conversation.TurnNote>
          The last question is still with Magnus. Its answer arrives before the next one can be
          asked.
        </Conversation.TurnNote>
      </Conversation.Composer>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="A composer whose send is refused"
  template={composerRefused}
  play={async ({ canvas, step }) => {
    await step("The send control stays on the row, refused rather than absent", async () => {
      const send = canvas.getByRole("button", { name: "Send" });
      await expect(send).toBeVisible();
      await expect(send).toBeDisabled();
    });

    await step("The field is refused with it, so nothing invites a gesture", async () => {
      await expect(canvas.getByLabelText("Your question")).toBeDisabled();
    });

    await step("The reason it is refused is on screen, beside the control", async () => {
      await expect(canvas.getByText(/still with Magnus/)).toBeVisible();
    });
  }}
/>

{#snippet exchangeArrangement()}
  <div class="flex aspect-square w-xl max-w-full min-h-0 flex-col">
    <Conversation.Root>
      <Conversation.Transcript arrangement="exchange" label="Exchange with Magnus">
        <Conversation.Turn speaker="member">
          <Conversation.TurnMark>MO</Conversation.TurnMark>
          <Conversation.TurnContent>
            <Conversation.TurnSpeaker>{MEMBER}</Conversation.TurnSpeaker>
            <Conversation.TurnBody>{MULTI_LINE_QUESTION}</Conversation.TurnBody>
            <Conversation.TurnActions>
              <Button variant="ghost" size="sm">Copy</Button>
            </Conversation.TurnActions>
          </Conversation.TurnContent>
        </Conversation.Turn>
        <Conversation.Turn speaker="magnus">
          <Conversation.TurnMark>M</Conversation.TurnMark>
          <Conversation.TurnContent>
            <Conversation.TurnSpeaker>{ASSISTANT}</Conversation.TurnSpeaker>
            <Conversation.TurnBody>{SETTLED_ANSWER}</Conversation.TurnBody>
            <Conversation.TurnActions>
              <Button variant="ghost" size="sm">Copy</Button>
            </Conversation.TurnActions>
          </Conversation.TurnContent>
        </Conversation.Turn>
      </Conversation.Transcript>
    </Conversation.Root>
  </div>
{/snippet}

<Story
  name="The exchange arrangement"
  template={exchangeArrangement}
  play={async ({ canvas, step }) => {
    const transcript = canvas.getByRole("log", { name: "Exchange with Magnus" });
    const turns = canvas.getAllByRole("article");

    await step("The transcript says it is laid out as an exchange", async () => {
      await expect(transcript).toHaveAttribute("data-arrangement", "exchange");
    });

    await step("Members sit on the trailing side and the assistant on the leading side", async () => {
      const [member, assistant] = turns;
      if (member === undefined || assistant === undefined) throw new Error("two turns expected");
      const memberBox = member.querySelector(".mc-conversation-turn-content")?.getBoundingClientRect();
      const assistantBox = assistant
        .querySelector(".mc-conversation-turn-content")
        ?.getBoundingClientRect();
      if (memberBox === undefined || assistantBox === undefined) throw new Error("content expected");
      await expect(memberBox.right).toBeGreaterThan(assistantBox.left + assistantBox.width / 2);
      await expect(assistantBox.left).toBeLessThan(memberBox.left);
    });

    await step("The marks are presentation; the names are what is read", async () => {
      for (const mark of canvas.getAllByText(/^(MO|M)$/)) {
        await expect(mark.closest("[aria-hidden='true']")).not.toBeNull();
      }
    });
  }}
/>
