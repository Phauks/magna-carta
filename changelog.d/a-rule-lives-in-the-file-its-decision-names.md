---
category: Fixed
audience: internal
---

**ADR-0167 has said since June that the Worker-extraction rubric "and the worker template are the
living standard in `docs/conventions/operations.md`," and the rubric was never written there.** A
`grep -i rubric` over that file returned nothing. The cost is not hypothetical: the question of which
subsystems earn their own Worker was re-derived from first principles in a long exchange, by two
people who each looked for the rule where its own decision says it lives and did not find it. The
rubric now lives there, as § 18.

It is written to be decided from — a reader settles "does this subsystem get its own Worker?" without
opening the Decision Log. The five properties are stated as tests rather than labels (property ③ is
"state the contention as a sentence," which is why the discovery and search containers are separate
Workers: extraction saturates CPU for hours during a bulk load while search's premise is staying warm
for sub-second queries). The compute-vs-coordination seam is stated in full, and the fleet is
tabulated as worked examples — the nine container-owning Workers with the properties each cleared, the
four Workers that exist for other reasons and did not come through the rubric at all, and the eleven
coordination Durable Objects that deliberately stayed in the app Worker.

Three things the rubric's own history makes worth writing down. Search reads like a counter-example
and is not one: it failed the statelessness gate as first posed, got a stateful-service design
instead, and reaches its dedicated Worker only because that design moved the index state out of the
container — the rubric was not bent. "One deployable, one origin" (ADR-0069) is reconciled rather
than quietly contradicted: what survives is one public origin, and every extraction since is internal.
And the containment property is what binds, not the literal absence of a route — which is why
`magna-carta-edit` is browser-facing on a cookieless content domain and still satisfies it.

The clause placing coordination Durable Objects in the app Worker carries a short note that it is
under active revision by a decision in flight, since the API surface is being split from background
orchestration. The note names no ADR number and predicts no outcome; it says which sentence moves and
which does not, so the decision that supersedes it replaces one block quote rather than the section.

Nothing in the Decision-Log register was edited — it is assembled on `main`. One inaccuracy in
ADR-0167 is left standing and reported rather than silently corrected in the retelling: it lists "the
pure-Rust PDF engine" among the Container family, and that engine shipped as in-process WASM in the
app and sign Workers, with no container anywhere.
