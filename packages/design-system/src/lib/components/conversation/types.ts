/*
 * The Conversation surface's closed vocabularies.
 *
 * They are deliberately the presentation's own, and narrower than the record's: the assistant's
 * record distinguishes a turn that is pending from one that is complete, failed or refused, while a
 * transcript has three things to draw — a turn that has settled, a turn whose body has not arrived,
 * and a turn that will never get one. A caller maps its record onto these; the component never
 * learns what a refusal is, which is what keeps this file free of the assistant's domain.
 */

/**
 * Who a turn belongs to. Two speakers, and there is no third: a transcript is a member and the
 * assistant, never a system voice a member could be mistaken for.
 */
export type ConversationSpeaker = "member" | "magnus";

/**
 * What a turn has come to. `settled` is a turn with its body; `pending` is a turn whose body has
 * not arrived (drawn quietly, with no placeholder of its own — a region whose data has not arrived
 * is `LoadingRegion`, and a pending turn is not that region); `failed` is a turn that will not get
 * one, which says why in a note.
 */
export type ConversationTurnState = "settled" | "pending" | "failed";

/**
 * How a note beneath a body reads. `quiet` is the default and carries a fact — when the turn was
 * recorded, what it belongs to. `warning` carries something the reader has to weigh before relying
 * on the answer, in the status register's SUBTLE trio, which is what a work surface takes.
 */
export type ConversationNoteTone = "quiet" | "warning";

/**
 * How the transcript lays its turns out. `record` is the default and the reading a meeting's chat
 * takes: every turn a label over a body down one edge, hairline-separated, with nothing about
 * position carrying meaning. `exchange` is the reading a conversation between several members and
 * the assistant takes: each turn carries a mark (initials, or the assistant's letter), the members'
 * turns sit on the trailing side in a quiet panel and the assistant's on the leading side unboxed,
 * so a reader who joined late can see at a glance who asked what and where each answer starts.
 */
export type ConversationArrangement = "record" | "exchange";
