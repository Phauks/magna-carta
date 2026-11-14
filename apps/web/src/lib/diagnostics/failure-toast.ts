/*
 * A failed call, as a toast: the surface's own sentence as the heading, the one-line summary (area,
 * action, kind of failure) beneath it, and Copy details — so a failure that only ever reaches a
 * toast is as identifiable as one that reaches a band. The owner's ruling (2026-11-14) is one shape
 * for every failure, at whatever size the surface has room for.
 */
import { toast } from "@magna-carta/design-system/toast";
import { copyText } from "@magna-carta/design-system/failure-details";
import { page } from "$app/state";
import type { Failure } from "$lib/api/problem.ts";
import { currentTrace } from "./current-trace.ts";
import { failureSummary } from "./failure-summary.ts";

/** The toast's second line: the summary's parts, joined. Exported for the tests. */
export function failureToastDescription(failure: Failure): string {
  return failureSummary(failure).join(" · ");
}

/** Show a failed call as a toast with Copy details. `title` is the surface's own sentence. */
export function failureToast(failure: Failure, title: string): void {
  toast.error(title, {
    description: failureToastDescription(failure),
    duration: 10000,
    action: {
      label: "Copy details",
      onClick: () => {
        void copyText(currentTrace(failure, page.url.pathname)).then((result) => {
          if (result === "copied") toast.success("Details copied");
          else toast.error("Your browser would not copy. Open Report a problem instead.");
        });
      },
    },
  });
}
