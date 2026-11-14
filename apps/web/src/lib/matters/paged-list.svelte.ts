/*
 * The state one cursor-paged section list needs, owned in one place.
 *
 * Three matter sections read a paged listing and all three want the same six facts: the rows so
 * far, whether the first read has landed, whether it failed and how to say so, whether the record
 * continues, whether a further page is in flight, and which matter the rows belong to. Written per
 * section that is three copies to keep in step, and the copies had already drifted once -- the
 * stale-matter fix had to be made three times because the same effect was written three times.
 *
 * `reset` is keyed on the SUBJECT, not called unconditionally: a second read of the same matter
 * (after a sever, say) is that matter's list being read again, and blanking it would flash a
 * skeleton over a table the reader is still looking at.
 */
import type { ApiOutcome, Failure, Page } from "$lib/api/request.ts";
import { LatestOnly } from "../api/latest-only.ts";
import { guidanceFor, type ProblemGuidance } from "$lib/diagnostics/guidance.ts";

/** Fetches one page. `cursor` is absent for the first. */
export type PageReader<T> = (cursor?: string) => Promise<ApiOutcome<Page<T>>>;

export class PagedList<T> {
  /** Null until the first read lands — the loading state, distinct from an empty record. */
  items = $state<readonly T[] | null>(null);
  /** Non-null while the record continues past what is on screen. */
  nextCursor = $state<string | null>(null);
  /**
   * THE WHOLE FAILURE, NOT A SENTENCE SQUEEZED OUT OF IT. This field used to be a `string`, and
   * because it was, every one of the nine surfaces built on this class was structurally incapable of
   * showing an Error ID, a status, or a remedy — however their own templates were written. Holding
   * the record is the entire fix; `failureMessage` is still here for a surface that only wants the
   * sentence.
   */
  failure = $state<Failure | null>(null);
  /** True only while a FURTHER page is in flight; the first read is `items === null`. */
  loadingMore = $state(false);

  /** What to say when the read fails and the server offered no words of its own. */
  readonly #whenUnreadable: string;
  /** Which subject the rows on screen belong to, so a reload is told from a change of subject. */
  #subject: string | null = null;
  /** A page that resolves after a reset is discarded rather than written over the new subject. */
  readonly #latest = new LatestOnly();

  constructor(whenUnreadable: string) {
    this.#whenUnreadable = whenUnreadable;
  }

  /**
   * The sentence for the current failure, with this list's own words as the fallback.
   *
   * Order of preference: the server's own `detail`, which is written for the caller and knows things
   * no client-side table can; then the area's own sentence, which is the per-channel copy the
   * standing ruling in docs/conventions/design-corrections.md asks for; then the shared presenter's
   * default, which exists so nothing ever renders blank.
   */
  get failureMessage(): string | null {
    const failure = this.failure;
    if (failure === null) return null;
    if (failure.problem === null) return `Couldn't connect. ${this.#whenUnreadable}`;
    return failure.problem.detail ?? this.#whenUnreadable;
  }

  /**
   * The tone, heading and remedy for the current failure — everything a failure surface needs beyond
   * the sentence. The message is replaced by `failureMessage` so the area's own words win over the
   * shared default.
   */
  get failureGuidance(): ProblemGuidance | null {
    const failure = this.failure;
    if (failure === null) return null;
    return { ...guidanceFor(failure), message: this.failureMessage ?? "" };
  }

  /** The correlation handle for the current failure, where the server issued one. */
  get failureErrorId(): string | null {
    return this.failure?.problem?.errorId ?? null;
  }

  /** True when this list is already showing (or loading) the given subject. */
  showing(subject: string): boolean {
    return this.#subject === subject;
  }

  /** Discard everything and adopt a new subject. Call only when the subject actually changed. */
  reset(subject: string): void {
    this.#subject = subject;
    this.#latest.supersede();
    this.items = null;
    this.nextCursor = null;
    this.failure = null;
    this.loadingMore = false;
  }

  /** Adopt a complete, empty record without reading anything — the sample-matter case. */
  settleEmpty(): void {
    this.items = [];
    this.nextCursor = null;
    this.failure = null;
  }

  /** Read the first page. Rows replace whatever was there. */
  async load(read: PageReader<T>): Promise<void> {
    const attempt = this.#latest.attempt();
    const result = await read();
    if (!attempt.current) return;
    this.#absorb(result, []);
  }

  /**
   * Read the next page and append it. A no-op when the record has no more or a page is already in
   * flight, so a double click cannot fetch the same page twice or skip one.
   */
  async loadMore(read: PageReader<T>): Promise<void> {
    const cursor = this.nextCursor;
    if (cursor === null || this.loadingMore) return;
    this.loadingMore = true;
    const attempt = this.#latest.attempt();
    const result = await read(cursor);
    if (!attempt.current) return;
    this.loadingMore = false;
    this.#absorb(result, [...(this.items ?? [])]);
  }

  #absorb(result: ApiOutcome<Page<T>>, existing: T[]): void {
    if (result.kind === "ok") {
      this.items = [...existing, ...result.value.data];
      this.nextCursor = result.value.nextCursor;
      this.failure = null;
      return;
    }
    // A failed FURTHER page keeps the rows already on screen: they were read successfully and are
    // still true. Only the first page has nothing to keep.
    this.items = existing;
    this.failure = result.failure;
  }
}
