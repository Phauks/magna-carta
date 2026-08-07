import { describe, expect, it } from "vitest";
import {
  TRANSCRIPT_REACHING_LANES,
  TRANSCRIPT_SCOPES,
  laneCanReachTranscripts,
  validateLoadSourceDeclaration,
  type LoadSourceDeclaration,
} from "../src/load-source.ts";
import { DISCOVERY_LOAD_LANES } from "../src/types.ts";
import { DiscoveryValidationError } from "../src/validation.ts";

function declaration(patch: Partial<LoadSourceDeclaration> = {}): LoadSourceDeclaration {
  return {
    lane: "internal-files",
    transcriptScope: "exclude",
    declaredDocumentCount: 10,
    sourceDescription: null,
    defaultRecordCustodianId: null,
    ...patch,
  };
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (caught) {
    if (caught instanceof DiscoveryValidationError) return caught.code;
    throw caught;
  }
  throw new Error("expected a refusal, got none");
}

describe("the load-source contract", () => {
  it("accepts a well-formed declaration", () => {
    expect(() => validateLoadSourceDeclaration(declaration())).not.toThrow();
  });

  it("refuses an unknown lane by name", () => {
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ lane: "telepathy" as never }))),
    ).toBe("discovery-unknown-load-lane");
  });

  // Declared and refused BY NAME rather than absent, so a firm asking for it learns the platform
  // knows what it is and has not built it — the difference between a gap and a mystery.
  it("refuses the direct-collection lane by name and says what to do instead", () => {
    let message = "";
    try {
      validateLoadSourceDeclaration(declaration({ lane: "direct-collection" }));
    } catch (caught) {
      message = (caught as DiscoveryValidationError).message;
    }
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ lane: "direct-collection" }))),
    ).toBe("discovery-load-lane-not-built");
    expect(message).toContain("received production");
  });
});

describe("the transcript control", () => {
  // The heart of it: there is NO DEFAULT, in either direction. A silent exclusion decides as much
  // for somebody as a silent inclusion would; it just fails the other way, and a firm that believed
  // transcripts were in scope would find out after producing.
  it("has exactly two scopes and neither is a default the platform supplies", () => {
    expect([...TRANSCRIPT_SCOPES]).toEqual(["exclude", "include"]);
    // The declaration type demands the field; this is the runtime half, for a body off the wire.
    expect(
      codeOf(() =>
        validateLoadSourceDeclaration(declaration({ transcriptScope: undefined as never })),
      ),
    ).toBe("discovery-transcript-scope-unstated");
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ transcriptScope: null as never }))),
    ).toBe("discovery-transcript-scope-unstated");
    expect(
      codeOf(() =>
        validateLoadSourceDeclaration(declaration({ transcriptScope: "maybe" as never })),
      ),
    ).toBe("discovery-transcript-scope-unstated");
  });

  it("refuses an include by name rather than dropping it or pretending to honour it", () => {
    let message = "";
    try {
      validateLoadSourceDeclaration(declaration({ transcriptScope: "include" }));
    } catch (caught) {
      message = (caught as DiscoveryValidationError).message;
    }
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ transcriptScope: "include" }))),
    ).toBe("discovery-transcript-lane-not-built");
    // The refusal has to say what to do, because the honest alternatives are both worse: silently
    // dropping the include produces a corpus that does not match the declaration, and pretending to
    // honour it produces a manifest claiming a sweep that never happened.
    expect(message).toContain("excluded");
  });

  it("carries the control on every lane, and names the lanes that could actually reach a transcript", () => {
    // Every lane's declaration carries the scope: a load record that sometimes has it and sometimes
    // does not is a record whose silence means two different things.
    for (const lane of DISCOVERY_LOAD_LANES) {
      if (lane === "direct-collection") continue;
      expect(() =>
        validateLoadSourceDeclaration(declaration({ lane, transcriptScope: "exclude" })),
      ).not.toThrow();
      expect(
        codeOf(() =>
          validateLoadSourceDeclaration(declaration({ lane, transcriptScope: "include" })),
        ),
      ).toBe("discovery-transcript-lane-not-built");
    }
    // A transcript is a record in the firm's own database, so only the internal lanes could sweep
    // one; a received production is the other party's material by construction.
    expect([...TRANSCRIPT_REACHING_LANES]).toEqual(["internal-files", "internal-email"]);
    expect(laneCanReachTranscripts("internal-files")).toBe(true);
    expect(laneCanReachTranscripts("internal-email")).toBe(true);
    expect(laneCanReachTranscripts("received-production")).toBe(false);
    expect(laneCanReachTranscripts("direct-collection")).toBe(false);
  });
});

describe("the declared count", () => {
  it("refuses a fractional or negative count", () => {
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ declaredDocumentCount: -1 }))),
    ).toBe("discovery-invalid-declared-count");
    expect(
      codeOf(() => validateLoadSourceDeclaration(declaration({ declaredDocumentCount: 1.5 }))),
    ).toBe("discovery-invalid-declared-count");
  });

  it("accepts zero — a load declared before anybody knows how much is coming", () => {
    expect(() =>
      validateLoadSourceDeclaration(declaration({ declaredDocumentCount: 0 })),
    ).not.toThrow();
  });
});
