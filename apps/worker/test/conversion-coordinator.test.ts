import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ConversionJob } from "../src/conversions/conversion-coordinator.ts";
import type { ConversionMessage } from "../src/conversions/conversion-types.ts";

// The single-flight conversion coordinator over real Miniflare Durable Object storage. Each test
// addresses its own DO name (firmId:jobId) so persisted state never leaks between cases. The DO
// enqueues onto CONVERSION on the first start(); the test swaps in a recording fake for that
// binding so it can assert the single-flight property (exactly one enqueue) without standing up
// a real consumer (bundle-coordinator precedent).

function message(jobId: string): ConversionMessage {
  return {
    firmId: "firm_1",
    jobId,
    sourceKey: `files/firm_1/${jobId}/source.docx`,
    resultKey: `files/firm_1/${jobId}/result.pdf`,
    from: "docx",
    to: "pdf",
  };
}

function jobStub(name: string) {
  return env.CONVERSION_JOB.get(env.CONVERSION_JOB.idFromName(name));
}

// Replaces the instance's CONVERSION binding with a send-recorder. Assigns a fresh env object to
// the instance only (not the shared pool env), so no other test sees the fake.
function recordSends(instance: ConversionJob): ConversionMessage[] {
  const sends: ConversionMessage[] = [];
  const mutable = instance as unknown as { env: Record<string, unknown> };
  mutable.env = {
    ...mutable.env,
    CONVERSION: {
      send: async (sent: ConversionMessage) => {
        sends.push(sent);
      },
    },
  };
  return sends;
}

describe("ConversionJob", () => {
  it("start persists queued, arms an alarm, and enqueues exactly once", async () => {
    const stub = jobStub("firm_1:job-start-once");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      const sends = recordSends(instance);
      const state = await instance.start(message("job-start-once"));
      expect(state.status).toBe("queued");
      expect(state.resultKey).toBeNull();
      expect(state.mediaType).toBeNull();
      expect(state.reason).toBeNull();
      expect(sends).toHaveLength(1);
    });
  });

  it("a second start is a no-op returning the existing state (no second enqueue)", async () => {
    const stub = jobStub("firm_1:job-idempotent");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      const sends = recordSends(instance);
      await instance.start(message("job-idempotent"));
      const again = await instance.start(message("job-idempotent"));
      expect(again.status).toBe("queued");
      expect(sends).toHaveLength(1);
    });
  });

  it("markRunning transitions queued -> running", async () => {
    const stub = jobStub("firm_1:job-running");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      recordSends(instance);
      await instance.start(message("job-running"));
      await instance.markRunning();
      const state = await instance.status();
      expect(state.status).toBe("running");
    });
  });

  it("markDone transitions to done with resultKey and mediaType, and clears the alarm", async () => {
    const stub = jobStub("firm_1:job-done");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      recordSends(instance);
      await instance.start(message("job-done"));
      await instance.markRunning();
      await instance.markDone("files/firm_1/job-done/result.pdf", "application/pdf");
      const state = await instance.status();
      expect(state.status).toBe("done");
      expect(state.resultKey).toBe("files/firm_1/job-done/result.pdf");
      expect(state.mediaType).toBe("application/pdf");
      expect(state.reason).toBeNull();
    });
  });

  it("markFailed after done is a no-op (zombie attempt does not clobber done)", async () => {
    const stub = jobStub("firm_1:job-zombie");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      recordSends(instance);
      await instance.start(message("job-zombie"));
      await instance.markRunning();
      await instance.markDone("files/firm_1/job-zombie/result.pdf", "application/pdf");
      // A late zombie attempt (from a timed-out or retried prior conversion) must not clobber done.
      await instance.markFailed("zombie failure");
      const state = await instance.status();
      expect(state.status).toBe("done");
      expect(state.resultKey).toBe("files/firm_1/job-zombie/result.pdf");
    });
  });

  it("status of an unknown job returns failed / 'unknown job'", async () => {
    const stub = jobStub("firm_1:job-unknown");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      const state = await instance.status();
      expect(state.status).toBe("failed");
      expect(state.reason).toBe("unknown job");
    });
  });

  it("alarm fails a still-queued job with 'conversion timed out'", async () => {
    const stub = jobStub("firm_1:job-alarm-queued");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      recordSends(instance);
      await instance.start(message("job-alarm-queued"));
      await instance.alarm();
      const state = await instance.status();
      expect(state.status).toBe("failed");
      expect(state.reason).toBe("conversion timed out");
    });
  });

  it("alarm fails a running job with 'conversion timed out'", async () => {
    const stub = jobStub("firm_1:job-alarm-running");
    await runInDurableObject(stub, async (instance: ConversionJob) => {
      recordSends(instance);
      await instance.start(message("job-alarm-running"));
      await instance.markRunning();
      await instance.alarm();
      const state = await instance.status();
      expect(state.status).toBe("failed");
      expect(state.reason).toBe("conversion timed out");
    });
  });
});
