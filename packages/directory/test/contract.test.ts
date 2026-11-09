import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { z } from "zod";
import * as contract from "../src/contract.ts";

// The contract module is the directory's one home for what its API accepts and returns. Two things
// have to hold for that to be true rather than asserted: every shape it exports is a named component
// (an unnamed one would inline into the document wherever it is used, and the name is the only thing
// that makes a shape one fact across the routes that share it), and no two shapes claim one name (the
// emitter overwrites silently on a duplicate). The parse cases below pin the rules the shapes carry
// that a service depends on, so a change that would let a malformed body through fails here, without
// booting the worker.

const shapes = Object.entries(contract as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

const pronounSet = {
  subject: "they",
  object: "them",
  possessiveDeterminer: "their",
  possessivePronoun: "theirs",
  reflexive: "themself",
  verbNumber: "plural",
};

describe("the directory contract", () => {
  it("exports named components only, each name unique", () => {
    const names = new Map<string, string>();
    for (const [exportName, shape] of shapes) {
      const id = shape.meta()?.id;
      expect({ exportName, id }).toEqual({ exportName, id: expect.any(String) });
      expect({ exportName, first: names.get(id ?? "") }).toEqual({ exportName, first: undefined });
      names.set(id ?? "", exportName);
    }
    expect(shapes.length).toBeGreaterThan(50);
  });

  it("takes a pronoun set whole or not at all", () => {
    expect(contract.SetPronounsRequest.safeParse({ pronouns: pronounSet }).success).toBe(true);
    expect(contract.SetPronounsRequest.safeParse({ pronouns: null }).success).toBe(true);
    const { reflexive: _omitted, ...partial } = pronounSet;
    expect(contract.SetPronounsRequest.safeParse({ pronouns: partial }).success).toBe(false);
  });

  it("names an entity by a person or organization handle, and refuses anything else", () => {
    const edge = {
      from: newIdentifier("directoryPerson"),
      to: newIdentifier("directoryOrganization"),
      edgeType: "affiliation",
    };
    expect(contract.CreateEdgeRequest.safeParse(edge).success).toBe(true);
    const toMatter = { ...edge, to: newIdentifier("matter") };
    expect(contract.CreateEdgeRequest.safeParse(toMatter).success).toBe(false);
  });

  it("takes a life date as a civil date, never a formatted one", () => {
    const civil = { dateOfBirth: "1961-04-12" };
    const formatted = { dateOfBirth: "April 12, 1961" };
    expect(contract.SetPersonLifeDatesRequest.safeParse(civil).success).toBe(true);
    expect(contract.SetPersonLifeDatesRequest.safeParse(formatted).success).toBe(false);
  });
});
