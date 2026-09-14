<script lang="ts">
  /*
   * NoResults — what a list says when it has nothing to show. Two words, and NO WAY TO SAY MORE.
   *
   * THE ABSENCE OF PROPS IS THE POINT. Every list in the product used to compose its own, and what
   * they composed was a definition: "A packet is the physical thing the firm holds and moves: an
   * envelope, a deed box, a sealed wallet…". That is the explanatory prose the "no info lines"
   * ruling in docs/conventions/design-corrections.md already forbids on every other surface — it
   * teaches a vocabulary lesson to somebody who came to read a list, it goes stale against a product
   * that renames things, and its natural home is docs/user/, which is a shipped feature of its own.
   * A component that accepts no text cannot grow one back, which is worth more here than a rule
   * saying not to.
   *
   * NOR DOES IT NAME THE WAY OUT. An earlier ruling had an empty state name the create control
   * ("New Packet, at the top of the screen, logs the first one"); the owner reversed that on
   * 2026-09-14, because the control is always in the masthead's action row by the product's own
   * visual grammar, and prose naming it is a second copy of a label that is already on screen and
   * free to change without this sentence changing with it.
   *
   * EMPTY AND FILTERED-EMPTY SAY THE SAME THING. "No Results" is true of a record that holds nothing
   * and of a narrowing that excludes everything, which is what lets one wording serve both without
   * either being a lie. Where the reader can widen the narrowing, the way back is a CONTROL beside
   * this, never a sentence — DataTable.Grid's own empty branch is the worked example.
   */
</script>

<div class="mc-empty-state">
  <span class="mc-empty-state-mark" aria-hidden="true">M</span>
  <p class="mc-empty-state-title">No Results</p>
</div>
