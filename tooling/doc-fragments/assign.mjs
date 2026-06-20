// Numbers are assigned once, at merge, and never reused or renumbered (see the Decision-Log
// Standard in docs/Decision-Log.md). Contiguity is why allocation happens here, on main,
// rather than at authoring time on a branch.
export function assignNumbers(existingNumbers, pendingSlugs) {
  let next = (existingNumbers.length === 0 ? 0 : Math.max(...existingNumbers)) + 1;
  return pendingSlugs.map((slug) => ({ slug, number: next++ }));
}
