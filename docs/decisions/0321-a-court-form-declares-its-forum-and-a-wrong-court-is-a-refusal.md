---
number: 321
slug: a-court-form-declares-its-forum-and-a-wrong-court-is-a-refusal
status: Proposed
date: 2026-08-14
area: Document automation
summary: "A shipped court form carries the court it belongs to as VALUES — state, court level, and reach (statewide, judicial district, or county) — plus the proceedings it covers, so a wrong-court filing is expressible as a refusal rather than left to a naming convention. The check lives on the assembly path, not on adoption, and produces THREE distinct refusals rather than one: no court recorded on the matter, a court whose forum is unknown, and a court that disagrees with the form's. The middle one refuses rather than passes, which is the load-bearing half — a fallback there would make the binding decorative on exactly the matters where the data is thin. That refusal is only useful once courts carry a typed identity, which nothing in the platform records today: `matter_court_case.court_entity_id` points at an untyped `directory_organization`. So the court identity is build work scheduled AHEAD of the forms rather than a seam named beside them. A form whose merge keys the dictionary cannot supply is likewise not shippable — it declares them and stays blocked, listed."
---

**A form states the court it is for, and a matter that does not match it is a named refusal — three of them, because three different people fix the three different causes.**

**Context:** The owner asked whether a form should carry the court and case type it belongs to as values, so a wrong-court filing is expressible as a refusal rather than a convention. It should, and answering it exposed that the platform cannot currently tell one Nevada court from another.

Nevada makes the question concrete. The statewide self-help corpus is "acceptable to file in any court in Nevada"; the Clark County Family Law Self-Help Center's forms "have been approved for use in the Family Court in Clark County"; Washoe County's "for use in the Second Judicial District Court". Those are three different reaches published in three different places, and a firm holding all three has no structural way to keep them apart.

**Decision:**

(1) **Forum is data on the entry.** `state`, `courtLevel` (supreme court, court of appeals, district court, justice court, municipal court), and `reach` — a discriminated union of statewide, a judicial-district ordinal, and a county — plus the case types the form covers. Not a name, not a folder, not a prefix on a template's title.

(2) **Adoption is unconstrained; assembly is where the check lives.** A firm may hold any template it likes, and the catalogue carries no matter data. Assembly is the matter-rooted act and is where a court exists to compare against.

(3) **Three refusals, and they must stay distinct** — the discipline the trust jurisdiction seam already established, where "each is fixed by a different person doing a different thing". `court-form-no-court-recorded` (the matter records no court; whoever opened the matter fixes it). `court-form-forum-unknown` (a court is recorded but its forum is not typed; whoever maintains the Directory fixes it). `court-form-forum-mismatch`, naming both forums (whoever picked the template fixes it). Collapsing them produces a message that tells nobody what to do.

(4) **The unknown case REFUSES.** This is the half that carries the weight. The tempting alternative — we do not know the court's forum, so let it through — is a fallback, and there is no fallback anywhere in this posture: it refuses for want of data and names the repair. A silent pass would make the forum binding decorative on exactly the matters whose data is thinnest, which is where a wrong-court filing actually happens.

(5) **The court identity is build work scheduled ahead of the forms.** `matter_court_case.court_entity_id` points at a `directory_organization` carrying a legal name, a display name, a status, a merge pointer and a review flag — nothing that says it is a court, let alone which one. Today every matter would land in the unknown row and the check would always refuse, which is honest and useless. So a typed court record carrying jurisdiction, level and reach is sequenced before the content it protects, rather than named as a seam and left. It is additive: an untyped court organisation stays legal and resolves to unknown.

(6) **A form whose keys the dictionary cannot supply is not shippable.** A package fitness test asserts every merge key a shipped template names exists in the real dictionary with the value type and absence behaviour the entry claims — the projection property the merge-field catalog contract's fixture test already has, for its reason: a form describing fields the engine does not have is a second catalogue free to be wrong. An entry needing an unbuilt key declares `blockedOnKeys`, does not ship, and is **listed as blocked**, so the gap is an obligation somebody can see rather than a silent omission. Auditing the Nevada set against the 113 shipped keys found four such holes — the court's county and address, and a party's address, telephone and email address, none of which any subject carries — and those become dictionary work rather than a reason to author a form with a hole in it.

**Considered and rejected.** *A naming convention on the template title* — unenforceable, and wrong the first time somebody renames a template. *One `court-form-wrong-court` refusal* — collapses three repairs into one unactionable sentence. *Passing when the forum is unknown* — the fallback this whole posture exists to refuse. *Checking at adoption* — a firm may legitimately hold a form for a court it has no open matter in yet. *Authoring a form with a placeholder where a key should be* — produces a document that reads as finished and is not, which is the failure the absence model exists to prevent.

**Consequences:** "Is this the right court's form" becomes a question the data answers. Typing courts is a bigger change than the library it protects, and the library's first visible increment is correspondingly further away than "two probate notices" suggests. Forum matching catches the wrong court and nothing else — not the wrong proceeding, not a superseded local rule, not a judge's standing order — so the surfaces must keep saying that the library's value is provenance and currency rather than correctness.
