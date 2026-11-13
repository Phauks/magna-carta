/*
 * What a recovery job's status means to the person watching it, kept apart from the polling loop
 * so the wording is testable without a running timer or a DOM.
 */
import type { RecoveryStatus, RecoveryTier } from "./decryption-api.ts";

export interface RecoveryStatusPresentation {
  readonly heading: string;
  readonly description: string;
  /** Whether the search is still doing something, i.e. whether polling should continue. */
  readonly active: boolean;
}

export function presentRecoveryStatus(
  status: RecoveryStatus,
  tier: RecoveryTier,
): RecoveryStatusPresentation {
  switch (status) {
    case "queued":
      return {
        heading: "Queued",
        description: "The search is about to start.",
        active: true,
      };
    case "running":
      return {
        heading: "Searching",
        description:
          tier === "cfCapable"
            ? "Trying likely passwords and common variations across several containers at once."
            : "Trying likely passwords and common variations.",
        active: true,
      };
    case "found":
      return {
        heading: "Found",
        description: "The password is shown below. Copy it now. It's only shown once.",
        active: false,
      };
    case "exhausted":
      return {
        heading: "Not Found",
        description:
          "The search tried its full list without success. This file's password is not a common " +
          "or predictable one.",
        active: false,
      };
    case "needsGpu":
      return {
        heading: "Needs More Powerful Hardware",
        description:
          "This file uses strong encryption that ordinary computers can't break quickly. Recovering it needs specialized hardware, coming in a later version. Nothing is wrong with the file.",
        active: false,
      };
    case "cancelled":
      return {
        heading: "Cancelled",
        description: "The search was stopped before it finished.",
        active: false,
      };
  }
}

/** One candidate count, in the reader's words. */
export function formatCandidateCount(candidatesTried: number): string {
  return `${candidatesTried.toLocaleString()} ${candidatesTried === 1 ? "password" : "passwords"} tried`;
}
