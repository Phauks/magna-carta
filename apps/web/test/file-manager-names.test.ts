import { describe, expect, it } from "vitest";
import {
  collidingSibling,
  committedRename,
  disambiguated,
  displayName,
  renameFieldValue,
  renameSelectionEnd,
  splitName,
} from "../src/lib/file-manager/file-names.ts";

/*
 * The naming rules, which have been raised more than once and are easy to undo by accident.
 *
 * The extension governs DISPLAY and SELECTION, never editability: a reader who deliberately retypes
 * an extension must get the extension they typed, and a reader who never saw one must not have one
 * silently changed. A deliberate rename that would collide is REFUSED, naming the sibling; a name
 * nobody typed (a creation, a paste, an upload) is disambiguated instead.
 */

describe("splitName", () => {
  it("splits at the final dot", () => {
    expect(splitName("Motion to Compel.pdf")).toEqual({
      stem: "Motion to Compel",
      extension: ".pdf",
    });
  });

  it("treats a leading dot as part of the name, not as an extension", () => {
    expect(splitName(".gitignore")).toEqual({ stem: ".gitignore", extension: "" });
  });

  it("splits a double extension at the LAST dot, which is the one that decides the type", () => {
    expect(splitName("invoice.pdf.exe")).toEqual({ stem: "invoice.pdf", extension: ".exe" });
  });
});

describe("what the rename field holds and selects", () => {
  it("shows no extension at all while extensions are hidden", () => {
    expect(renameFieldValue("Motion.pdf", true)).toBe("Motion");
    // Nothing to protect: the whole field is the name.
    expect(renameSelectionEnd("Motion", true)).toBe(6);
  });

  it("selects the stem only while extensions are shown", () => {
    expect(renameFieldValue("Motion.pdf", false)).toBe("Motion.pdf");
    expect(renameSelectionEnd("Motion.pdf", false)).toBe(6);
  });
});

describe("committedRename", () => {
  it("reattaches the stored extension when the reader never saw one", () => {
    expect(committedRename("Answer", ".pdf", true)).toBe("Answer.pdf");
  });

  it("lets a deliberately retyped extension stand", () => {
    // Correcting a misleading extension is the whole reason extensions are editable at all: this
    // must not re-append ".exe" over what was typed.
    expect(committedRename("invoice.pdf", ".exe", false)).toBe("invoice.pdf");
  });

  it("does not turn an emptied field into a bare extension", () => {
    expect(committedRename("   ", ".pdf", true)).toBe("");
  });
});

describe("collision handling", () => {
  const siblings = [
    { key: "a", name: "Answer.pdf" },
    { key: "b", name: "Motion.pdf" },
  ];

  it("compares case-insensitively", () => {
    expect(collidingSibling("answer.PDF", siblings)).toBe("Answer.pdf");
  });

  it("does not report a row colliding with itself", () => {
    expect(collidingSibling("Answer.pdf", siblings, "a")).toBeNull();
  });

  it("disambiguates a name nobody typed, keeping the extension last", () => {
    expect(disambiguated("Answer.pdf", siblings)).toBe("Answer (2).pdf");
    expect(disambiguated("Answer.pdf", [...siblings, { key: "c", name: "Answer (2).pdf" }])).toBe(
      "Answer (3).pdf",
    );
  });

  it("leaves a name that does not collide exactly as it was", () => {
    expect(disambiguated("Exhibit A.pdf", siblings)).toBe("Exhibit A.pdf");
  });
});

describe("displayName", () => {
  it("drops the extension only when the reader asked for that", () => {
    expect(displayName("Motion.pdf", true)).toBe("Motion");
    expect(displayName("Motion.pdf", false)).toBe("Motion.pdf");
  });
});
