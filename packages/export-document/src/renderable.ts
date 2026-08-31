/*
 * The renderable tabular document — the wire shape a screen sends when it asks the platform to
 * print its export as a file. One home for the type and its bounds, consumed by the web export
 * seam (which maps its richer client cells down to text faces) and by the worker route that hands
 * it to document assembly's composer; a worker cannot import from an app, so the shape lives here.
 *
 * The bounds are the render endpoint's abuse guard: the server renders whatever it is handed, so
 * what it accepts is bounded by name — a document past a bound is refused, never truncated. They
 * also keep every composed package far under the OOXML chokepoint's size caps.
 */
import { z } from "zod";

export const RENDERABLE_LIMITS = {
  titleLength: 200,
  stampLines: 4,
  stampLineLength: 200,
  sections: 48,
  sectionTitleLength: 200,
  columns: 24,
  rowsPerSection: 2_000,
  cellLength: 1_000,
  totalCells: 20_000,
} as const;

const cell = z.string().max(RENDERABLE_LIMITS.cellLength);

const renderableSection = z
  .object({
    title: z.string().min(1).max(RENDERABLE_LIMITS.sectionTitleLength),
    headers: z.array(cell).min(1).max(RENDERABLE_LIMITS.columns),
    rows: z
      .array(z.array(cell).max(RENDERABLE_LIMITS.columns))
      .max(RENDERABLE_LIMITS.rowsPerSection),
    // Column indexes whose cells read as figures and sit against the right edge, the way the
    // screen's own tables draw them. Optional: an omitted list left-aligns everything.
    endAlignedColumns: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(RENDERABLE_LIMITS.columns - 1),
      )
      .optional(),
  })
  .strict();

export const renderableTabularDocumentSchema = z
  .object({
    title: z.string().min(1).max(RENDERABLE_LIMITS.titleLength),
    // The generation stamp as the client rendered it (date line, time line with its zone) — the
    // server has no standing to restate an instant in a clock that is the reader's own.
    stampLines: z
      .array(z.string().max(RENDERABLE_LIMITS.stampLineLength))
      .max(RENDERABLE_LIMITS.stampLines),
    sections: z.array(renderableSection).min(1).max(RENDERABLE_LIMITS.sections),
  })
  .strict()
  .refine(
    (candidate) =>
      candidate.sections.reduce(
        (sum, section) =>
          sum +
          section.headers.length +
          section.rows.reduce((rowSum, row) => rowSum + row.length, 0),
        0,
      ) <= RENDERABLE_LIMITS.totalCells,
    { message: `the document carries more than ${RENDERABLE_LIMITS.totalCells} cells` },
  );

export type RenderableTabularSection = z.infer<typeof renderableSection>;
export type RenderableTabularDocument = z.infer<typeof renderableTabularDocumentSchema>;
