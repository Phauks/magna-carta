---
category: Fixed
---

- **The one-logging-path rule is enforced in every Worker, not just the API worker.** The console ban
  named `apps/worker` explicitly, so the extracted workers — the malware scanner, the converter, the
  bundle builder, and every future one — sat outside it: an ad-hoc `console.*` in any of them shipped
  through a green build. The scan now enumerates the app directories rather than listing them, so a
  newly extracted worker is covered the moment it exists, with no test to remember to update. The web
  app stays outside by name, being browser code with its own in-app developer console. Two new checks
  keep the widening honest: one asserts that every app except the web app is enumerated, and one
  asserts the scan actually reaches files inside the extracted workers, so a refactor cannot quietly
  narrow the ban back to nothing.

- **Comments and names that pointed at process paperwork now explain themselves.** Several telemetry
  comments, a test name, and a comment in the document-editor container cited a slice, a plan task, or
  an architecture decision record instead of stating the reasoning or naming a file — the exact drift
  the process-reference gate exists to prevent, in the forms it cannot mechanically detect. Each now
  states why, or points at the module that settles the question.

- **The Directory area guide matches the code again.** It named four functions that do not exist,
  attributed a duplicate-candidate ordering to a line number that had moved, and cited the wrong
  fitness probe; the frozen name-normalization contract named the wrong column for its own output. The
  guide now also says plainly what a merge does _not_ move — the subordinate's own names, identifiers,
  and contact rows stay where they are and resolve through the merge pointer, which is what makes a
  merged-away alias still surface in search and conflicts.
