import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/file.ts";
import { canConvertLocally } from "../src/placement.ts";
import { availableConversions, findPath } from "../src/pathfinding.ts";
import { EDGES, getFormat } from "../src/registry.ts";

// The video edges into an MP4 every browser plays, run by the pure-Rust transcode engine.
describe("playable-mp4 edges", () => {
  it("registers playable-mp4 as an MP4-media-type format distinct from mp4", () => {
    const format = getFormat("playable-mp4");
    expect(format?.mediaType).toBe("video/mp4");
    expect(getFormat("mp4")?.id).not.toBe(format?.id);
  });

  it("offers a playable copy of every container the engine reads", () => {
    for (const from of ["mp4", "mov", "mkv"]) {
      const path = findPath(from, "playable-mp4");
      expect(path.ok, from).toBe(true);
      if (path.ok) {
        expect(path.path).toHaveLength(1);
        expect(path.path[0]?.engineId).toBe("transcode");
        expect(path.path[0]?.recipeRef).toBe("mp4-h264-aac-faststart");
      }
    }
  });

  it("offers nothing from WebM, whose codecs the engine cannot decode", () => {
    expect(availableConversions("webm")).toEqual([]);
  });

  it("runs on the server only", () => {
    expect(canConvertLocally("mov", "playable-mp4")).toBe(false);
  });

  it("routes every video edge through the transcode engine and nothing else", () => {
    const videoEdges = EDGES.filter((edge) => ["mp4", "mov", "mkv", "webm"].includes(edge.from));
    expect(videoEdges.every((edge) => edge.engineId === "transcode")).toBe(true);
  });

  it("detects an .mp4 as mp4, not playable-mp4, despite the shared media type and extension", () => {
    // Detection is first-match over FORMATS; a source detected as playable-mp4 would have no edges.
    expect(detectFormat({ name: "call.mp4", type: "video/mp4" })).toBe("mp4");
    expect(detectFormat({ name: "call.mp4" })).toBe("mp4");
  });
});
