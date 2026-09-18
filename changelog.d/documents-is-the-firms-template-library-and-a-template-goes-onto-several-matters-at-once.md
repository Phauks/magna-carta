---
category: Added
audience: public
---

**The Documents destination ships, as the firm's template library.** The sidebar row had been a Soon stub since the rail was drawn; behind it now is `/documents`, the firm-level catalogue the matter's Files page has been building single documents from since slice 2·6·1 landed the routes — on the platform's one table (`apps/web/src/lib/templates/template-columns.ts`), read through the generated client and warmed from the route's load. Standing is derived rather than served: the listing carries a status word and a current-version handle, and only the pair says whether a template can be built from today (ready · being checked · archived), which is the rule the matter's picker already applied silently.

**A template is registered from the browser** (`register-template.ts`): presign, PUT to storage, register — the kind read off the file rather than asked for, because the signed URL covers the content type. The registration report is rendered as findings, so a Word merge field left unconverted, a legacy form field nothing binds, or a box on a form nothing fills is said out loud at the moment somebody can still do something about it.

**One template goes onto several matters at once** (`add-to-matters.ts`). An assembly stays what it is on the server — one job on one matter, behind that matter's own wall — and adding to five matters is five jobs, each under its own idempotency key, each polled to its own standing, none of them stopped by another's refusal. A document that landed with blanks is its own standing rather than "landed": it is on the matter and it needs a person's eye before it goes anywhere.

Archive is offered to a member holding `templates:manage`. The field inspector and authoring in the browser remain unbuilt.

## Public

**Documents is now a place you can go.** It is your firm's template library: every Word template and fillable form the firm has registered, who it is for, and whether it is ready to use. Register a template there from a Word document or a PDF form, and it tells you what it found in the file before anyone builds from it.

**Add a template to several matters in one go.** Choose the template, pick the matters, choose Word or PDF, and a document is built onto each matter, with a row per matter saying whether it landed, whether it has blanks you should look at, and where to open it.
