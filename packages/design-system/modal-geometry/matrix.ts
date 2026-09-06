/*
 * What the sweep measures: the screens, and the panels. Both are data, so growing the sweep is a
 * row here and nothing in the spec.
 *
 * VIEWPORTS are CSS-pixel sizes as a browser reports them, not panel resolutions: a 1366 x 768
 * laptop shows the application in roughly 1366 x 657 once the browser's own bars and the taskbar
 * have taken their share, and that row is the one closest to what the owner sees day to day. The
 * two monitor rows are there to show the width caps doing their work and the gutter still holding.
 *
 * SPECIMENS are the stories in src/stories/modal-geometry.stories.svelte: every modal shell,
 * already open when the story renders, one per way a panel can meet the screen — a panel that
 * fits, a panel that cannot (the record window, the long form), the widest panel (a form with a
 * context pane opens at the record width), and the one placement that is allowed to touch the
 * edges (expanded). They open on render and run no play function, so measuring one is loading it.
 * A new shell, width or placement is a story there and a row here.
 */
export interface SweepViewport {
  /** A stable name for the row, used in output paths and test titles. */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Which real screen this stands for. */
  readonly stands_for: string;
}

export const VIEWPORTS: readonly SweepViewport[] = [
  {
    name: "laptop-1280x720",
    width: 1280,
    height: 720,
    stands_for: "a 13-inch Windows laptop at 150% scaling",
  },
  {
    name: "laptop-1366x768",
    width: 1366,
    height: 768,
    stands_for: "the most common laptop panel, full screen",
  },
  {
    name: "laptop-1366x657",
    width: 1366,
    height: 657,
    stands_for: "that laptop once the browser's bars and the taskbar have taken their share",
  },
  {
    name: "macbook-1440x900",
    width: 1440,
    height: 900,
    stands_for: "a 13-inch MacBook Air at its default scaling",
  },
  {
    name: "laptop-1536x864",
    width: 1536,
    height: 864,
    stands_for: "a 15-inch 1080p laptop at 125% scaling",
  },
  { name: "monitor-1920x1080", width: 1920, height: 1080, stands_for: "a 1080p desktop monitor" },
  {
    name: "monitor-2560x1440",
    width: 2560,
    height: 1440,
    stands_for: "a 27-inch monitor, or a 4K one at 150%",
  },
];

export interface SweepSpecimen {
  /** A stable name for the row, used in output paths and test titles. */
  readonly name: string;
  /** The catalog story id, as it appears in the Storybook URL. */
  readonly storyId: string;
  /** The story opens its panel expanded, so the panel is expected to fill the screen. */
  readonly expanded?: boolean;
}

/** The catalog title of the specimen stories, as Storybook writes it into a story id. */
export const SPECIMEN_STORY_PREFIX = "overlay-modalgeometry--";

export const SPECIMENS: readonly SweepSpecimen[] = [
  { name: "dialog", storyId: `${SPECIMEN_STORY_PREFIX}dialog` },
  { name: "alert-dialog", storyId: `${SPECIMEN_STORY_PREFIX}alert-dialog` },
  { name: "action-dialog-form", storyId: `${SPECIMEN_STORY_PREFIX}action-dialog-form` },
  {
    name: "action-dialog-with-context",
    storyId: `${SPECIMEN_STORY_PREFIX}action-dialog-with-context`,
  },
  { name: "action-dialog-too-long", storyId: `${SPECIMEN_STORY_PREFIX}action-dialog-too-long` },
  {
    name: "action-dialog-expanded",
    storyId: `${SPECIMEN_STORY_PREFIX}action-dialog-expanded`,
    expanded: true,
  },
  { name: "record-window", storyId: `${SPECIMEN_STORY_PREFIX}record-window` },
  { name: "record-window-too-long", storyId: `${SPECIMEN_STORY_PREFIX}record-window-too-long` },
];
