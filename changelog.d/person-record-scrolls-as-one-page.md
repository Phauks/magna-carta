---
category: Changed
audience: public
---

**A directory person is one scrolling page, entered and read alike.** `record-sections.svelte` stacks every section of a record on one page with a jump rail that lights the section in view (`record-sections.ts` holds the scroll arithmetic and the Show All cap), and both the New Person dialog and the entity window compose it in place of vertical tabs. Pronouns and Dates fold into one About section; `personDraftSummary` reads the draft back as values rather than counts; the entity window's facts move into `entityWindowSubtitle` and its context pane is passed only when a host hands over standing, so `entityWindowFacts` is gone; the matters and relationship panes cap at five rows with Show All; New Person's commit says Save.

## Public

**A person is entered and read on one scrolling page.** New Person and a person's record now show every section on one page that scrolls, and the list down the left side jumps between them and highlights the section you are in, so a name, a phone number and an address are entered or read without switching sections, and Tab moves through every field. Pronouns and dates share one About section. While you enter a new person, the right side shows the entry as it will read, such as the email address itself, and the button says Save. A record shows a person's pronouns and dates under their name, keeps its right-hand column for the roles they hold on the matter you opened it from, and shows the first few lines of a long list with Show All.
