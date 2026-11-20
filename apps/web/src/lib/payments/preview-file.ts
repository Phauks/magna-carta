/** A file the page can show: a kept file at its address, or a chosen one at its object URL. */
export interface PreviewFile {
  readonly key: string;
  readonly name: string;
  readonly url: string;
  readonly contentType: string;
}
