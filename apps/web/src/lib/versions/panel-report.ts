/*
 * THE BUILD INFORMATION PANEL AS ONE PASTE — assembled from the same values the panel renders, so a
 * copy can never disagree with the screen it was taken from.
 *
 * WHY THIS IS ITS OWN FILE AND ITS OWN SHAPE. The panel's copy control used to call a single
 * function inside the deployment model, which meant that model had to know about the database and
 * the readiness check to include them — and it could not import either without a cycle, so the two
 * were passed in as an opaque pre-joined string. The result is what you would expect: the readiness
 * section reached the paste through the database's parameter, the copy said nothing whatever about
 * any read that had FAILED, and the fifth section would have needed a sixth parameter.
 *
 * So the assembly is a LIST OF CONTRIBUTORS over one state object. Each contributor owns one
 * section, decides for itself whether it has anything to say, and returns null when it does not. A
 * new section joins the paste by appending one function to PANEL_REPORT_SECTIONS — the same growth
 * the panel's own sections get from version-panel-section.svelte, and the same contract the command
 * palette keeps with its registries: the thing that adds the feature is what makes it discoverable.
 *
 * EVERY ROW IS `key: value`, because the grammar is not this file's — it is
 * $lib/diagnostics/diagnostic-report.ts, shared with the issue reporter's trace. Before that was
 * lifted out, this paste wrote `Label: commit · committed …` while the trace wrote `key: value`, and
 * a reader who received both got two documents to parse instead of one.
 *
 * A FAILED READ IS A FACT THE PASTE OWES. The whole point of the control is the moment something is
 * broken, and until now `null` state meant the section silently vanished: somebody looking at "The
 * version read failed · Error ID error_…" copied a report with no mention of it at all. Every
 * contributor takes its failure alongside its value and states it.
 *
 * Pure over plain values and free of Svelte, so the node-pool tests exercise each section directly.
 */
import {
  FEATURES_SECTION_LABEL,
  featureName,
  describeSecretSources,
  featureStateLabel,
  missingRequirements,
  sortFeatures,
} from "./features-model.ts";
import {
  CONNECTED_SERVICES_SECTION_LABEL,
  connectedServiceRow,
} from "./connected-services-model.ts";
import type { Problem } from "$lib/api/request.ts";
import {
  entry,
  NONE_ISSUED,
  renderDiagnosticReport,
  section,
  type ReportEntry,
  type ReportSection,
} from "$lib/diagnostics/diagnostic-report.ts";
import type { TraceEnvironment } from "$lib/diagnostics/failure-trace.ts";
import { environmentEntries } from "$lib/diagnostics/failure-trace.ts";
import type { UploadReadinessReport } from "$lib/file-manager/upload-readiness-api.ts";
import {
  databaseHealthRows,
  describeProvisioningBacklog,
  describeSchemaLineage,
  DATABASE_SECTION_LABEL,
  DEPLOYMENT_SECTION_LABEL,
  type DatabaseHealthValue,
  type HealthRow,
} from "./database-health-model.ts";
import { UPLOAD_READINESS_SECTION_LABEL, uploadReadinessRows } from "./upload-readiness-model.ts";
import {
  apiWebSyncState,
  API_WORKER_UNIT_NAME,
  describeProbeLatency,
  findWebWorkerRow,
  FLEET_SECTION_LABEL,
  PAGE_BUILD_ROW_NAME,
  partitionDeploymentRows,
  serviceStateDescription,
  serviceStateLabel,
  syncStateLabel,
  UPDATE_AVAILABLE_EXPLANATION,
  type MetaVersionsValue,
  type ServiceVersionRow,
} from "./version-overlay-model.ts";

/**
 * How a read in this panel failed. One shape for all three reads — they each held their own copy of
 * this union before, and the panel's failure blocks are the same block three times over.
 */
export type PanelReadFailure = { kind: "problem"; problem: Problem } | { kind: "transport" };

/** The Error ID and status of a failed read, as rows — or the transport case, which has neither. */
export function failureEntries(failure: PanelReadFailure): ReportEntry[] {
  if (failure.kind === "transport") {
    return [entry("read", "the API could not be reached")];
  }
  return [
    entry("read", "failed"),
    entry("error id", failure.problem.errorId, NONE_ISSUED),
    entry("status", String(failure.problem.status)),
  ];
}

/** Everything the open panel knows, as the contributors below need it. */
export interface PanelReportState {
  /** The browser's own account of itself, or null on a surface that did not gather it. */
  readonly environment: TraceEnvironment | null;
  /** This bundle's build, which the panel always knows even when every read has failed. */
  readonly pageBuild: {
    readonly commit: string;
    readonly commitTime: string | null;
    readonly buildTime: string | null;
    /** Which build mode produced this bundle — the fact that separates a preview from production. */
    readonly mode: string;
  };
  /** True when the version poll has seen a newer bundle than the one this tab is running. */
  readonly updateAvailable: boolean;
  /** Whether this scope may read the authenticated aggregate at all. */
  readonly readsAggregate: boolean;
  readonly deployment: {
    readonly value: MetaVersionsValue | null;
    readonly failure: PanelReadFailure | null;
  };
  readonly database: {
    readonly value: DatabaseHealthValue | null;
    readonly failure: PanelReadFailure | null;
  };
  readonly readiness: {
    /** Null when this member may not run the check — a permission boundary, not a fault. */
    readonly permitted: boolean;
    readonly report: UploadReadinessReport | null;
    readonly failure: PanelReadFailure | null;
  };
}

/** A part's identity as one value: its commit, what is known of its two timestamps, its latency. */
function partValue(part: {
  commit: string;
  commitTime: string | null;
  buildTime: string | null;
  latencyMilliseconds?: number | null;
}): string {
  const segments = [part.commit];
  if (part.commitTime !== null) segments.push(`committed ${part.commitTime}`);
  if (part.buildTime !== null) segments.push(`built ${part.buildTime}`);
  const latency = describeProbeLatency(part.latencyMilliseconds ?? null);
  if (latency !== null) segments.push(latency);
  return segments.join(" · ");
}

/**
 * One Worker's row. A Worker that did not report has no commit to quote, so it carries the reason
 * and the sentence behind it — "unbound" and "unreachable" are the answer in those cases, not a
 * missing line, and the sentence is what separates three silences that read alike as badges.
 */
function serviceEntry(service: ServiceVersionRow): ReportEntry {
  if (service.commit === null) {
    const label = serviceStateLabel(service.state) ?? "no version reported";
    const because = serviceStateDescription(service.state);
    return entry(service.service, because === null ? label : `${label} — ${because}`);
  }
  return entry(
    service.service,
    partValue({
      commit: service.commit,
      commitTime: service.commitTime,
      buildTime: service.buildTime,
      latencyMilliseconds: service.latencyMilliseconds,
    }),
  );
}

/** A health or readiness row. A row in fault pastes its detail too; a healthy one is its status. */
function healthEntry(row: Pick<HealthRow, "name" | "reading" | "status" | "detail">): ReportEntry {
  return entry(row.name, row.reading === "fault" ? `${row.status} — ${row.detail}` : row.status);
}

/** What produced this page, said before anything that was read over the network. */
function buildSection(state: PanelReportState): ReportSection | null {
  return section(null, [
    entry(PAGE_BUILD_ROW_NAME, partValue(state.pageBuild)),
    entry("environment", state.pageBuild.mode),
    ...(state.environment === null
      ? []
      : [
          entry("route", state.environment.route),
          entry("copied", state.environment.copiedAt.toISOString()),
        ]),
    ...(state.updateAvailable ? [entry("update", UPDATE_AVAILABLE_EXPLANATION)] : []),
  ]);
}

/** The browser, which the panel's paste never carried and the issue reporter's always did. */
function environmentSection(state: PanelReportState): ReportSection | null {
  if (state.environment === null) return null;
  return section(null, environmentEntries(state.environment));
}

/** The API and the Worker that serves this page, plus how the two compare. */
function deploymentSection(state: PanelReportState): ReportSection | null {
  if (!state.readsAggregate) {
    return section(DEPLOYMENT_SECTION_LABEL, [
      entry("read", "not attempted — this panel is signed out"),
    ]);
  }
  const { value, failure } = state.deployment;
  const rows: (ReportEntry | null)[] = [];
  if (failure !== null) rows.push(...failureEntries(failure));
  if (value !== null) {
    rows.push(entry(API_WORKER_UNIT_NAME, partValue(value.api)));
    for (const service of partitionDeploymentRows(value.services).front) {
      rows.push(serviceEntry(service));
    }
    const sync = apiWebSyncState(value.api, findWebWorkerRow(value.services));
    if (sync !== null) rows.push(entry("sync", syncStateLabel(sync)));
    rows.push(entry("observed", value.observedAt));
  }
  return section(DEPLOYMENT_SECTION_LABEL, rows);
}

/**
 * Every feature and its state, broken ones first. A platform operator's paste also says which
 * settings each one that is not set up still needs, because that is the next step, and where the
 * secrets of each one that is set up come from; a member's paste carries no setting names, matching
 * what their screen showed.
 */
function featuresSection(state: PanelReportState): ReportSection | null {
  const features = state.deployment.value?.features ?? [];
  if (features.length === 0) return null;
  const requirements = state.deployment.value?.featureRequirements ?? null;
  return section(
    FEATURES_SECTION_LABEL,
    sortFeatures(features).map((feature) => {
      const own = requirements?.find((candidate) => candidate.id === feature.id);
      const missing =
        requirements === null || feature.state !== "not-set-up" ? [] : missingRequirements(own);
      const sources =
        requirements === null || feature.state === "not-set-up" ? null : describeSecretSources(own);
      const label = featureStateLabel(feature.state);
      if (missing.length > 0) {
        return entry(featureName(feature.id), `${label} — needs ${missing.join(", ")}`);
      }
      return entry(featureName(feature.id), sources === null ? label : `${label} — ${sources}`);
    }),
  );
}

/** The rest of the fleet, every silent one included — an omission here reads as health. */
function workersSection(state: PanelReportState): ReportSection | null {
  const { value } = state.deployment;
  if (value === null) return null;
  const rest = partitionDeploymentRows(value.services).rest;
  if (rest.length === 0) return null;
  return section(FLEET_SECTION_LABEL, rest.map(serviceEntry));
}

/** The outside services the deployment depends on, each with whether it accepts this deployment. */
function connectedServicesSection(state: PanelReportState): ReportSection | null {
  const services = state.deployment.value?.connectedServices ?? [];
  if (services.length === 0) return null;
  return section(
    CONNECTED_SERVICES_SECTION_LABEL,
    services.map((service) => healthEntry(connectedServiceRow(service))),
  );
}

/** Whether this session can reach and use its firm's own data. */
function databaseSection(state: PanelReportState): ReportSection | null {
  if (!state.readsAggregate) return null;
  const { value, failure } = state.database;
  const rows: (ReportEntry | null)[] = [];
  if (failure !== null) rows.push(...failureEntries(failure));
  if (value !== null) {
    rows.push(...databaseHealthRows(value).map(healthEntry));
    // The lineage notes travel with the report, not just the panel. A pasted report is how a
    // diagnosis reaches anyone who can act on it, and an out-of-order arrival or a restore point is
    // exactly the kind of fact that is invisible by the time somebody thinks to ask for it.
    for (const note of describeSchemaLineage(value)) rows.push(entry("lineage", note.sentence));
    const backlog = describeProvisioningBacklog(value);
    if (backlog !== null) rows.push(entry("provisioning", backlog.sentence));
    rows.push(entry("observed", value.observedAt));
  }
  return section(DATABASE_SECTION_LABEL, rows);
}

/**
 * Whether a file chosen in this browser can reach the firm's storage. A member who may not run the
 * check says so rather than leaving the section out: "absent" and "not yours to run" are different
 * facts, and only one of them is about the deployment.
 */
function readinessSection(state: PanelReportState): ReportSection | null {
  if (!state.readsAggregate) return null;
  const { permitted, report, failure } = state.readiness;
  if (!permitted) {
    return section(UPLOAD_READINESS_SECTION_LABEL, [
      entry("check", "not run — this account may not run it"),
    ]);
  }
  const rows: (ReportEntry | null)[] = [];
  if (failure !== null) rows.push(...failureEntries(failure));
  if (report !== null) {
    rows.push(entry("verdict", report.ready ? "ready" : "not ready"));
    rows.push(
      entry(
        "upload path",
        report.uploadPath === "direct-to-storage" ? "direct to storage" : "through the application",
      ),
    );
    rows.push(entry("provisioning adapter", report.provisioner));
    rows.push(entry("bucket", report.bucketName, "none recorded"));
    rows.push(...uploadReadinessRows(report).map(healthEntry));
  }
  return section(UPLOAD_READINESS_SECTION_LABEL, rows);
}

/**
 * The paste, section by section, in the order the panel shows them.
 *
 * APPEND HERE TO GROW THE PASTE. A contributor is a pure function of the panel's state that returns
 * its own section or null; nothing else in this file needs to change, and the copy control never
 * learns a new parameter.
 */
export const PANEL_REPORT_SECTIONS: readonly ((state: PanelReportState) => ReportSection | null)[] =
  [
    buildSection,
    environmentSection,
    deploymentSection,
    featuresSection,
    workersSection,
    connectedServicesSection,
    databaseSection,
    readinessSection,
  ];

/** The heading every paste from this panel opens with. */
export const PANEL_REPORT_HEADING = "Magna Carta — build information";

/** The whole panel on the clipboard, as the reader would read it down the screen. */
export function buildPanelReport(state: PanelReportState): string {
  return renderDiagnosticReport(
    PANEL_REPORT_HEADING,
    PANEL_REPORT_SECTIONS.map((contribute) => contribute(state)),
  );
}
