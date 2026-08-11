# claude/sign-in-transposition — the sign-in mockup, transposed into the product

**Stream:** UI. Takes the owner-reviewed sign-in mockup (24 rounds, `full-flow-v27`) out of a
standalone HTML artifact and into real Svelte over the design system, and stands up the developer
page that replaces the artifact as the review surface.

**Scope landed in this branch — the review surface plus the first coherent group.** The artifact
covers far more than one reviewable change, so this branch takes the sign-in path proper and
reports the rest rather than sprawling.

- **Developer screen-state page** at `/developer-console/sign-in-screens`: every signed-out screen
  in every state on one scrollable surface, each specimen labelled with whether the product can
  reach it today. Registered in the developer console's Fixtures list.
- **Sign In merged to one screen** — email and password together. The identify step could only ever
  show the same neutral form on its second screen without becoming an enumeration oracle, so it
  bought a round trip and nothing else.
- **Two-factor code entry** made channel-aware, and **recovery-code entry** built for real over the
  two-factor plugin's backup codes (it was a placeholder card).
- **The quiet back affordance above the heading**, on every screen that has somewhere to go.
- **Design system:** `ChoiceRow` and `ProgressSteps` are new; `VerificationCodeInput` gained a
  `charset` axis so an eight-character code this platform sent is not rejected by a numeric field.

**Files touched:**

- `packages/design-system/src/lib/components/{choice-row,progress-steps}/**` (new),
  `components/verification-code-input/verification-code-input.svelte`, `package.json` exports,
  `src/lib/styles/components.css`, `src/stories/{choice-row,progress-steps,verification-code-input}.stories.svelte`
- `apps/web/src/lib/auth/**` — the screens (`screens/`), the shared panel, the attempt ladder, the
  channel shapes, the passkey ceremony script, and the unbuilt-capability register
- `apps/web/src/routes/login/+page.svelte`, `sign-in-messages.ts`;
  `apps/web/src/routes/login/recovery-code/` removed (the step now lives on the one sign-in URL)
- `apps/web/src/routes/developer-console/sign-in-screens/**` (new),
  `apps/web/src/lib/developer/dev-fixtures.ts`
- `apps/web/test/{attempt-ladder,code-channels,passkey-ceremony}.test.ts` (new)

**No backend work.** `apps/worker/**` is untouched by design — the auth routes are a separate slice
and they touch the chokepoint. Where a designed screen has no route behind it, the control is absent
from the live sign-in surface and present-but-labelled on the developer page;
`apps/web/src/lib/auth/unbuilt-capabilities.ts` is the single register of which and why.

**Not transposed, and why.** Registration and its three-way role fork, invitation redemption
(code plus last name plus date of birth), the two-factor enrolment hub and its authenticator, phone
and recovery-code screens, recovery-code issuance and export, the enrolment QR, and reset-password
as one progressively-disclosed screen. Every one needs a server route that does not exist, and
together they are larger than one reviewable change. The developer page names them out loud in a
closing section so the boundary is visible to a reviewer rather than only in this note.

**Coordination:** overlaps `slice-0-7b-app-shell` on `apps/web/src/routes/login/**` and
`apps/web/src/lib/auth/**`, and any design-system stream on `components.css` + `package.json`
exports (both append-only here).
