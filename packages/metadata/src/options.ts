export interface ScrubOptions {
  readonly identifyingMetadata: boolean;
  readonly trackedChanges: boolean; // accept: keep final text, drop the revision record
  readonly comments: boolean; // delete comments and their parts
  readonly hiddenContent: boolean; // remove hidden (vanish) runs
  readonly customProperties: boolean;
  readonly imageMetadata: boolean; // strip all EXIF/IPTC/XMP/comment segments
}

// The one-click "make safe to send" default: everything on.
export const SCRUB_ALL: ScrubOptions = {
  identifyingMetadata: true,
  trackedChanges: true,
  comments: true,
  hiddenContent: true,
  customProperties: true,
  imageMetadata: true,
};
