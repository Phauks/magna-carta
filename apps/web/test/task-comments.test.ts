import { describe, expect, it } from "vitest";
import {
  commentSegments,
  namesStillWritten,
  toldSentence,
  withNameAdded,
} from "$lib/matters/task-comments.ts";

// The words of a task comment and the colleagues it names: a name deleted from the words is no
// longer sent as named, the thread bolds only names the comment holds, and the line under the box
// says who will be told.

const dana = { userId: "user_dana", displayName: "Dana Okafor" };
const danaReyes = { userId: "user_danaReyes", displayName: "Dana Okafor-Reyes" };

describe("task comment words", () => {
  it("sends as named only the people whose name is still in the words", () => {
    expect(namesStillWritten("@Dana Okafor please check", [dana, danaReyes])).toEqual([
      "user_dana",
    ]);
    expect(namesStillWritten("never mind", [dana])).toEqual([]);
  });

  it("bolds the longest name that matches, and nothing the comment does not name", () => {
    expect(commentSegments("Ask @Dana Okafor-Reyes, not @Marcus", [dana, danaReyes])).toEqual([
      { text: "Ask ", named: false },
      { text: "@Dana Okafor-Reyes", named: true },
      { text: ", not @Marcus", named: false },
    ]);
  });

  it("adds a name in place of the @ just typed", () => {
    expect(withNameAdded("Thanks @", dana)).toBe("Thanks @Dana Okafor ");
    expect(withNameAdded("Thanks", dana)).toBe("Thanks @Dana Okafor ");
    expect(withNameAdded("", dana)).toBe("@Dana Okafor ");
  });

  it("says who is told", () => {
    expect(toldSentence(["Rosalind Chase", "Litigation Team", "Dana Okafor (watching)"])).toBe(
      "Rosalind Chase, Litigation Team and Dana Okafor (watching) are told, and anyone you name.",
    );
    expect(toldSentence([])).toBe(
      "Nobody else is on this task, so only the people you name are told.",
    );
  });
});
