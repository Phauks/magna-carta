---
category: Added
---

**A template can name the other people on a matter, not just the client.** The opposing party, opposing
counsel, a guardian, and a witness are merge fields now — `{{opposingParty.displayName}}` reads the way
`{{client.displayName}}` always has, each role also offering whether that party is a person or an
organisation so a sentence can read differently for a company. The roles resolve through the matter's
own party links in the Directory, and how a firm wrote the role down does not matter: "Opposing Party",
`opposing_party`, and `opposing-party` are the same role, because spacing, capitals, hyphens, and
underscores are ignored when a link is matched to a field.

**A matter with two opposing parties gets an answer, not a guess.** A field naming _the_ opposing party
fills in only when the matter links exactly one. When it links three, nothing is filled in, the document
shows the usual visible marker, and the result says there were three — a document naming the wrong
defendant is the one mistake nobody catches by reading it. That reason travels with the absence
everywhere an absence already travelled, including into a condition that could not be worked out, so an
author reading the failure is told what is ambiguous rather than only which field went unanswered. For
the "list them all" case each role carries its own collection, walked with the repeating block that
already exists: `{{#each opposingParty.all}}`.

Every role is answered from the party read the merge context already issued. A template naming four
roles costs exactly what a template naming one does, and what a template naming none did — no new query,
no new index, and no change to the four measured operations' plans, all of which remain index walks.
