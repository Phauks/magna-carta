// THE COMPLETENESS DECLARATION — what a report says about how much of the firm it covered.
//
// Every reporting response carries one. Today it always says `complete`, because nothing in this
// repository screens a matter out of a read: the content-screening layer (an ethical wall) is a
// deferred seam and no report can honor a mechanism that does not exist.
//
// The declaration exists NOW because of what it costs to add later. When walls arrive, a firm-wide
// financial total will be one of two things, and both are bad in different ways:
//
//   - complete but undrillable — the total includes a screened matter's money and the member cannot
//     open it. The total ties to the books, and the residual (total minus the sum of what IS
//     itemized) is the screened matter's balance, recovered by subtraction.
//   - screened — the total omits screened matters. Nothing leaks, and the member is looking at a
//     firm-wide figure that does not agree with the reconciliation, the receivable control account,
//     or another member's copy of the same report.
//
// Which one a firm gets is an owner's decision about what the platform ASSERTS about its books, not
// a shape this layer may settle. What this layer must guarantee either way is that a consumer can
// never render a screened total as an unscreened one by omission — so the declaration is on the
// response from the first report, and a renderer that reads it today keeps working when the answer
// arrives. Widening it later is then a new variant of this union, never a response-shape change.
export type ReportCompleteness =
  | {
      // Every matter in scope was read. The only shape this platform produces today.
      readonly scope: "complete";
    }
  | {
      // Some matters in scope were not itemized, and their money IS in the totals. The count is
      // stated so a reader knows the drill-down is short of the total; the residual is recoverable
      // by subtraction, which is the price of a total that ties to the books.
      readonly scope: "complete-not-itemized";
      readonly notItemizedMatterCount: number;
    }
  | {
      // Some matters in scope were excluded outright: their money is NOT in the totals, so no figure
      // here ties to the firm's books. Named as such rather than left to a footnote, because a
      // firm-wide figure that quietly does not tie is worse than one that is refused.
      readonly scope: "screened";
      readonly excludedMatterCount: number;
    };

// The declaration every read in this package returns today. A function rather than a constant so a
// caller cannot hold a reference and mutate a shared object, and so the moment screening exists this
// is the one place that decides what a given read may claim.
export function completeScope(): ReportCompleteness {
  return { scope: "complete" };
}

// Whether every figure in a response covers the whole firm. A renderer asks this rather than
// pattern-matching the union, so a variant added later reaches every consumer at once.
export function tiesToTheFirmsBooks(completeness: ReportCompleteness): boolean {
  return completeness.scope !== "screened";
}
