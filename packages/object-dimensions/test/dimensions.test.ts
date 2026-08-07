import type { MatterId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  FIRM_SCOPED_OBJECT_CLASSES,
  MATTER_DIMENSION,
  MATTER_SCOPED_OBJECT_CLASSES,
  MAXIMUM_DIMENSION_VALUE_LENGTH,
  OBJECT_CLASS_DIMENSION,
  ObjectDimensionError,
  RESERVED_DIMENSIONS,
  RESERVED_OBJECT_CLASSES,
  firmScopedObjectDimensions,
  matterOfObject,
  matterScopedObjectDimensions,
  objectClassOf,
  objectDimensionHeaders,
  objectDimensionsFromHeaders,
  objectIsStamped,
} from "../src/dimensions.ts";

const MATTER = "matter_01hzz0000000000000000000" as MatterId;

describe("the matter-scoped stamp", () => {
  it("carries the matter and the class", () => {
    expect(
      matterScopedObjectDimensions({ objectClass: "working-document", matterId: MATTER }),
    ).toEqual({ [MATTER_DIMENSION]: MATTER, [OBJECT_CLASS_DIMENSION]: "working-document" });
  });

  it("refuses an empty matter rather than stamping a blank scope", () => {
    expect(() =>
      matterScopedObjectDimensions({ objectClass: "working-document", matterId: "" as MatterId }),
    ).toThrow(ObjectDimensionError);
  });

  it("refuses a value that cannot travel as a request header", () => {
    expect(() =>
      matterScopedObjectDimensions({
        objectClass: "working-document",
        matterId: "matter_one\nmatter_two" as MatterId,
      }),
    ).toThrow(ObjectDimensionError);
  });

  it("refuses a value over the length limit", () => {
    expect(() =>
      matterScopedObjectDimensions({
        objectClass: "working-document",
        matterId: "m".repeat(MAXIMUM_DIMENSION_VALUE_LENGTH + 1) as MatterId,
      }),
    ).toThrow(ObjectDimensionError);
  });
});

describe("the firm-scoped stamp", () => {
  it("carries the class and deliberately no matter", () => {
    const dimensions = firmScopedObjectDimensions("download-bundle");
    expect(dimensions).toEqual({ [OBJECT_CLASS_DIMENSION]: "download-bundle" });
    expect(matterOfObject(dimensions)).toBeNull();
  });

  it("is still a stamped object — a class with no matter is a recorded fact", () => {
    expect(objectIsStamped(firmScopedObjectDimensions("email-original"))).toBe(true);
  });
});

describe("reading a stamp back", () => {
  it("reports an unstamped object as unstamped and unscoped", () => {
    expect(objectIsStamped(undefined)).toBe(false);
    expect(objectIsStamped({})).toBe(false);
    expect(matterOfObject(undefined)).toBeNull();
    expect(objectClassOf({})).toBeNull();
  });

  it("round-trips through the S3 header form", () => {
    const dimensions = matterScopedObjectDimensions({
      objectClass: "working-copy",
      matterId: MATTER,
    });
    const headers = objectDimensionHeaders(dimensions);
    expect(headers).toEqual({
      "x-amz-meta-matter": MATTER,
      "x-amz-meta-object_class": "working-copy",
    });
    expect(objectDimensionsFromHeaders(new Headers(headers))).toEqual(dimensions);
  });

  it("ignores headers that are not object metadata", () => {
    expect(
      objectDimensionsFromHeaders(
        new Headers({ "content-type": "application/pdf", "x-amz-meta-matter": MATTER }),
      ),
    ).toEqual({ [MATTER_DIMENSION]: MATTER });
  });
});

describe("the vocabulary is closed and its reservations hold", () => {
  it("never lets a reserved class into either writable set", () => {
    for (const reserved of RESERVED_OBJECT_CLASSES) {
      expect(MATTER_SCOPED_OBJECT_CLASSES as readonly string[]).not.toContain(reserved);
      expect(FIRM_SCOPED_OBJECT_CLASSES as readonly string[]).not.toContain(reserved);
    }
  });

  it("never lets a reserved dimension name collide with a written one", () => {
    expect(RESERVED_DIMENSIONS).not.toContain(MATTER_DIMENSION);
    expect(RESERVED_DIMENSIONS).not.toContain(OBJECT_CLASS_DIMENSION);
  });

  it("keeps every class token stampable", () => {
    for (const objectClass of MATTER_SCOPED_OBJECT_CLASSES) {
      expect(
        matterScopedObjectDimensions({ objectClass, matterId: MATTER })[OBJECT_CLASS_DIMENSION],
      ).toBe(objectClass);
    }
    for (const objectClass of FIRM_SCOPED_OBJECT_CLASSES) {
      expect(firmScopedObjectDimensions(objectClass)[OBJECT_CLASS_DIMENSION]).toBe(objectClass);
    }
  });
});
