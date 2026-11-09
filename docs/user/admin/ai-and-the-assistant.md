# Turning AI on for your firm

Nothing in Magna Carta sends your firm's information to an AI model until your firm says it may. That
decision is two decisions, and they are deliberately separate.

## The two switches

- **Send Content to a Model.** Whether your firm's content may be sent to a third-party AI model at
  all. Off by default. While it is off, every AI feature in Magna Carta is off with it, whatever else
  is set.
- **Magnus.** Whether members of your firm can hold a conversation with the assistant. Off by
  default, and it needs the first switch as well.

They are separate because they answer different questions, and one answer does not follow from the
other. A firm that is content to have a draft letter improved by a model has not thereby agreed to a
free-form assistant its members can type anything into. A firm that decides the assistant is not for
it has not thereby decided that nothing else may use a model either.

So turning **Magnus** on while **Send Content to a Model** is off does nothing at all. The page says
so in a sentence underneath, and it reads the answers you have chosen rather than the ones already
saved — so you can see what will be true before you save it.

## The model your content reaches

Under the switches, **Model** is the one choice on this plate. The list offers **the platform's
current model** and every current-generation model the platform has verified, by name (today
**Claude Opus 5.5** and **Claude Sonnet 5.5**); type to narrow it. Older models are not offered. Beneath the control
the page states, for whatever the control holds right now, the model's name and identifier, the
exact release behind any given answer, and the facts a choice is made on:

- **Zero Data Retention** — the provider keeps nothing that is sent to it, and when that was last
  checked.
- **Training on Your Content** — never.
- **Still Published** — when the platform last confirmed the model is still offered, and the
  earliest date the provider says it may retire it.
- **Effort Levels** — how much thinking a request to the model may spend, from low to maximum, and
  the level it uses when a request does not say. Each feature picks the level for its own requests;
  this row tells you the range the model allows.

Every model on the list keeps nothing and trains on nothing; a model that did would not be on it.
Consenting to send client content to somebody else's model without being told which model, what it
keeps, and whether it learns from it, would be consenting to nothing you could explain to a client,
which is why the facts sit beside the choice.

**Following the platform or choosing.** A firm that has never chosen follows the platform's current
model, which moves forward as better ones are verified. Choosing a model pins your firm to it until
you choose again. Choosing **the platform's current model** returns your firm to following, rather
than pinning it to today's answer. If the model your firm chose leaves the list (because a newer
generation replaced it), your firm follows the platform's current model until you choose again. The line above the message box in Magnus names whichever model is
answering.

**Where the list comes from.** The list is the platform's own verified catalog; the **Roster** row
states the catalog's version and the date it took effect. A model joins the list only once somebody
has checked what it keeps, and that is a check no automatic list can carry, so the platform's
verification pass is what keeps it current.

**Checking against the provider's own list.** Where the platform is set up to read Anthropic's live
model list, the **Provider's Live List** row says when it was last read and names any model Anthropic
publishes that is not on your list yet. Those models are shown, not offered: each joins the list once
its retention terms are verified, and a model that requires Anthropic to keep your content (such as
**Claude Fable 5.1**) is never offered at all. If a model on your list stops appearing in Anthropic's
list, the choice says so beside it. Where the live check is not set up, or could not be read, the row
says that instead, and the list is unaffected.

## Questions a day

**Questions a Day** is a ceiling on how many questions the whole firm may ask the assistant in a day.
It starts at 500. Asking past it is refused, with the member told why, until the next day.

It exists because the assistant is the first place in Magna Carta where one person can run up a bill
just by typing. A firm that wants no limit can set a high one; a firm that wants the assistant
available to nobody today can set it to zero without switching anything off.

## Changing them

Open **Settings**, and under **Data & Platform** choose **AI**. Choose your answers,
then **Save** at the bottom of the page. Nothing is applied until you save, and the page recaps every
change before it commits.

Only a member who can manage the firm's AI settings can change any of this — by default the firm's
owners and administrators, and not the people who can use the assistant. Being able to ask the
assistant a question is ordinary work; deciding that your firm's confidential material may leave the
platform is your firm's decision, so the two are not the same permission.

Everybody else sees where the firm stands on the same page, stated as facts rather than as controls
they cannot use. Whether the firm's content goes to a model is something every member of the firm
should be able to find out.

Every change is written to the firm's audit trail, with who made it and when. For this setting in
particular that record is the point: it is the firm's account of who consented, and when.

## Turning it back off

Closing either switch stops the assistant at once, including for questions already sent and still
waiting for an answer — those come back saying the firm's setting changed rather than quietly going
through. Conversations already held are not deleted; they stay on the firm's record, and their authors
can delete them. Files members attached to conversations were never copied, so nothing of them
needs removing either.

## Related

- [Asking Magnus](../features/asking-magnus.md): what the assistant can see, what it can do, and what
  a member is shown while it is off.
- [Turning on question-and-answer document search](natural-language-document-search.md): a separate
  feature with a separate decision, which does read your documents.
