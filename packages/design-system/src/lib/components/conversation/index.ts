/*
 * Conversation is a composition of parts. The dual export — bare names (Root, Transcript, …) plus
 * Conversation-prefixed aliases — supports both import idioms: `import * as Conversation from
 * ".../conversation"` then <Conversation.Root>, or `import { Conversation, ConversationTurn } from
 * ".../conversation"`. This is the house namespace shape every multi-part component follows (Card,
 * Alert, Tabs, …).
 */
import Root from "./conversation.svelte";
import Composer from "./conversation-composer.svelte";
import Transcript from "./conversation-transcript.svelte";
import Turn from "./conversation-turn.svelte";
import TurnBody from "./conversation-turn-body.svelte";
import TurnNote from "./conversation-turn-note.svelte";
import TurnSpeaker from "./conversation-turn-speaker.svelte";
import TurnMark from "./conversation-turn-mark.svelte";
import TurnContent from "./conversation-turn-content.svelte";
import TurnActions from "./conversation-turn-actions.svelte";

export type {
  ConversationArrangement,
  ConversationNoteTone,
  ConversationSpeaker,
  ConversationTurnState,
} from "./types.ts";

export {
  Root,
  Composer,
  Transcript,
  Turn,
  TurnBody,
  TurnNote,
  TurnSpeaker,
  TurnMark,
  TurnContent,
  TurnActions,
  //
  Root as Conversation,
  Composer as ConversationComposer,
  Transcript as ConversationTranscript,
  Turn as ConversationTurn,
  TurnBody as ConversationTurnBody,
  TurnNote as ConversationTurnNote,
  TurnSpeaker as ConversationTurnSpeaker,
  TurnMark as ConversationTurnMark,
  TurnContent as ConversationTurnContent,
  TurnActions as ConversationTurnActions,
};
