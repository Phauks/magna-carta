# Public intake forms

_The form builder, the public page, and the submissions queue are built. Turning an accepted enquiry into a
directory record and a matter is done by hand from Intake for now._

## What it does

Put a page on the internet that somebody who is not yet your client fills in — who they are, how to reach them,
and what happened. You write the questions, publish the form, and hand out its link; what arrives waits in one
queue until somebody at the firm reads it.

**Nothing a stranger sends becomes a person, a matter or an intake on its own.** A submission is a row of text
until a member of the firm decides otherwise. That is the whole safety of the feature: however much spam a form
receives, the worst it can do is fill a list you clear.

## Writing a form

Open **Forms** and choose **New Form**. You give it two names, and they are different on purpose:

- **Name** — what your firm calls it, so you can find it in a list. Nobody outside the firm sees it.
- **Title** — what a visitor reads at the top of the page.

The form is created empty and **is not on the internet yet**. It stays private until you publish it.

### Adding questions

Each question is one of eight kinds:

| Kind                   | What it collects                                    |
| ---------------------- | --------------------------------------------------- |
| A person's name        | Asked in parts, the way your directory holds a name |
| An organization's name | For an enquiry from a company rather than a person  |
| An email address       | How you would write back                            |
| A telephone number     | Kept exactly as they typed it                       |
| A postal address       | One block of address lines                          |
| What happened          | The long free-text account of the problem           |
| A choice from a list   | Your own list of answers; they pick one             |
| A question of your own | Free text, worded however you like                  |

Most forms want a name, one way to reach the person, and one **What happened** box. Use **a question of your own**
when nothing else fits.

**Help text** sits under a question and stays there while somebody types. That is deliberate — grey text inside a
box disappears the moment a person starts typing, which is exactly when they needed to read it.

Mark a question **required** and the form cannot be sent without it. Be sparing: every required question is a
reason somebody gives up part-way.

### What you cannot ask for

The list of question kinds is fixed, and your firm's own custom fields are not on it. This is not an oversight. A
custom field can point at a record in your directory, and a public form able to use one would let a stranger aim
a value at somebody you know. Anything you would have used a custom field for, ask as **a question of your own**
or **a choice from a list**.

## Publishing, and changing a form afterwards

**Publish** puts the form on the internet and shows you its link. Paste that link into an email, or put it behind
a button on your website.

Afterwards you can keep editing. Your changes sit in a draft that nobody outside the firm can see, and the banner
at the top of the builder says so. Publish again to replace what the internet sees.

**Answers people already sent stay attached to the questions they were actually asked.** If you reword a question
next month, last month's answers still show under last month's wording. You are never left guessing which version
of a question somebody was answering.

Changes to the form's **title**, **introduction** and **confirmation message** are not questions, so saving those
changes the live page straight away. Publishing is only for the questions.

## What they are told after they send it

You write that sentence, and there is one rule worth following: **say no more than "we have received your enquiry
and someone will be in touch."**

It is tempting to be more helpful — "someone from our family law team will call you" — and it is the wrong thing
to write. The form has not decided who will read the enquiry, and a message that names a team tells a stranger
something about your firm before anybody has decided whether to act for them. Keep it general.

## Replacing the link, and closing a form

**Replace the link** mints a new one. Every link you have already handed out stops working — in emails, on your
website, in somebody's bookmarks. That is the point: it is what you do when a link has been scraped and the form
is being flooded. The form, its questions and every enquiry it has already received are all kept.

**Close the form** takes it off the internet. Its link then answers exactly as though it never existed. Closing
keeps everything and can be undone.

There is no way to delete a form, and that is deliberate: a form holds the enquiries people sent it, and those
are your record of who asked you for help.

## Reading what came back

**Submissions** on a form shows what arrived, newest first. Opening one shows each answer beside the question as
it was asked.

Record what you decided:

- **Accept** — you read it and want to take it further.
- **Decline** — you are not acting on it.
- **Spam** — it is not a real enquiry.

**None of these creates anything.** Accepting records that a member looked and decided; putting the person into
your directory and starting an intake is still done from **Intake**. You can change a decision later — an enquiry
marked spam that turns out to be real is exactly the mistake a queue produces.

## Keeping out the rubbish

Four things stand in front of your form, and the useful thing to know is which one actually protects you.

1. **A rate limit** on how fast anyone can post to it.
2. **A verification challenge**, shown to visitors who look automated. If your firm has not had this switched on
   yet, the form shows no challenge at all rather than a box that checks nothing.
3. **A daily limit** you can set per form, so one form being flooded does not touch your others.
4. **Bot filtering** at the edge.

None of those is the real protection. The real protection is that **nothing a stranger sends reaches your
directory, your matters or your conflicts records** until somebody at the firm puts it there.

## What is not built yet

- **Attachments.** A visitor cannot send you a file — the contract, the letter they were served. It is a real gap
  and it is waiting on a decision about the cost of accepting files from people nobody has identified.
- **Turning an accepted enquiry into a matter in one step.** Today you read the enquiry and start the intake from
  **Intake** yourself.
- **Forms for people who are already your clients.** These need the client portal, which is not built.

## Who can do what

|                      | Authoring and publishing | Reading and triaging submissions |
| -------------------- | ------------------------ | -------------------------------- |
| Owner, Administrator | Yes                      | Yes                              |
| Attorney             | No                       | Yes                              |
| Paralegal            | No                       | Yes                              |
| Billing              | No                       | No                               |
| Read-only            | No                       | No                               |

Publishing a form puts a page on the internet under your firm's name, which is why it stops at the seats that
decide how the firm takes work on. Clearing the queue is reception's daily job, so it reaches further.
