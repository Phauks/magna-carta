# The Directory Entity Model — People, Organizations, and Everything the Firm Records About Them

**Date:** 2026-08-30 · **Status:** Owner-reviewed; Phase A built. The open questions of §7 are
**answered** — the owner's rulings are recorded there and every section they change has been rewritten
to match, so this document no longer asks anything · **Subsystem:** Directory
(`packages/directory`, `apps/api-worker/src/routes/directory/directory.ts`, the thirteen `directory_*` tables
in `packages/database/src/per-firm-schema.ts`) · **Primary consumer:** the conflicts checker
(`packages/conflicts`), which is why most of this data exists at all.

**The owner's framing, which this design serves:** person and organization information is much
deeper than the built surface suggests. First name, middle name, last name, maiden name, social
security, multiple contacts, email, phone, fax, address, duplicates of all of these, passport
numbers, driver's licence, other identifying numbers. Organizations are similar; people can be
members of organizations, and the firm may represent an organization directly.

**Binding constraints:** multi-tenant per-firm D1 with every read firm-scoped through
`@magna-carta/data-access` (ADR-0003); expand-contract migrations only and a committed migration is
immutable ([`packages/database/CLAUDE.md`](../../packages/database/CLAUDE.md), including the snapshot
rule); every sensitive value passes the protected-field chokepoint as ciphertext
(`packages/directory/src/identifiers.ts`); names spelled out in full; no process-artifact references
in source.

---

## 1. What actually exists — verified, not assumed

The model is materially deeper than the screen. Anyone reading the record page would conclude the
directory holds names and a few sealed numbers. That is wrong, and the correction matters because it
changes this from a rebuild into a completion.

### 1.1 The thirteen tables, and how much of each is reachable

| Table                          | Schema | Domain code | HTTP route | Screen |
| ------------------------------ | ------ | ----------- | ---------- | ------ |
| `directory_person`             | rich   | yes         | yes        | yes    |
| `directory_organization`       | thin   | yes         | yes        | yes    |
| `directory_name`               | rich   | yes         | yes        | yes    |
| `directory_name_phonetic_code` | yes    | yes         | internal   | n/a    |
| `nickname_equivalence`         | yes    | ships empty | no         | no     |
| `directory_identifier`         | rich   | yes         | yes        | yes    |
| `directory_edge`               | yes    | yes         | yes        | yes    |
| `directory_category`           | yes    | yes         | yes        | yes    |
| `directory_entity_category`    | yes    | yes         | yes        | yes    |
| **`directory_email`**          | yes    | **partial** | **none**   | none   |
| **`directory_phone`**          | yes    | **none**    | **none**   | none   |
| **`directory_address`**        | yes    | **none**    | **none**   | none   |
| `directory_party_role`         | yes    | yes         | partial    | yes    |

### 1.2 Names are already strong

`directory_name` is temporal (`valid_from` / `valid_to` / `is_current`), role-typed, carries the
five Western name parts, a frozen `normalized_display` that is the FTS5 content column, two derived
match keys (`normalized_match_key`, `normalized_match_key_bare`) and Double Metaphone phonetic codes
in a side table. Multiple names per entity and maiden names are solved, and the search layer reports
**which** name row a hit landed on so a maiden-name hit does not masquerade as a current-name hit.

### 1.3 Identifiers are already strong

`directory_identifier` is one row per value, temporal, soft-deleted, and every value is sealed
through the protected-field chokepoint. `identifiers.ts` carries a per-type declaration with a frozen
normalize transform and an explicit blind-index policy — including the deliberate refusal to index
low-entropy types. `listIdentifierRecords` can say _which_ identifiers the firm holds without
decrypting any of them, and `findEntitiesSharingIdentifiersBatch` is a pure blind-index self-join
that gives conflicts an exact-identifier channel with no decrypt, no permission and no audit.

**Nothing in this document weakens any of that.** The identifier work below is catalog and metadata,
not a change to the sealing.

### 1.4 The headline finding — the contact tables are unreachable

`apps/api-worker/src/routes/directory/directory.ts` mounts twenty-five route definitions. **Not one of them
touches email, phone, fax or address.** Grepping the whole repository for the three tables finds
them in the schema, in the migrations, in the erasure registry
(`packages/data-access/src/pii-registry.ts`, where all three are `hard-delete` on subject erasure),
in `packages/directory/src/statements.ts`, and in exactly two live consumers:

- `packages/directory/src/contact-email.ts` — a complete email write path (insert with normalized
  match key, update, soft delete, primary demotion) built for **inbound email capture**, not for a
  person telling the firm their address.
- `packages/directory/src/party.ts` — `readMatterPartiesForEmailAddresses`, the reverse lookup that
  proposes a matter from who is talking on a captured message.

`directory_phone` and `directory_address` have **no domain module at all**. There is not one
statement anywhere in the repository that inserts a phone number or an address for a person.

`apps/web/src/lib/directory/entity-sections.ts` listed seven panes — Names, Pronouns, Identifiers,
Duplicates, Relationships, Matters, Categories. There was no Contact pane, because there was nothing
behind one.

**So today a firm cannot record a client's telephone number.** That is the finding, and it is the
first thing this design fixes.

> **Fixed, 2026-08-30.** Phase A is built: `contact-phone.ts` and `contact-address.ts` exist,
> `contact-email.ts` is a general write path rather than a capture-only one, thirteen routes reach the
> three tables, and the record screen has a Contact pane. The paragraphs above are kept in the past
> tense on purpose — they are the measurement that justified the work, and a design that quietly
> rewrites its own finding once the work lands leaves the next reader unable to tell what was true.

### 1.5 The organization is thin, and the schema itself already suffers for it

`directory_organization` holds `legal_name`, `display_name`, the merge-graph `status` and
`merged_into_id`, `needs_review`, and timestamps. Nothing else. Compare `directory_person`, which
carries five name parts, a member mapping, and a six-column pronoun declension with a completeness
CHECK.

This is not hypothetical harm. Two columns elsewhere in the same schema already point into
`directory_organization` and cannot tell what they are pointing at:

- `court_entity_id` — "FK to `directory_organization.id` (the court)"
- `estate_entity_id` — "FK to `directory_organization.id` (the estate's own record)"

A picker that must offer _the courts_ has no column to filter on. A conflicts reviewer looking at a
tier-2 name hit between two organizations called "Meridian Holdings" has nothing to tell them apart.

### 1.6 The catalogs are open at rest and closed at the edge — the worst combination

Four columns are constrained only by `length(...) > 0`: `directory_identifier.identifier_type`,
`directory_edge.edge_type`, `directory_name.name_role`, and the `label` on phone and address (which
has no constraint at all). The application-level catalogs live in
`packages/directory/src/types.ts`, and the route validates against them with `z.enum(...)`.

The consequence is precise. The route refuses an unknown identifier type, so the open CHECK buys
nothing at the edge — but `IDENTIFIER_DECLARATIONS` is a `Record<IdentifierType, …>`, so any write
path that is **not** the route (a data import, a migration, a future bulk loader) can store
`drivers_licence` beside `drivers_license`, and the next `addIdentifier` for that type resolves a
declaration of `undefined` and fails on a property access rather than with a named domain error.
Meanwhile the two spellings never blind-index against each other, so a conflicts check silently
misses a match it was built to find.

There is also a live documentation drift: the schema comment on `directory_name.name_role` says the
roles are `legal`, `preferred`, `maiden`, `trading`, while `NAME_ROLES` in `types.ts` is `current`,
`former`, `alias`, `aka`, `maiden`, `dba` — and the conflicts default balanced set
(`DEFAULT_BALANCED_NAME_ROLES`) is built from the second list. The comment describes a catalog
nothing uses.

### 1.7 Identifier jurisdiction is encoded in the value string

`normalizeDriversLicense` splits the plaintext on the first `:` and treats the left side as the
issuing state. That convention is defensible and it works — the state binds into the blind index, so
two states' identical licence strings never collide. But the jurisdiction is **inside the sealed
value**, which means:

- Nothing can render "Nevada driver's licence" on a screen without a permission-gated audited
  decrypt.
- No other identifier type gets the treatment. A passport has an issuing country. A bar number is
  state-scoped (the code comment says so). A tax identifier is national. None of them can say so.
- A caller who omits the prefix normalizes under the empty-state prefix, and nothing anywhere can
  detect that it happened.

### 1.8 Date of birth is stored as an identifier, and the code says so

`IDENTIFIER_TYPES` contains `dob`. `IdentifierNotIndexableError` exists **because** of it — its
entropy is too low to blind-index without leaking the value distribution, so conflicts resolves it by
decrypt-and-compare over a candidate set. It is the only entry in that catalog that nobody issued,
that identifies nobody uniquely, and that a firm needs to compare with `<` and `>` rather than `=`.

### 1.9 The edge catalog flattens a distinction the conflicts engine is budgeted around

`EDGE_TYPES` is seven values. `packages/conflicts/src/edge-classes.ts` partitions them into four
classes with per-class hop budgets, and the module's own opening comment explains why one integer
budget cannot serve them all. But **every organizational membership — employment, a directorship, an
officer post, a shareholding, a trusteeship — collapses into the single type `affiliation`**, which
is classed `control`.

So the traversal spends its control budget walking from an adverse corporation to a mailroom clerk
with exactly the same weight it spends walking to the chief executive. The class map is right; the
catalog underneath it is too coarse to feed it.

### 1.10 Phone is one unstructured column, and fax is a free-text label

`directory_phone` is `label` (nullable, unconstrained) and `number` (non-empty text). No country
code, no national number, no extension, no canonical form to index or dial, and no way for a program
to know that a row is a fax line rather than a mobile.

---

## 2. What the research says, and what it is worth here

### 2.1 vCard, RFC 6350 — taken: multiplicity and preference. Rejected: TYPE as one dimension.

vCard establishes that every contact property is unbounded in cardinality (`TEL`, `EMAIL`, `ADR`,
`RELATED` are all `*`), that structured names have five components in a fixed order, that `ADR` has
seven components, and that preference is an ordinal `PREF` parameter from 1 to 100 rather than a
boolean.
([RFC 6350](https://www.rfc-editor.org/rfc/rfc6350.txt))

**Taken:** the multiplicity is already how the tables are shaped, which is a quiet vindication of the
existing design. The `ADR` component list confirms `directory_address` is missing only a second
street line and a district/county.

**Rejected:** vCard's `TEL` `TYPE` parameter mixes technology (`fax`, `pager`, `textphone`) with
context (`work`, `home`) and with device (`cell`) in one flat list, so `TYPE=cell,fax` is
uninterpretable. That is precisely the ambiguity the free-text `label` column already has. Also
rejected: `PREF` as a 1–100 integer. A firm needs "which one do I use", not a ranking with
ninety-nine unused positions, and `is_primary` already answers it.

### 2.2 FHIR R4 — taken: the `system` / `use` split, and `Identifier.system` as a namespace.

FHIR splits a contact point into `system` (`phone | fax | email | pager | url | sms | other` — _what
communications system is required to make use of the contact_) and `use` (context), plus `rank` and
`period`. `Identifier` is `use`, `type`, **`system`** ("Establishes the namespace for the value —
that is, a URL that describes a set of values that are unique"), `value`, `period` and `assigner`.
`HumanName` carries `use` from a **required, non-extensible** value set — `usual | official | temp |
nickname | anonymous | old | maiden` — and a `text` element holding the name as it should be
rendered.
([FHIR R4 datatypes](http://hl7.org/fhir/R4/datatypes.html#Identifier),
[contact-point-system](http://hl7.org/fhir/R4/valueset-contact-point-system.html))

**Taken, and it is the single most useful thing in the research:**

1. **`system` and `use` are orthogonal.** Fax is a _system_, not a label. Work/home/mobile is a
   _use_. Two columns, and the ambiguity disappears.
2. **`Identifier.system` is the namespace that makes the value meaningful.** This is exactly the
   missing jurisdiction — generalized. A driver's licence number is meaningless without its issuing
   state; a social security number, a national insurance number, a tax file number and a social
   insurance number are four different national schemes that a single `ssn` type cannot express.
3. **`HumanName.text`** — a name row must be able to carry the name as written, because parts cannot
   render a mononym or a family-name-first name.
4. `period` on both — already present as `valid_from` / `valid_to`.

**Rejected:** a URI as the scheme key. FHIR uses URLs because it federates across organizations that
never agreed on anything; this platform ships one catalog and a URL would be ceremony. A short stable
dotted key does the same work and reads in a log.

**Rejected:** FHIR's required, non-extensible `HumanName.use` value set adopted verbatim. `anonymous`
and `temp` are clinical concerns; `dba` and `trading` are legal ones FHIR has no word for.

### 2.3 NIEM — taken: birth, death and other-identification as first-class person facts. Citizenship dropped by the owner.

`nc:PersonType` carries `PersonName [0..*]`, `PersonAlternateName [0..*]`, `PersonBirthDate`,
`PersonBirthLocation`, `PersonDeathDate`, `PersonCitizenshipISO3166Alpha2Code [0..*]`,
`PersonSSNIdentification`, `PersonPassportIdentification`, `PersonStateIdentification`, and
`PersonOtherIdentification` — "information about an identifier with a kind that is not explicitly
defined".
([nc:PersonType](http://www.datypic.com/sc/niem21/t-nc_PersonType.html))

**Taken:** NIEM — a model built by and for law enforcement and the courts, the closest institutional
neighbour this platform has — puts birth date, death date and citizenship on the **person**, and
puts SSN and passport in **identification**. It draws the line exactly where section 3.3 below
draws it, and it does so having modelled criminal-justice information exchange for two decades.
NIEM also carries citizenship at `[0..*]`; **the owner dropped citizenship from this model**, so it is
taken from NIEM neither as a column nor as a table.

**Taken:** `PersonOtherIdentification` is the named escape hatch — the owner's "other identifying
numbers" has an established shape, and it is a typed row with a scheme, not a free-text note.

**Rejected:** NIEM's XML augmentation machinery and its property-per-identifier-kind style
(`PersonSSNIdentification` as a distinct element). One `directory_identifier` table with a scheme key
is the same information with none of the schema churn — and it is what the platform already has.

### 2.4 Popolo — taken: the argument, rejected: the table.

Popolo makes `Membership` a first-class n-ary object (`person_id`, `organization_id`, `post_id`,
`role`, `label`, `start_date`, `end_date`, `on_behalf_of_id`) precisely because a binary link cannot
carry a duration or a capacity.
([Popolo Membership](https://www.popoloproject.com/specs/membership.html))

**Taken:** the argument that membership needs properties of its own.

**Rejected:** the table. `directory_edge` **is already** that object — it has `role`, `note`,
`valid_from`, `valid_to` and its own id. Adding `directory_membership` would duplicate it and split
the conflicts traversal across two corpora. The defect is catalog granularity, not shape (§3.5).

### 2.5 schema.org — taken: the organization property set and the identifier-scheme-per-property idea.

`Organization` carries `legalName`, `alternateName`, `foundingDate`, `dissolutionDate`, `taxID`,
`vatID`, `duns`, `leiCode`, `naics`, `parentOrganization`, `subOrganization`, `member`, `memberOf`,
`employee`, `founder`, and a subtype tree (`Corporation`, `GovernmentOrganization`, `NGO`,
`EducationalOrganization`, `LocalBusiness`, `WorkersUnion`, …).
([schema.org/Organization](https://schema.org/Organization))

**Taken:** `foundingDate` / `dissolutionDate` as first-class, and the observation that a real
organization vocabulary always distinguishes kinds. schema.org expresses kind as **subtypes** because
it is a type system; this is a database, so it becomes a `organization_kind` column with a
registered catalog.

**Rejected:** a property per identifier scheme (`taxID`, `vatID`, `duns`, `leiCode` as separate
columns). That is a schema migration for every new scheme, on every tenant, forever — the exact
outcome the existing one-row-per-value table already avoids.

### 2.6 The legal-industry side

**ABA Model Rule 1.13 and its comment — the organization is the client, and its constituents are
not.** "An organizational client is a legal entity, but it cannot act except through its officers,
directors, employees, shareholders and other constituents", and the lawyer's duties run to the
organization, not to those constituents.
([Rule 1.13 comment](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_13_organization_as_client/comment_on_rule_1_13/))
This is the owner's "or you may just represent an organization", stated as a rule of professional
conduct. The model must be able to hold _the firm represents Acme; Jane is Acme's chief financial
officer; Jane is not the client_ — and the existing pieces (`matter_party` with role `client`
pointing at the organization, plus a `directory_edge` from Jane to Acme) already can. What is missing
is that the edge cannot say what kind of constituent Jane is.

**ABA Model Rule 4.2 — "In representing a client, a lawyer shall not communicate about the subject of
the representation with a person the lawyer knows to be represented by another lawyer in the matter,
unless the lawyer has the consent of the other lawyer or is authorized to do so by law or a court
order."** Comment [9] extends it to organizational constituents who supervise, direct or consult with
the organization's lawyer about the matter, who have authority to obligate the organization, or whose
acts may be imputed to it — and to any former constituent who substantially participated in the
representation.
([Rule 4.2, NC State Bar](https://www.ncbar.gov/for-lawyers/ethics/rules-of-professional-conduct/rule-42-communication-with-person-represented-by-counsel/))

Two consequences the design must honour, and the second is the one that is usually got wrong:

1. Which constituents are off-limits is a function of their **role in the organization**, which is
   exactly the granularity §1.9 says the edge catalog lacks.
2. **The duty is scoped to the matter, not to the person.** "About the subject of the representation
   … in the matter". A person represented on one matter may be contacted freely about an unrelated
   one. An entity-level do-not-contact flag states the rule wrongly.

**ABA Model Rules 1.7, 1.9, 1.10 and 1.18, and Formal Opinion 510.** Rule 1.10(e) obliges a firm to
maintain procedures to detect conflicts; Rule 1.18 extends the exposure to prospective clients who
never retained the firm; Formal Opinion 510 turns on whether the lawyer took reasonable measures to
avoid learning more disqualifying information than was necessary.
([ABA on Opinion 510](https://www.americanbar.org/news/abanews/aba-news-archives/2024/03/ethics-guidance-conflict-prospective-clients/))
The practitioner literature is consistent that the corpus must span current, former and prospective
clients, opposing parties and **related entities**, and that name change is the standing failure mode.
([Clio](https://www.clio.com/blog/conflict-check-how-to/),
[Hinshaw](https://www.hinshawlaw.com/en/insights/lawyers-lawyer-newsletter/identifying-and-resolving-conflicts-of-interest-three-simple-rules))
This platform already does the name-change part better than the literature asks. The **related
entities** part is where §3.5 applies.

**Service of process.** Courts require proof of diligence before permitting substituted service, and
verification of a last-known address against postal forwarding records is the ordinary first step.
([One Legal](https://contractorsupport.onelegal.com/en/articles/9236682-address-verification-essential-steps-for-process-servers))
An address record that cannot say where it came from or when it was last confirmed cannot support
that affidavit. This is the concrete, non-hypothetical reason for §3.4.

**State data-breach statutes.** The near-universal definition of "personal information" is a name in
combination with a Social Security number, a driver's licence or state identification number, a
passport number or other government identification number, or an account number with its access
credential.
([IRMI](https://www.irmi.com/articles/expert-commentary/state-breach-notification-laws-personal-information-definition))
That sentence is a specification of which identifier schemes carry notification exposure, and it is
why a scheme descriptor should carry that flag rather than leaving it to be rediscovered per
incident.

**LEDES.** Reviewed and largely **rejected as an input**. LEDES 1998B is twenty-four pipe-delimited
billing fields; LEDES XML 2.1 adds tax, regulatory statements and firm/client addresses.
([LEDES.org](https://ledes.org/ledes-xml-ebilling-ver-2-1-format/))
It models _invoices_, not parties, and its only party content is a billing address. It constrains the
billing subsystem, not this one. It is named here so that a later reader does not go looking.

**Clio and Actionstep.** Clio models a contact as person or company, a company holds employees, and
multiple phone numbers and addresses per contact with one primary of each are ordinary.
([Clio](https://help.clio.com/hc/en-us/articles/9290486281627-Clio-Manage-Contacts-Overview))
Actionstep is the more interesting one: a contact becomes a **participant** when linked to a matter,
participant types classify the link, and custom data fields hang off the _participant type_ — so the
data is scoped to the role the contact plays on the matter, not to the contact.
([Actionstep](https://support.actionstep.com/support/solutions/articles/150000019991-about-participant-types))

**Taken:** the confirmation that person/organization with multiple contact points and one primary each
is the settled industry shape, and that role-on-a-matter is where role-specific data belongs — which
this platform already has as `matter_party.role` plus `matter_party.capacity`, and which the
custom-fields engine can extend without any new machinery.

**Rejected:** Clio's convertible contact (a company contact can be flipped to a person contact). Two
tables with two id prefixes and a merge graph is a better model, and a flip would corrupt every
`matter_party`, edge and identifier pointing at the row.

---

## 3. The proposed model

Everything below is **additive**. No table is dropped, no column is repurposed, no frozen transform
changes, and no existing blind index is invalidated.

### 3.1 Contact points — reach the tables, then structure them

**Keep three tables.** A postal address has seven components and a telecommunication endpoint has
one; collapsing them into a polymorphic `directory_contact_point` would put six always-null columns
on every phone row and would break `directory_email_normalized_address_index`, which inbound email
capture depends on. FHIR itself keeps `Address` separate from `ContactPoint` for the same reason.

**`directory_phone` gains:**

| Column                 | Why                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `contact_system`       | `voice` \| `fax` \| `sms` \| `pager`. What technology answers this number. Registered catalog, open CHECK, gated at the route.            |
| `contact_use`          | `work` \| `home` \| `mobile` \| `other` \| `former` \| `temporary`. What context. Orthogonal to system, per FHIR.                         |
| `country_calling_code` | Digits, no leading plus. NULL where the input carried no country — a national-form number says nothing about which country it belongs to. |
| `national_number`      | Digits. NULL where the input could not be split at all. Indexed with the calling code, which is the pair a lookup seeks.                  |
| `extension`            | Separate column. E.164 has no extension concept, and an extension inside a canonical string breaks dialling.                              |
| `country_region_code`  | The ISO 3166-1 alpha-2 region the number was read against, so a re-parse is reproducible.                                                 |

**Built without a `number_e164` column, deliberately.** The two columns above ARE the canonical
number; a third holding them concatenated is a derived value to keep in step forever, and composing
one string for a dialler is a line at the read (`internationalPhoneNumber` in `phone-number.ts`).

`number` stays exactly as it is and keeps its meaning: **the number as entered**. A number the parser
rejects is still stored and still displayed; only the canonical column goes null. `label` is retained
and deprecated in favour of the two typed columns, read-only from the day the typed columns exist.

**Fax is a system, not a label — and this is a real decision, not a taxonomy preference.** Three
consequences follow from it. A document-delivery path that asks "may I fax this to opposing counsel"
must not answer from a column where `fax`, `Fax`, `facsimile` and `office/fax` all mean the same
thing to a person and nothing to a program. Service by facsimile is a distinct permitted method under
several courts' rules and consent to it is a recorded fact. And a voice line must never be fax-dialled
nor a fax line voice-dialled. vCard's `TYPE=fax` and FHIR's `system=fax` disagree about where it
lives; FHIR is right because it keeps context out of the technology axis.

**A number that takes both voice and fax is two rows, not one combined value.** They are separately
verifiable facts with separately recorded provenance — a switchboard that answers voice today may have
had its fax decommissioned last year — and a combined enum value cannot carry two verification dates.
The temporal and primary machinery already handles multiple rows per entity.

**The UI stays one control.** A single picker offering Mobile, Office, Home, Direct Dial, Fax writes
the two columns behind it. The storage is orthogonal because programs need it to be; the person
entering a number never sees two dropdowns.

**`directory_address` gains the international field set, not a second American one.** The owner's
direction was explicit: follow the address-internationalization patterns, because which fields a
country uses, what they are called and what order they read in all change by country — so do NOT
hardcode a state and a five-digit postal code. The columns are therefore named for their POSITION in
an address: `recipient`, `organization_name`, `street` (first line), `street_two` (second line — a
suite had nowhere to go), `dependent_locality` (neighbourhood, district, suburb, county), `city`
(locality), `region` (administrative area), `postal`, `sorting_code` (France's CEDEX and its
equivalents), `country`. Plus `address_use` (`residential` \| `business` \| `postal` \| `registered`
\| `service` \| `former` \| `temporary`), `address_type` (`physical` \| `postal` \| `both`, per FHIR
— a post office box cannot be personally served), and `normalized_key`.

**`normalized_key` is a DUPLICATE key and not a canonical postal form.** It folds case, accents and
punctuation and joins the parts with a separator, so a value crossing a field boundary cannot make two
different addresses collide. It does not abbreviate Street to St or decide that Apartment and Unit are
the same word: that is postal normalization, it is country-specific, and it is what a provider is for.
Doing it badly in-house would produce a key whose meaning silently changes the day a real one arrives.

**`directory_email` gains** `contact_use` on the same catalog as phone, and keeps `normalized_address`
and its index untouched.

### 3.1a Permission and preference — the owner's ruling

**"We should be able to denote what methods a person can or should be contacted."** CAN and SHOULD are
two facts and one flag holds neither well, so all three tables gain `contact_permitted` (default yes),
`contact_preferred` (at most one per entity ACROSS the three tables, because "write to me" is one
answer about every channel) and `contact_note`. `is_primary` is a third and different thing and is
untouched: the CHANNEL's default row, where a message goes when the sender named no address.

Withdrawing a permission is what the screen offers where deleting would otherwise be used — deleting
loses the instruction along with the value, and the next member re-enters the number and rings it. The
whole reasoning is in the ADR fragment
[`a-contact-point-carries-a-permission-and-a-preference-and-they-are-two-facts`](../decisions/pending/a-contact-point-carries-a-permission-and-a-preference-and-they-are-two-facts.md).

**Duplicates within one entity.** All three tables gain a partial unique index over the live rows —
`(entity_id, normalized_address)`, `(entity_id, number_e164, extension)`, `(entity_id,
normalized_key)`, each `WHERE deleted_at IS NULL`. These are hand-written migrations; drizzle-kit
cannot express a partial index, which the database package's own conventions call out as normal.
Phone and address are empty in production, so the index is safe immediately. **Email is not empty** —
inbound capture writes it — so email gets a fitness probe reporting the duplicate count first, and the
index only after the count is zero.

### 3.2 Identifiers — a registered scheme, and a jurisdiction of its own

**An identifier scheme becomes a descriptor, not a string.** A registry entry carries:

- `key` — stable and dotted: `us.social_security_number`, `us.state.drivers_license`,
  `us.passport`, `us.employer_identification_number`, `us.state.bar_number`, `au.business_number`,
  `gb.national_insurance_number`, `financial.account_number`.
- `label`, and `applies_to` (`person` \| `organization` \| `both`).
- `jurisdiction_requirement` — `required`, `optional`, or `not_applicable`. A driver's licence
  requires one; a passport requires an issuing country; an account number has none.
- `normalize` and `blind_index` — **the existing declarations, moved, not rewritten**, including the
  explicit never-index policy with its stated entropy reason.
- `display_policy` — `masked_last_four` \| `masked_full` \| `plain`. What a screen may show without a
  decrypt. Today every screen shows only that a value exists.
- `format` — a validation pattern and, where the scheme defines one, a check-digit rule. This is
  entry-time correctness a firm gets nowhere else.
- `breach_notification_element` — whether name-plus-this-value meets the statutory definition of
  personal information. This is a compliance fact about the scheme, and it belongs beside the scheme.

**Where it lives:** in code, as reference data identical for every firm, following the precedent
`packages/trust-jurisdictions` already set — "a rule correction is a package release, never a
migration against every tenant". Never a per-firm table.

**`directory_identifier` gains:**

| Column             | Why                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `jurisdiction`     | The issuing authority key (`US-NV`, `US`, `AU`). Nullable.                                                         |
| `issuer_entity_id` | Nullable link to the issuing `directory_organization` (a bar, a court) — FHIR's `assigner`. See open question O-4. |
| `scheme_key`       | The registry key. Nullable during expand; `identifier_type` is retained forever as the frozen index discriminator. |

**The blind index does not move, and this is the load-bearing part of the migration.** The frozen
driver's-licence transform composes `"{state}:{value}"`. Today the state arrives inside the plaintext;
after the change it arrives from the `jurisdiction` column and the composition is performed by the
write path before the same frozen transform runs. **The bytes fed to the transform are identical**, so
every existing index still matches and no backfill is required for correctness. A pre-existing row
with `jurisdiction IS NULL` means "the jurisdiction, if any, is inside the value" and the read path
says so rather than claiming the licence has no state. An audited decrypt-and-split backfill is
available but optional, and is not on the critical path.

**The CHECK stays open, and a fitness function closes it.** A committed migration is immutable, so a
closed `IN (...)` CHECK would need a new migration every time the catalog grows and would fail on a
firm mid-upgrade. The pattern that already works here is `directory_edge.edge_type`: open at rest,
catalogued in code, and policed by a coverage test that fails when a catalog entry lands with nothing
beside it. `directory_identifier` gets the same treatment, plus a fitness probe reporting any stored
`identifier_type` that is not a registry key — which is what would have caught
`drivers_licence`/`drivers_license` on the day it landed.

### 3.3 Person attributes that are not identifiers

`date_of_birth`, `date_of_death`, `deceased`, and place of birth are facts **about** a person. Nobody
issued them, they identify nobody uniquely, and the first two are wanted as **ranges** — is this
client a minor, is a guardian ad litem needed, has a limitation period tolled, is this person over
sixty-five for an elder-abuse statute, whose birthday is this month. A range query over ciphertext is
not a query.

**Proposed on `directory_person`:**

| Column          | Notes                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `date_of_birth` | Plain ISO calendar date, nullable, **in the clear**. Settled by the owner — see below.                                                                                                           |
| `date_of_death` | Plain ISO calendar date, nullable.                                                                                                                                                               |
| `deceased`      | 0/1, default 0. Separate from the date. "Known dead, date unknown" is a real state and probate work meets it constantly. The date-implies-the-flag rule lives in the write path, not in a CHECK. |

**`birth_place` is deferred** rather than built: no engine consumes it, the owner's direction named
the two dates, and a column nothing reads gets filled in inconsistently before anything depends on it.

**The implication is enforced in the write path, not in a CHECK,** because a cross-column CHECK cannot
be added to a populated table without rebuilding it and this schema is expand-contract only. Clearing
the flag while a date of death stands is refused rather than silently corrected.

There is already a consumer waiting: the schema carries `decedent_entity_id` pointing at
`directory_person` for an estate. An estate matter whose decedent has no date of death anywhere in the
system is the gap made concrete.

**Citizenship is dropped.** The owner's ruling: not in this model, and not seamed for. A firm that
needs it has `packages/custom-fields`. The proposed `directory_person_citizenship` table is withdrawn.

**Settled: the full date, in the clear.** The owner's ruling was "obviously date of birth needs a
year, but wtf is wrong with our code that we cannot handle a date of birth", and it reads the defect
correctly — the answer is that a date of birth was filed in the encrypted identifier table, which
matches only by exact blind index, and a date of birth is too low-entropy to index safely, so the code
deliberately refused. That is a filing mistake, not a capability limit.

The **`birth_year` compromise is withdrawn**: a year answers "is this client a minor" and cannot fill
in the date-of-birth field on a court form, so it would have left the original complaint standing while
adding a second home for the same fact.

The reasoning it stands on is the one the pronoun columns beside it already stand on: ordinary personal
data, printed in documents all day, whose confidentiality is the file's confidentiality. A permission
gate and an audit row on every document render buys nothing against a member who has the file open and
costs enough that the practical result is a firm that stops recording the date. What the classification
buys is registration in `packages/data-access/src/pii-registry.ts`, so erasure reaches it, and coverage
by the standing redaction default, so no log line carries it. **Stated so it is decided rather than
discovered:** several state breach statutes name a date of birth as a notifiable element, and this is a
plaintext column in a per-firm database.

A **calendar date and nothing else** — no time, no zone. The write path refuses a date that names no
day (`2026-02-30` matches the shape and is not a date) and a date of death that precedes the birth.

Whatever is decided, the new column is registered in `packages/data-access/src/pii-registry.ts` for
subject erasure, and the `dob` identifier scheme is retained readable forever and closed to new
writes.

### 3.4 Provenance and verification — on every contact point and every identifier

Five columns, the same five, on `directory_email`, `directory_phone`, `directory_address` and
`directory_identifier`:

| Column                | Values                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`              | `client_stated` \| `intake_form` \| `court_filing` \| `opposing_counsel` \| `public_record` \| `correspondence` \| `third_party_service` \| `firm_staff` \| `imported` |
| `source_detail`       | Free text, or a document reference. Nullable.                                                                                                                          |
| `verification_status` | `unverified` (default) \| `verified` \| `failed`                                                                                                                       |
| `verified_at`         | ISO instant, nullable                                                                                                                                                  |
| `verified_by`         | User id, nullable                                                                                                                                                      |

`failed` is the column that does the most work and has nowhere to live today: **returned mail, a
bounced message, a disconnected line.** A returned envelope is the single most important fact an
address can carry, and it is the difference between an affidavit of diligence that stands and one that
does not.

**Columns on the row, not a side table.** A polymorphic `directory_contact_provenance` keyed on
(table, id) would turn every contact read into a join, and "last confirmed" is exactly the fact a list
renders inline. Five columns on four tables is more DDL and less code, and the DDL is a one-time cost.

### 3.5 Membership and representation

**No new table.** `directory_edge` is already the n-ary object Popolo argues for — it has an id, a
role, a note and a validity period. The defect is that the catalog underneath it is too coarse for
the conflicts class map above it.

**`EDGE_TYPES` grows, with each new type classed in `edge-classes.ts` in the same change** — the
existing coverage test enforces that, so this cannot land half-done:

| New edge type                | Class         | Why it is its own type                                                   |
| ---------------------------- | ------------- | ------------------------------------------------------------------------ |
| `officer_of`                 | `control`     | Can bind the organization — Rule 4.2 comment [9], first and second limbs |
| `director_of`                | `control`     | Same                                                                     |
| `partner_of`                 | `control`     | Same, and a partner's conduct is imputed                                 |
| `trustee_of`                 | `control`     | Fiduciary control of an entity the firm may be adverse to                |
| `personal_representative_of` | `control`     | Acts for an estate                                                       |
| `agent_of`                   | `control`     | Attorney-in-fact, power of attorney                                      |
| `employment`                 | `constituent` | Cannot bind. Rule 4.2 reaches an employee only through the third limb    |
| `member_of`                  | `constituent` | The owner's "people can be members of organizations"                     |
| `shareholder_of`             | `constituent` | Ownership without control at ordinary holdings                           |
| `beneficiary_of`             | `family`      | An interest, not a control                                               |
| `guardian_of`                | `family`      | A legal capacity over a person                                           |
| `point_of_contact_for`       | `constituent` | The owner's "who the point person with an organization is" — see below   |

`affiliation` **stays in the catalog** and stays classed `control`. Existing rows keep working and
keep their traversal weight; nothing already recorded is reinterpreted. It becomes the legacy,
unclassified-membership value and the UI stops offering it.

**A fifth edge class, `constituent`**, joins the budgeted set with a tighter budget than `control`.
The distinction it draws is the one Rule 4.2 comment [9] draws: a constituent who can bind or direct
the organization is a different traversal risk from one who cannot. Today the engine spends the same
budget on both.

**The point person is an edge type, not a flag on an employment edge, and the reason is that the
point person is frequently not an employee.** The owner asked for "who the point person with an
organization is"; the choice between the two shapes turns on the ordinary case, and the ordinary case
is a court's clerk, an assigned adjuster at a third-party administrator, opposing counsel's paralegal,
a registered agent for service, an outside accountant. A flag on an employment edge records none of
them without first asserting an employment that is false — and a false edge is not cosmetic here,
because `directory_edge` is the corpus the conflicts traversal walks and prints. A person who is both
an employee and the contact carries two edges, which is right: an employment and an appointment as
contact start and end at different times. The full reasoning is
[`a-point-of-contact-is-an-edge-because-a-point-of-contact-need-not-be-an-employee`](../decisions/pending/a-point-of-contact-is-an-edge-because-a-point-of-contact-need-not-be-an-employee.md).

**Representation is two different things and the model must not merge them.**

1. **Who the firm represents** is `matter_party` with role `client`, pointing at the _organization_
   when the client is an organization. Rule 1.13's entity theory, already correctly modelled.
2. **Who represents the other side** is matter-scoped and has no home today. Proposed:
   `matter_party.represented_by_entity_id`, a nullable link to the counsel entity on **this** matter.
   Not an edge, because counsel-of-record changes per matter and an entity-level edge would assert it
   everywhere.

### 3.6 No-contact — derived per matter, recorded only where it is not Rule 4.2

**There is no `do_not_contact` boolean on a person, and adding one would state the rule wrongly.**
Rule 4.2 forbids communication "about the subject of the representation … in the matter". A person
represented on matter A may be contacted freely about matter B.

**Layer one, derived and never stored:** where `matter_party.represented_by_entity_id` is non-null,
the platform derives _do not contact directly on this matter_ and surfaces it wherever that party is
addressed — the email composer, document assembly, a phone list. Derived because a stored copy rots
the moment counsel withdraws, and a stale no-contact warning trains people to ignore warnings.

**Layer two, recorded, for restrictions that are not Rule 4.2:** a new
`directory_contact_restriction` table — `entity_id`, `scope` (`all` \| `email` \| `phone` \| `sms` \|
`postal`), `reason`, `recorded_by`, `recorded_at`, `valid_from`, `valid_to`. A client who asked not to
be emailed, a protective order, a person known deceased. Temporal and attributed, because a firm has
to be able to say who recorded it and when.

### 3.7 Names — two additions and one correction

**`directory_name.display_text`** — the name exactly as written, never derived. A mononym, a
family-name-first name and a name with a particle all render wrong today, because a name-history row
carries only parts plus the lowercased FTS content column, and the display is reconstructed by joining
the parts. FHIR's `HumanName.text` exists for precisely this. `normalized_display` and both match keys
are untouched; nothing about search changes.

**`NAME_ROLES` gains `legal` and `preferred`.** "Goes by Bob, legal name Robert" can only be recorded
as `alias` today, which is correct for conflicts and wrong for a salutation merge field. Adding them
does not disturb `DEFAULT_BALANCED_NAME_ROLES`, and `over_inclusive` searches every role by
construction, so the superset guarantee holds.

**The schema comment on `name_role` is corrected** to name the catalog that is actually in use. It
currently documents `legal`/`preferred`/`maiden`/`trading`, which no code has ever written.

**Rejected: a repeating middle-name table.** NIEM allows `[0..*]` and vCard allows a comma list, but
one column holding "Anne Marie" costs nothing anyone has felt, and a table costs a join on every name
read. Documented as a known limitation instead.

### 3.8 The organization — deferred by the owner

**Nothing in this section is built.** The owner's ruling is that an organization stays "a basic group
combining individuals for now": no kind taxonomy, no jurisdiction of formation, no formation or
dissolution lifecycle in this pass.

It is kept here rather than deleted because the finding that prompted it is still true —
`court_entity_id` and `estate_entity_id` still point into `directory_organization` and still cannot
say what they point at, so a picker that must offer the courts has no column to filter on. That cost
is being carried deliberately. What makes the deferral cheap is that every column below is a nullable
`ALTER TABLE ADD COLUMN` against rows that stay valid, so building it later costs what building it now
would; the one thing to avoid meanwhile is encoding a kind of organization into a name or a category
label, because that is the shape that has to be unpicked rather than added to.

| Column                          | Values / notes                                                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization_kind`             | `company` \| `partnership` \| `limited_liability_company` \| `sole_proprietorship` \| `trust` \| `estate` \| `nonprofit` \| `government_body` \| `court` \| `law_firm` \| `insurer` \| `bank` \| `school` \| `association` \| `union` \| `other`. Registered catalog, open CHECK, fitness-enforced. |
| `formation_jurisdiction`        | `US-DE`, `US-NV`, `AU-NSW`. The state of incorporation.                                                                                                                                                                                                                                             |
| `formation_date`                | ISO date, nullable                                                                                                                                                                                                                                                                                  |
| `dissolution_date`              | ISO date, nullable                                                                                                                                                                                                                                                                                  |
| `organization_lifecycle_status` | `active` \| `dissolved` \| `in_administration` \| `struck_off` \| `unknown`. **Deliberately not named `status`** — that column is the merge-graph state (`active` \| `merged_into`) and overloading it would be a live bug.                                                                         |
| `legal_form_text`               | The form as registered — "Pty Ltd", "L.L.P.". `normalized_match_key_bare` strips legal form for matching; storing it keeps the strip recoverable.                                                                                                                                                   |

`court_entity_id` and `estate_entity_id` become filterable the day `organization_kind` exists.

---

## 4. What was considered and rejected

- **One polymorphic `directory_contact_point` table.** Six always-null columns on every phone row,
  and it breaks the index inbound email capture depends on. FHIR keeps Address separate for the same
  reason.
- **A `directory_membership` table.** `directory_edge` already is one. Two corpora for the conflicts
  traversal to walk is a defect, not a feature.
- **A closed `IN (...)` CHECK on the catalog columns.** A committed migration is immutable; every
  catalog addition would become a fleet migration, and a firm mid-upgrade would reject a value the
  code already emits. Open CHECK plus a fitness function is the pattern that already works here.
- **Per-firm catalog tables for identifier schemes and organization kinds.** A scheme correction would
  become a migration against every tenant. `packages/trust-jurisdictions` settled this: reference data
  ships in the package.
- **A property per identifier scheme, schema.org style.** A migration per scheme, forever.
- **`PREF` as a 1–100 ordinal.** `is_primary` answers the real question.
- **vCard's single `TYPE` axis.** It is the free-text `label` problem with better spelling.
- **A `do_not_contact` boolean on the entity.** States Rule 4.2 wrongly, and a stale warning is worse
  than none.
- **Clio's convertible person/company contact.** It would corrupt every `matter_party`, edge and
  identifier pointing at the row.
- **A repeating middle-name table.** A join on every name read for a problem nobody has hit.
- **A `number_e164` column beside the split parts.** The country calling code and the national number
  ARE the canonical number; a third column holding them joined is a derived value to keep in step
  forever, and composing one string at the read costs a line.
- **A canonical postal form in `normalized_key`.** That is a provider's job. A duplicate key whose
  meaning changes when a real canonicalizer arrives silently invalidates every comparison made under
  the old one.
- **A phone-number metadata library.** Full per-region validation is hundreds of kilobytes that go
  stale monthly, for a splitter this platform needs to be reproducible rather than exhaustive. The
  E.164 assignment rule is the whole of what ships.
- **A plaintext `birth_year` beside a retained sealed date of birth.** This document recommended it
  and the owner overruled it: a year cannot fill in the date-of-birth field on a court form, so it
  would have left the original complaint standing and added a second home for one fact.
- **Auto-suppressing a conflicts hit on a jurisdiction mismatch.** See §6 — this one is important
  enough to be a rule rather than a rejection.
- **LEDES as a source for the party model.** It models invoices.

---

## 5. The migration path, in expand-contract order

Every step is additive DDL. Each hand-written migration is followed by a snapshot refresh in the same
commit — `pnpm --filter @magna-carta/database run refresh-per-firm-snapshot`, verified by
`check-snapshots`, which the scoped gate already runs when this package is touched.

**Phase A — reach what exists. BUILT, and it took Phases B, C and F with it.** Domain modules for
phone (`contact-phone.ts`) and address (`contact-address.ts`) mirroring `contact-email.ts`; the email
module lifted from capture-only to a general write path; routes under
`/api/v1/directory/entities/{id}/emails`, `/phones`, `/addresses` with their update and remove twins,
plus one `/contact-points` read that returns all three so a record screen makes one round trip; the
Contact pane. **This alone is the difference between a firm being able to record a telephone number
and not.**

**The plan said Phase A would need no schema change, and that was reversed on purpose.** Each of the
owner's rulings on this same pass — a permission and a preference, a structured number, the
international address field set, a recorded verification failure, a real date of birth — is a column,
and each is a fact the ENTRY SURFACE has to be able to take. Landing the routes first and the columns
second would have meant building the Contact pane twice. So one migration
(`20260830T120000_directory-contact-points.sql`) carries all of it, additively, and the pane was built
once against the shape it keeps.

**Phase B — the typed contact columns. BUILT with Phase A**, as `contact_system`, `contact_use`,
`country_calling_code`, `national_number`, `extension`, `country_region_code` on phone; `contact_use`
on email; the international field set plus `address_use`, `address_type` and `normalized_key` on
address; and `contact_permitted` / `contact_preferred` / `contact_note` on all three. All nullable or
defaulted. The write path populates them from the day they exist; `label` is read-only from the same
day. The indexes are on `(country_calling_code, national_number)` and on `normalized_key`.

**Phase C — provenance. HALF built.** `verification_status`, `verified_at`, `verified_by` and
`verification_detail` landed on the three contact tables with Phase A, because the owner's ruling that
a failure notifies rather than blocks needs somewhere to record the failure. `source` and
`source_detail` are **deferred**: they are the diligence half rather than the send half, and the
surface that would supply a sensible default for them is the intake form rather than the contact pane.
`directory_identifier` gains none of the four yet — sealing a value and confirming it are different
acts, and the identifier surface has no verification gesture to hang them on.

**Phase D — identifier jurisdiction and the scheme registry.** `jurisdiction`, `scheme_key`,
`issuer_entity_id` on `directory_identifier`; the registry module; the fitness probe over stored
`identifier_type` values. **No blind index is recomputed** — §3.2 explains why the frozen transform
sees identical bytes. The new schemes (passport, the national tax-identifier family, the business
registration numbers) become available at the same moment.

**Phase E — organization depth. DEFERRED by the owner** (§3.8). Not built, and not partially built.

**Phase F — person attributes. BUILT with Phase A.** `date_of_birth`, `date_of_death` and `deceased`,
all nullable and all in the clear, written through `setPersonLifeDates` and registered in the PII
registry in the same change. `birth_place` is deferred (nothing reads it) and citizenship is dropped
(the owner's ruling). The `dob` identifier type stays readable forever and is closed to new writes.

**Phase G — the edge catalog and the fifth class. NOT BUILT, and it now carries a settled decision.**
New `EDGE_TYPES` entries and their `edge-classes.ts` classifications land together, because the
coverage test requires it — which is also why `point_of_contact_for` could not ship with the contact
work: `packages/conflicts` was outside that stream's file ownership, and a type with no class beside it
fails its own gate. The new `constituent` class and its budget default come with it. `affiliation` is
untouched.

**Phase H — representation and restriction.** `matter_party.represented_by_entity_id`; the
`directory_contact_restriction` table; the derived no-contact surfacing.

**Phase I — the duplicate indexes.** The partial unique indexes of §3.1, email last and only after
its fitness probe reports zero duplicates.

**Contract, not now.** `directory_phone.label` and `directory_address.label` are dropped only after a
verification window during which the fitness probe reports zero rows carrying a label that the typed
columns do not already express. The `dob` identifier scheme is never dropped — it is closed to new
writes and stays readable, because a firm's existing records must not become unreadable.

---

## 6. Impact on the conflicts checker

The conflicts engine is why most of this data exists, so every change is stated in its terms.

**Nothing here can narrow a search.** The engine's structural guarantee is that raising strictness can
only add candidates, and that `over_inclusive` is a strict superset of `balanced` by construction. No
proposal below filters, suppresses or scores.

**Identifier jurisdiction — no change to matching, better reporting.** The frozen transforms are
untouched and every existing blind index still matches. What changes is that a tier-1 identifier hit
can now name the issuing jurisdiction in the evidence without a decrypt.

**New identifier schemes are new tier-1 channels.** A passport number is high-entropy and gets a
standalone blind index, so a passport match becomes a tier-1 exact-identifier hit — a genuinely new
detection the platform does not have today. The national tax-identifier family and the business
registration numbers do likewise. The low-entropy schemes (bar number, and whatever else the registry
marks) keep the existing, correct refusal.

**Date of birth stops being a decrypt-and-compare.** If O-1 lands on a plaintext column,
`IdentifierNotIndexableError` no longer applies to it and a date equality becomes a cheap corroborating
signal at tier 2 or 3 — an additive channel, never a filter, and never on its own a hit.

**Organization kind and formation jurisdiction disambiguate, they do not suppress.** Two organizations
with the same name in different states are different legal persons. The temptation is to let the
engine drop the hit. **It must not.** The mismatch is recorded as an attribute on the evidence so a
reviewer can dismiss it in a second; the hit still surfaces. Suppression would convert a fast dismissal
into a missed conflict, which is the one failure this engine exists to prevent.

**The edge catalog change makes the traversal budget honest.** `edge-classes.ts` gains its entries and
the existing coverage test enforces completeness. `affiliation` keeps its `control` classification, so
no already-recorded relationship is reinterpreted or downgraded. New membership rows land in the class
they belong to, and the control budget stops being spent on rank-and-file employment hops.

**Contact points become a registered source class, and that is mostly an honesty change.**
`packages/conflicts/src/sources.ts` is built so a dimension with no corpus is _recorded unavailable_
rather than silently omitted — the pattern `prior_firm_history` and `nickname_equivalence` already
follow. Contact points are currently not mentioned at all, so a check log implies nothing about them.
Registering a `contact` source class means the log states whether contact points were searched.

**When they are searched, contact agreement is tier 4 and `over_inclusive` only.** A shared switchboard
number or a shared office address is ordinary — every employee of one company shares both — and firing
a hit on each would flood a reviewer's queue and train them to skim it. A shared _personal_ mobile or a
shared _residential_ address is meaningful, which the `contact_use` column can now distinguish, but the
distinction is not reliable enough to promote the tier. Tier 4, over-inclusive only, additive.

**The `contact` source class must not be added to the mandatory floor** (`settings.ts`). The floor is
the set a per-run selection may not subtract below; adding a noisy dimension to it would make every
check slower and no check safer.

**Representation feeds the report, not the match.** `matter_party.represented_by_entity_id` names
adverse counsel, which is worth printing on a conflicts report and is not itself a conflict.

---

## 7. The owner's rulings — every question of this section is answered

The eight questions this document opened with were put to the owner on 2026-08-30 and answered. They
are kept here, with their answers, because the reasoning behind a settled decision is the part that
stops it being re-litigated. Where an answer contradicted what this document recommended, the
document above was rewritten and the affected ADR fragment amended in the same change.

**O-1 — Date of birth. Answered: the full date, in the clear.** "Obviously date of birth needs a year,
but wtf is wrong with our code that we cannot handle a date of birth." The `birth_year` compromise this
document recommended is **withdrawn**: a year cannot fill in the date-of-birth field on a court form,
so it would have left the complaint standing. §3.3 carries the reasoning and the exposure that comes
with it. **Built.**

**O-2 — Citizenship. Answered: dropped.** Not in the model, not seamed for, no table. A firm that needs
it has `packages/custom-fields`. The proposed `directory_person_citizenship` is withdrawn.

**O-3 — How closed should `organization_kind` be? Answered: not now.** An organization stays "a basic
group combining individuals for now". §3.8 is deferred whole, with the cost of deferring it stated
there rather than lost.

**O-4 — `issuer_entity_id` on an identifier. Not reached.** It belongs to the identifier-scheme phase,
which this pass did not touch. It stays open as designed, and the argument on both sides is unchanged.

**O-5 — `point_of_contact_for` as an edge type, or a flag on the edge? Answered: an edge type,** and
the owner supplied the deciding constraint — the point person must be recordable **without** being an
employee. §3.5 and the ADR fragment carry it. The catalog entry itself is **not yet built**: a new
`EDGE_TYPES` value must be classed in `packages/conflicts/src/edge-classes.ts` in the same change, and
that file was outside the contact stream's ownership.

**O-6 — Should a shared email domain propose an affiliation edge? Not reached.** Untouched by this
pass and still open.

**O-7 — Does a `failed` verification suppress a send? Answered: no, and it never will.** "Failed
address verification doesn't block a send but we notify users." The failure is recorded, it is surfaced
to the member who is about to send, and the send proceeds — a bounce is frequently temporary, and a
platform that refuses on a stale failure teaches its users that its warnings are noise. **Built:**
`verification_status`, `verified_at`, `verified_by` and `verification_detail` are on all three contact
tables, and nothing anywhere reads them as a gate.

**O-8 — How much identifier format validation at entry? Not reached.** It belongs to the
identifier-scheme phase. Still open.

### The owner's ninth direction, which this document did not think to ask

**"Addresses would likely do well paired with a mapping API of some kind for advanced
functionality" — researched, and recommended rather than adopted.** A provider would buy four
separable things (deliverability validation, canonical normalization, geocoding, a map view) worth very
different amounts, at one shared cost: a client's address leaves the firm's tenancy. That is a privacy
decision the owner makes explicitly, not a dependency an agent adds, so **this pass ships the seam and
no provider**. The address model is already the international field set, `normalized_key` is
deliberately a duplicate key rather than a canonical form, and the four verification columns are
exactly where a provider's answer lands — so adopting one later is a writer of existing columns, not a
migration. The options, the measured costs, the golden-rule-14 finding that libpostal is C with no
pure-Rust port, and the recommendation are in
[`an-address-provider-is-a-privacy-decision-so-the-seam-ships-before-the-provider`](../decisions/pending/an-address-provider-is-a-privacy-decision-so-the-seam-ships-before-the-provider.md).

---

## 8. Test plan

- **Fitness probes** (the pattern `packages/directory/src/fitness.ts` already uses): any stored
  `identifier_type` outside the registry; any `organization_kind` outside the catalog; any
  `directory_phone` row whose `number` parses but whose `number_e164` is null; duplicate live contact
  rows per entity, per table; any `directory_name` row with no `display_text` after the write path
  populates it.
- **Coverage tests:** every new `EDGE_TYPES` entry is classed in `edge-classes.ts` (the existing test,
  which will fail on its own if Phase G lands half-done); every registry scheme has a normalize
  transform and an explicit blind-index decision, including an explicit refusal with a reason.
- **Blind-index invariance:** a golden test proving that for a driver's licence supplied as
  `"NV:D1234567"` before the change and as value `"D1234567"` with `jurisdiction = "US-NV"` after it,
  the computed blind index is byte-identical. This is the test that makes Phase D safe.
- **Migration integrity:** the existing `tooling/migration-integrity` chain application, plus
  `test/expand-contract.test.ts`, which will reject any accidental table rebuild.
- **Conflicts regression:** the existing check fixtures must produce an identical candidate set after
  Phases D, E and G, with the new evidence attributes present and no candidate removed.
- **Erasure:** every new column and the two new tables appear in `packages/data-access/src/pii-registry.ts`
  and are exercised by the erasure test.

---

## 9. Documentation

Developer: this spec, the ADRs it carries, and a `packages/directory/CLAUDE.md` covering the scheme
registry and the catalog-plus-fitness pattern. User: [`docs/user/`](../user/) gains the contact-record
and identifier guidance, which does not exist today because the capability does not.
