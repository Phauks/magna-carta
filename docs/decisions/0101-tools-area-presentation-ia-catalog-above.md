---
number: 101
slug: tools-area-presentation-ia-catalog-above
status: Accepted
date: 2026-06-16
area: Tools area
---

**a presentation/IA catalog above the integration framework.** A top-level Tools area surfaces first-party utilities both generally (a sidebar grouped by subject) and contextually (queried by context tag), from one pure `@magna-carta/tools` catalog. **Decision:** the Tools layer is a thin presentation layer _above_ the existing packages, not part of the integration framework — `library`-backed tools (link generators and interactive widgets) are self-contained; `integration`-backed tools reference an integration `category` and reflect its `Dispatch`/health, while the Tools layer itself never touches credentials. Honors the framework's "pure utilities are libraries, not plugins" boundary. **Consequences:** the pure package (types + catalog + selectors + the `tools:` permission namespace) builds independently of the UI; the sidebar/contextual rendering, the id→component map, the integration health branching, and role-seeding land with the design-system shell. Concretizes ADR-0015 on the presentation side; builds on ADR-0091/0092 (integration port system) and ADR-0068 (access control). Spec: [`docs/specs/2026-06-16-tools-area-design.md`](specs/2026-06-16-tools-area-design.md).
