import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import {
  disclosureAcknowledgedAudit,
  firmOptedInAudit,
  firmOptedOutAudit,
  matterExclusionClearedAudit,
  matterExclusionSetAudit,
  type NaturalLanguageWriteContext,
} from "./natural-language-audit.ts";
import { NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION } from "./natural-language-disclosure.ts";
import {
  naturalLanguageSearchEnabledDefinition,
  readNaturalLanguageSearchEnabled,
} from "./natural-language-settings.ts";
import {
  readDisclosureAcknowledgement,
  readMatterNaturalLanguageExcluded,
  recordDisclosureAcknowledgementStatement,
  setMatterNaturalLanguageExclusionStatement,
} from "./natural-language-statements.ts";
import {
  NATURAL_LANGUAGE_FEED_DELETION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC,
  NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC,
  type NaturalLanguageFeedDeletionPayload,
  type NaturalLanguageInstanceProvisionPayload,
  type NaturalLanguageInstanceTeardownPayload,
} from "./natural-language-topics.ts";

// THE WRITE PATH. This module is the only place the firm gate is flipped and the only place the
// matter exclusion flag is set, and both compose an effect rather than performing one: they return
// statements plus outbox messages for the caller to commit atomically.
//
// Composing rather than committing is what makes the gate honest under failure. The setting change,
// its audit row, and the message that provisions or tears down the instance land in one transaction
// or none of them do — so there is no state in which a firm's gate is open with no provisioning in
// flight, and none in which an instance is being built for a firm whose opt-in rolled back.
//
// THE ACKNOWLEDGEMENT IS THE GATE ON THE GATE. Turning the feature on without a current-version
// acknowledgement is refused here, at the write path, rather than checked at the surface. It is a
// typed refusal and not a throw, because it is an ordinary answer to an ordinary request — a firm
// whose administrator has not accepted the current statement, or accepted an older one, is in a
// state to report rather than an error to log.

// Why a request to turn it on was refused.
//
//   disclosure-not-acknowledged — no acknowledgement recorded at all.
//   disclosure-version-stale    — an acknowledgement exists, of an older statement. The feature has
//                                 gained a capability or changed what it copies since; the firm
//                                 accepted a different arrangement and has to be asked again.
export type NaturalLanguageEnablementRefusalReason =
  | "disclosure-not-acknowledged"
  | "disclosure-version-stale";

export interface NaturalLanguageEnablementRefusal {
  readonly ok: false;
  readonly reason: NaturalLanguageEnablementRefusalReason;
  /** The version the firm did accept, when it accepted one. Lets a surface say what changed. */
  readonly acknowledgedVersion?: number;
  readonly currentVersion: number;
}

export type NaturalLanguageEnablementResult =
  | { readonly ok: true; readonly effect: EffectWrite }
  | NaturalLanguageEnablementRefusal;

// Record the firm's acceptance of the current statement. Separate from turning the feature on, and
// deliberately so: accepting a disclosure and deciding to use a feature are two acts, and collapsing
// them would mean a firm could not read the statement, accept it, and then decide against.
export function acknowledgeDisclosureEffect(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  acknowledgedBy: UserId,
): EffectWrite {
  const now = context.clock.now();
  return {
    statements: [
      recordDisclosureAcknowledgementStatement(database, {
        disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
        acknowledgedBy,
        now,
      }),
      disclosureAcknowledgedAudit(database, context, {
        disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
      }),
    ],
    outboxMessages: [],
  };
}

// Turn the feature on. Refused unless the firm has accepted the CURRENT statement.
//
// The provisioning message rides the same batch, so the instance is created because the gate opened
// and not merely around the same time. Provisioning is queue-dispatched and never inline: it is a
// service round trip, which is exactly the work a request handler must not wait on.
export async function enableNaturalLanguageSearchEffect(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
): Promise<NaturalLanguageEnablementResult> {
  const acknowledgement = await readDisclosureAcknowledgement(database);
  if (acknowledgement === undefined) {
    return {
      ok: false,
      reason: "disclosure-not-acknowledged",
      currentVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
    };
  }
  if (acknowledgement.disclosureVersion !== NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION) {
    return {
      ok: false,
      reason: "disclosure-version-stale",
      acknowledgedVersion: acknowledgement.disclosureVersion,
      currentVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
    };
  }

  const now = context.clock.now();
  const payload: NaturalLanguageInstanceProvisionPayload = {
    disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
  };
  return {
    ok: true,
    effect: {
      statements: [
        writeFirmSettingStatement(database, naturalLanguageSearchEnabledDefinition, true, now),
        firmOptedInAudit(database, context, {
          settingKey: naturalLanguageSearchEnabledDefinition.key,
          disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
        }),
      ],
      outboxMessages: [{ topic: NATURAL_LANGUAGE_INSTANCE_PROVISION_TOPIC, payload }],
    },
  };
}

// Turn it off. Never refused — a firm withdrawing consent does not need permission, and a gate that
// could get stuck open because some precondition failed is the wrong shape for this.
//
// The teardown message does three things in order, and the ORDER is the honest part: it stops the
// feed writer (which the setting above has already done, atomically, in this same batch), deletes
// every feed object from the firm's own storage and marks each catalog row removed, and only then
// asks the service to delete the instance. The first two the platform performs against storage it
// owns and can therefore demonstrate; the third is a request whose completeness it cannot.
export function disableNaturalLanguageSearchEffect(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
): EffectWrite {
  const now = context.clock.now();
  const payload: NaturalLanguageInstanceTeardownPayload = {
    disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
  };
  return {
    statements: [
      writeFirmSettingStatement(database, naturalLanguageSearchEnabledDefinition, false, now),
      firmOptedOutAudit(database, context, {
        settingKey: naturalLanguageSearchEnabledDefinition.key,
        disclosureVersion: NATURAL_LANGUAGE_SEARCH_DISCLOSURE_VERSION,
      }),
    ],
    outboxMessages: [{ topic: NATURAL_LANGUAGE_INSTANCE_TEARDOWN_TOPIC, payload }],
  };
}

// Exclude one matter, or put it back.
//
// SETTING THE FLAG ENQUEUES DELETION OF THE MATTER'S FEED OBJECTS, not merely a stop on new writes.
// An opt-out that only stopped new writes would leave the material that prompted it sitting in the
// index — which is the opposite of what somebody setting this flag is asking for. Clearing the flag
// enqueues nothing: the matter's documents re-enter the feed as they are next committed, and the
// daily re-extraction pass draws in what was already there.
export function setMatterExclusionEffect(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  matterId: MatterId,
  excluded: boolean,
): EffectWrite {
  const now = context.clock.now();
  const deletion: NaturalLanguageFeedDeletionPayload = { scope: "matter", matterId };
  return {
    statements: [
      setMatterNaturalLanguageExclusionStatement(database, matterId, excluded, now),
      excluded
        ? matterExclusionSetAudit(database, context, { matterId })
        : matterExclusionClearedAudit(database, context, { matterId }),
    ],
    outboxMessages: excluded
      ? [{ topic: NATURAL_LANGUAGE_FEED_DELETION_TOPIC, payload: deletion }]
      : [],
  };
}

// ── The read the feed writer uses ───────────────────────────────────────────

// Whether this matter's documents may be fed, right now. BOTH gates, read together at enqueue time,
// so a firm that has not opted in never produces a feed object as a side effect of the platform
// being ready, and an excluded matter stops producing them the moment the flag is set.
//
// Total in both directions: an unreadable setting is a shut gate, and a matter that cannot be found
// is an excluded one.
//
// IT TAKES NO INJECTED READER, deliberately. A gate whose reader is a parameter is a gate a test can
// satisfy with something production never passes, and this is the one function standing between a
// firm that has not opted in and its privileged text being copied into a managed store. It calls the
// real reads, so a test of it is a test of the thing that runs.
export async function mayFeedMatter(database: SqlDatabase, matterId: MatterId): Promise<boolean> {
  if (!(await readNaturalLanguageSearchEnabled(database))) return false;
  return !(await readMatterNaturalLanguageExcluded(database, matterId));
}
