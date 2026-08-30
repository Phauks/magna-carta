/*
 * The expanded choice, remembered for the browsing session.
 *
 * A reader who wants the window at full viewport wants it for the whole sitting, not for one
 * record: asking again on the next record is the kind of small friction that makes a control feel
 * like it did not work. So the choice is held here, module-scoped, shared by every window the
 * session opens, and deliberately NOT persisted — it is a reading posture, not a preference the
 * firm records, and a stored one would follow a reader into a different day's work uninvited.
 *
 * A consumer that needs to own the state binds `expanded` instead; the shell then follows the
 * binding and this module only records what the toggle did.
 */
export const recordWindowSession = $state({ expanded: false });
