import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import type { InvoiceId } from "@magna-carta/identifiers/types";
import { z } from "zod";
import { aggregateMinor } from "./line-amounts.ts";
import type { InvoiceLineKind, InvoiceRenderShape, InvoiceStatus } from "./types.ts";

// THE RENDER SHAPE is a fact on the invoice model, not a rendering engine. A bill spanning several
// matters is presented either as one flowing document or as one page per matter plus a summary; the
// firm chooses its default here, a finalize may override it per bill, and the answer is snapshot
// onto the invoice at finalization. This module owns the setting and the DERIVATION — the grouping a
// renderer consumes — and draws nothing. The PDF tail is separate work against this same model.

// The firm default. Per-matter pages plus a summary is the shipped default: a client billed across
// several matters is told what each matter cost before being told the total.
export const multiMatterRenderShapeDefinition: FirmSettingDefinition<InvoiceRenderShape> = {
  key: "billing.multiMatterRenderShape",
  schema: z.enum(["combined", "per_matter_pages"]),
  defaultValue: "per_matter_pages",
};

export interface InvoiceRenderLine {
  readonly id: string;
  readonly lineIndex: number;
  readonly matterId: string;
  readonly kind: InvoiceLineKind;
  readonly description: string;
  readonly quantityE4: number | null;
  readonly rateE4: number | null;
  readonly amountMinor: number;
}

// One page of the rendered bill. Under `per_matter_pages` there is one page per matter, each naming
// its matter and carrying that matter's lines and subtotal; under `combined` there is exactly one
// page, its matterId null, carrying every line in presentation order.
export interface InvoiceRenderPage {
  readonly matterId: string | null;
  readonly matterTitle: string | null;
  readonly lines: readonly InvoiceRenderLine[];
  readonly subtotalMinor: number;
}

// The summary a multi-matter bill closes with: each matter's total and the grand total. Null when
// there is nothing to summarize — a combined rendering, or a bill on a single matter.
export interface InvoiceRenderSummary {
  readonly matters: readonly { readonly matterId: string; readonly totalMinor: number }[];
  readonly totalMinor: number;
}

export interface InvoiceRenderModel {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly invoiceNumber: string | null;
  readonly currency: string;
  readonly renderShape: InvoiceRenderShape;
  readonly pages: readonly InvoiceRenderPage[];
  readonly summary: InvoiceRenderSummary | null;
  readonly totalMinor: number;
}

interface RenderInvoiceRow {
  id: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  currency: string;
  render_shape: InvoiceRenderShape | null;
}

interface RenderLineRow {
  id: string;
  line_index: number;
  matter_id: string;
  kind: InvoiceLineKind;
  description: string;
  quantity_e4: number | null;
  rate_e4: number | null;
  amount_minor: number;
  matter_title: string | null;
}

// The derivation: the stored shape (a draft, or an invoice finalized before the shape existed,
// reads as `combined`) applied to the lines grouped by matter. Pages appear in the order the
// matters first appear in the lines — presentation order is the line order the bill review left,
// so the page order is the reviewer's, not an id sort's.
export async function readInvoiceRenderModel(
  database: SqlDatabase,
  invoiceId: InvoiceId,
): Promise<InvoiceRenderModel | undefined> {
  const { results } = await database
    .prepare(`SELECT id, status, invoice_number, currency, render_shape FROM invoice WHERE id = ?1`)
    .bind(invoiceId)
    .all<RenderInvoiceRow>();
  const invoice = results[0];
  if (!invoice) return undefined;

  const lines = await database
    .prepare(
      `SELECT l.id, l.line_index, l.matter_id, l.kind, l.description, l.quantity_e4, l.rate_e4, l.amount_minor,
              m.title AS matter_title
         FROM invoice_line l
         LEFT JOIN matter m ON m.id = l.matter_id
        WHERE l.invoice_id = ?1 ORDER BY l.line_index`,
    )
    .bind(invoiceId)
    .all<RenderLineRow>();

  const renderShape: InvoiceRenderShape = invoice.render_shape ?? "combined";
  const renderLines = lines.results.map((row) => ({
    id: row.id,
    lineIndex: row.line_index,
    matterId: row.matter_id,
    kind: row.kind,
    description: row.description,
    quantityE4: row.quantity_e4,
    rateE4: row.rate_e4,
    amountMinor: row.amount_minor,
  }));
  const totalMinor = aggregateMinor(
    renderLines.map((line) => line.amountMinor),
    invoice.currency,
  );

  const titleByMatter = new Map<string, string | null>();
  for (const row of lines.results) {
    if (!titleByMatter.has(row.matter_id)) titleByMatter.set(row.matter_id, row.matter_title);
  }
  const matterIdsInLineOrder = [...titleByMatter.keys()];

  // A single-matter bill collapses under either shape: one page, no summary. The shape stays what
  // was stored — what the firm CHOSE is part of the record even where it changes nothing.
  if (renderShape === "combined" || matterIdsInLineOrder.length <= 1) {
    const onlyMatterId = matterIdsInLineOrder.length === 1 ? matterIdsInLineOrder[0] : null;
    return {
      invoiceId: invoice.id,
      status: invoice.status,
      invoiceNumber: invoice.invoice_number,
      currency: invoice.currency,
      renderShape,
      pages: [
        {
          matterId: onlyMatterId ?? null,
          matterTitle: onlyMatterId ? (titleByMatter.get(onlyMatterId) ?? null) : null,
          lines: renderLines,
          subtotalMinor: totalMinor,
        },
      ],
      summary: null,
      totalMinor,
    };
  }

  const pages: InvoiceRenderPage[] = matterIdsInLineOrder.map((matterId) => {
    const matterLines = renderLines.filter((line) => line.matterId === matterId);
    return {
      matterId,
      matterTitle: titleByMatter.get(matterId) ?? null,
      lines: matterLines,
      subtotalMinor: aggregateMinor(
        matterLines.map((line) => line.amountMinor),
        invoice.currency,
      ),
    };
  });
  return {
    invoiceId: invoice.id,
    status: invoice.status,
    invoiceNumber: invoice.invoice_number,
    currency: invoice.currency,
    renderShape,
    pages,
    summary: {
      matters: pages.map((page) => ({
        matterId: page.matterId as string,
        totalMinor: page.subtotalMinor,
      })),
      totalMinor,
    },
    totalMinor,
  };
}
