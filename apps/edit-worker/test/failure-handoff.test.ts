import type { TelemetryEvent } from "@magna-carta/telemetry/event";
import { setFailedOperationTap } from "@magna-carta/telemetry/failed-operation-tap";
import { setServiceIdentity } from "@magna-carta/telemetry/service-identity";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { afterEach, describe, expect, it } from "vitest";
import { withEditorDiagnostics } from "../src/diagnostics.ts";
import { handFailuresTo } from "../src/failure-handoff.ts";

const DOCUMENT_LABEL = "286b0ecd5380489120b8c0f96e26476bad69f2897c22af02d7d6";
const ORIGIN = `https://${DOCUMENT_LABEL}.magnacartausercontent.com`;
const TOKEN = "fixture-access-token-0000000000000000000000";

afterEach(() => setFailedOperationTap(null));

function recordingIntake() {
  const handed: { event: TelemetryEvent; service: string }[] = [];
  return {
    handed,
    intake: {
      async record(event: TelemetryEvent, service: string) {
        handed.push({ event, service });
      },
    },
  };
}

describe("handing the editor's failures to the error record", () => {
  it("hands a captured throw over under this worker's code, with the path and never the token", async () => {
    setServiceIdentity("edt");
    const { handed, intake } = recordingIntake();
    const kept: Promise<unknown>[] = [];
    handFailuresTo(intake, (work) => kept.push(work));

    const response = await withEditorDiagnostics(
      new Request(`${ORIGIN}/cool/ws?access_token=${TOKEN}`),
      { logger: createWorkersLogger(undefined, () => {}), now: () => "2026-11-19T19:00:00.000Z" },
      async () => {
        throw new TypeError("container fetch failed");
      },
    );
    await Promise.all(kept);

    expect(response.status).toBe(500);
    expect(handed).toHaveLength(1);
    const { event, service } = handed[0]!;
    expect(service).toBe("edt");
    expect(event.name).toBe("error.captured");
    expect(event.fields.errorId).toBe(response.headers.get("X-MC-Error-Id"));
    expect(event.fields.route).toBe("/cool/ws");
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it("keeps a hand-over that fails from reaching the response, and hands nothing with no binding", async () => {
    const kept: Promise<unknown>[] = [];
    handFailuresTo(
      {
        async record() {
          throw new Error("entrypoint unavailable");
        },
      },
      (work) => kept.push(work),
    );
    const logger = createWorkersLogger(undefined, () => {});
    const failing = () =>
      withEditorDiagnostics(
        new Request(`${ORIGIN}/cool/ws`),
        { logger, now: () => "" },
        async () => {
          throw new Error("boom");
        },
      );
    expect((await failing()).status).toBe(500);
    await expect(Promise.all(kept)).resolves.toBeDefined();

    const { handed, intake } = recordingIntake();
    handFailuresTo(intake, () => {});
    handFailuresTo(undefined, () => {});
    expect((await failing()).status).toBe(500);
    expect(handed).toHaveLength(0);
  });
});
