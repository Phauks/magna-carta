---
branch: claude/vpn-assessment
worktree: C:/dev/magna-carta-worktrees/claude/vpn-assessment
area: Research-only — owner question "how could we implement VPN services for our users?"
status: designing
touches: docs/research/, docs/decisions/pending/, changelog.d/, docs/active-work/claude/
---

# claude/vpn-assessment

**Scope:** Research and assessment only, owner-directed: what "VPN services for our users" could
mean for a multi-tenant legal practice-management platform on Cloudflare, which of the three
candidate products is coherent here, what Cloudflare One / Zero Trust actually offers and costs, and
— the part that decides it — what confidentiality posture the platform would acquire if it could see
a law firm's whole-internet traffic metadata. Findings return to the owner before anything is built.

## Files touched

- `docs/research/2026-08-11-vpn-and-network-access.md` (new — the deliverable)
- `docs/decisions/pending/no-platform-operated-vpn.md` (new)
- `docs/decisions/pending/network-access-controls-firm-supplied.md` (new)
- `changelog.d/vpn-and-network-access-assessment.md` (new)
- this note

No source code, no schema, no spec edits, no white-paper edits. `CHANGELOG.md`, `STATUS.md` and the
Decision-Log register are untouched by design. No overlap with any open stream.
