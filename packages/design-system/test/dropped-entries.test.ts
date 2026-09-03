import { describe, expect, it } from "vitest";
import {
  entriesFromDataTransfer,
  entriesFromFileList,
  folderPathOf,
  type EntryLike,
} from "../src/lib/components/dropzone/dropped-entries.ts";

/*
 * The walk behind a folder drop, pinned on fakes of the entry API: a dropped folder must deliver
 * the files inside it, each under the path it sat at, and never the zero-byte stub the browser
 * reports in `dataTransfer.files`. The batching quirk is pinned too — `readEntries` answers a
 * directory in batches and an empty batch is the end, so a walk that stops after one call loses
 * everything past the first hundred entries.
 */

function fileEntry(name: string): EntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve) => resolve(new File(["x"], name)),
  };
}

function folderEntry(name: string, children: EntryLike[], batchSize = 100): EntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (resolve) => {
          const batch = children.slice(at, at + batchSize);
          at += batch.length;
          resolve(batch);
        },
      };
    },
  };
}

function transferOf(entries: EntryLike[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

describe("entriesFromDataTransfer", () => {
  it("walks a dropped folder and paths each file under it", async () => {
    const transfer = transferOf([
      fileEntry("cover.pdf"),
      folderEntry("Discovery", [
        fileEntry("index.txt"),
        folderEntry("2024", [fileEntry("letter.pdf")]),
      ]),
    ]);
    const entries = await entriesFromDataTransfer(transfer);
    expect(entries.map((entry) => [entry.file.name, entry.relativePath])).toEqual([
      ["cover.pdf", ""],
      ["index.txt", "Discovery/index.txt"],
      ["letter.pdf", "Discovery/2024/letter.pdf"],
    ]);
  });

  it("reads a directory to the end, not just its first batch", async () => {
    const many = Array.from({ length: 250 }, (_, at) => fileEntry(`file-${String(at)}.txt`));
    const entries = await entriesFromDataTransfer(transferOf([folderEntry("Big", many, 100)]));
    expect(entries).toHaveLength(250);
    expect(entries.at(-1)?.relativePath).toBe("Big/file-249.txt");
  });

  it("falls back to the flat file list where the entry API is absent", async () => {
    const transfer = {
      items: [],
      files: [new File(["x"], "plain.pdf")],
    } as unknown as DataTransfer;
    const entries = await entriesFromDataTransfer(transfer);
    expect(entries).toEqual([{ file: transfer.files[0], relativePath: "" }]);
  });
});

describe("entriesFromFileList and folderPathOf", () => {
  it("keeps a picked folder's relative paths and reads the folder part back out", () => {
    const picked = new File(["x"], "notes.docx");
    Object.defineProperty(picked, "webkitRelativePath", { value: "Client/Notes/notes.docx" });
    const alone = new File(["x"], "alone.pdf");
    const entries = entriesFromFileList([picked, alone]);
    expect(entries.map((entry) => entry.relativePath)).toEqual(["Client/Notes/notes.docx", ""]);
    expect(folderPathOf(entries[0] as { relativePath: string })).toBe("Client/Notes");
    expect(folderPathOf(entries[1] as { relativePath: string })).toBe("");
  });
});
