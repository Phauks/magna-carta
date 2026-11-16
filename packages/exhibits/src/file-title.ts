/*
 * The title an exhibit starts with when it is made from a file. Pure, so the screen that adds files
 * by hand and the server that follows a folder name an exhibit alike.
 */
import { MAX_TITLE_LENGTH } from "./types.ts";

/** A file's name without its extension, which is what a member would have typed as the title. */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).trim();
  return (stem.length === 0 ? name.trim() : stem).slice(0, MAX_TITLE_LENGTH);
}
