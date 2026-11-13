/*
 * The Time Sheet's state: the rows a person is typing into, the timer accruing beside them, the
 * saves going out behind them, and the stack that puts any of it back.
 *
 * A ROW IS EDITED IN PLACE AND SAVED BEHIND THE READER. Nothing on this surface is submitted: a
 * change to a cell commits when the cell is left, the row's mark says it is saving, and the mark
 * settles when the server answers. Nobody waits, and nobody presses Save.
 *
 * WHAT THE PRODUCT CANNOT DO YET IS SAID, NOT HIDDEN. The design has a row saving the instant it
 * exists, before it holds anything; the capture route refuses an entry without a description and a
 * duration, so a fresh row lives on the sheet marked as not yet written, and the mark names exactly
 * what it is waiting for. It is a real row throughout: it holds what is typed into it, the timer
 * can run on it, and it writes itself the moment it has enough to be accepted.
 *
 * THE SHEET IS THE FIRM'S, NOT ONE MATTER'S. It is opened from the top bar over whatever a person
 * was doing, so the matter is a per-row fact rather than a property of the surface, and a row may
 * hold none at all: capture must never wait on a person deciding where the time belongs. A matter
 * IS still needed before the row can reach the record, because the capture route takes one, so a
 * matterless row lives on the sheet under a provisional code with its mark saying exactly that.
 * Opening the sheet from a matter changes only two things: the rows it shows, and what a new row's
 * matter starts as. It is one surface with two doors, never two surfaces.
 *
 * A MISFILED ENTRY MOVES; IT IS NOT RE-TYPED. Time gets recorded against the wrong matter, and the
 * remedy is a refile that keeps the entry's number, its memo, its codes, its files and its history
 * — not a void and a fresh row, which loses all five and leaves a voided entry on a matter it was
 * never really on. Moving it re-reads the rate and the rounding against the destination, because
 * both resolve through the matter, so the row's money follows the row. What a move cannot do is
 * take a written entry OFF a matter: the record has to be somewhere.
 *
 * THE TIMER IS THE FIRM'S, NOT THE PAGE'S. One timer per timekeeper, held on the server, so
 * starting one on a second row stops the first and a reload does not lose it. Where it lands
 * differs by the row it was started from: a row that is already an entry takes the elapsed time on
 * to its own duration, and a row that is not becomes the entry the timer commits.
 *
 * UNDO IS A PAIR OF WRITES, NOT A PICTURE OF THE SHEET. Each step holds the field it changed, as it
 * was and as it became, and walks it back through the same update route the cell used. That is why
 * an undo touches ONE row: a snapshot of the whole sheet cannot say which field moved, so putting
 * one back meant writing every row on the sheet — over rows the step never touched, and over
 * whatever somebody had changed in another window meanwhile.
 *
 * AND NOTHING IS ANNOUNCED UNTIL THE WRITE HAS ANSWERED. A step that says the record went back
 * before the record agrees has told the reader something untrue about their own entry.
 *
 * SO ONLY WHAT CAN ACTUALLY BE PUT BACK IS OFFERED AS A STEP. Voiding an entry is not one of them —
 * it is a status change on its own route, not a field the stack can rewrite — so a void pushes no
 * step and says at the moment it happens that undo does not reach it. An inverse whose row has
 * since left draft REFUSES rather than writing: the record moved under the step, and putting a
 * value back on an entry somebody voided in between would be a second act wearing the first one's
 * name.
 *
 * WHAT IT SAYS INSTEAD IS WHERE THE REPAIR IS. A void is no longer permanent: the entry can be put
 * back to draft with everything it carries, from the ledger's own menu or from the record window.
 * That is a different gesture from undo, in a different place, and the announcement names it —
 * "undo does not reach this" is only half an answer if the other half exists.
 */
import { untrack } from "svelte";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import { HistoryStack } from "@magna-carta/design-system/history-stack";
import {
  isWorkable,
  minutesFromSeconds,
  newSheetRow,
  provisionalTimeCode,
  sheetRowFromEntry,
  type SheetRow,
} from "./time-sheet-model.ts";
import {
  createTimeEntry,
  discardTimer,
  pauseTimer,
  patchTimeEntry,
  readTimer,
  refileTimeEntry,
  resumeTimer,
  startTimer,
  stopTimerAndCommit,
  voidTimeEntry,
  writeKey,
} from "./time-operations.ts";

/** How long a cell change waits before it goes out, so a run of keystrokes is one write. */
const SAVE_SETTLE_MILLISECONDS = 600;

/** What the sheet needs to know about where it is mounted. */
export interface SheetContext {
  /**
   * The matter the sheet was opened from, or null when it was opened firm-wide from the top bar.
   *
   * It narrows nothing on its own: it is what a new row's matter starts as, and what the surface
   * above filters the rows by. A firm-wide sheet passes null and every row carries its own matter.
   */
  readonly matterFilter: () => string | null;
  /** The entries the listing answered with. The sheet re-seeds from these whenever they change. */
  readonly entries: () => readonly TimeEntrySummary[];
  readonly members: () => readonly FirmMemberSummary[];
  readonly sessionUserId: () => string | null;
  /** The day the reader is having, as an ISO calendar date. */
  readonly today: () => string;
  /** Something was written; the matter's time wants re-reading. */
  readonly onChanged: () => void;
  /** Say something to the reader. The surface renders it; this store decides when. */
  readonly announce: (message: string) => void;
}

export class TimeSheetStore {
  readonly #context: SheetContext;

  rows = $state<readonly SheetRow[]>([]);

  /** Which row the firm's timer is accruing into, by row key. */
  timerRowKey = $state<string | null>(null);
  /** Seconds banked by segments of the current run that have already been paused. */
  #bankedSeconds = $state(0);
  /** When the current segment started, as milliseconds, or null while nothing is running. */
  #segmentStartedAt = $state<number | null>(null);
  /** Re-read every second so a running clock re-renders without anything else changing. */
  tick = $state(0);
  timerFailure = $state<string | null>(null);

  readonly history = new HistoryStack();

  #newRowCount = 0;
  /** How many provisional codes this sheet has minted, so each row gets its own. */
  #provisionalCount = 0;
  /**
   * The matter the RUNNING timer is bound to on the server, as it was bound at start.
   *
   * It is not the same fact as the row's matter: a row's matter can be set after the run began, and
   * the server's timer stays bound to whatever it was started with. Only a run whose binding still
   * matches the row it is on can be committed into an entry, so the two are held apart.
   */
  #timerMatterId: string | null = null;
  readonly #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Entries voided since this sheet opened.
   *
   * A step recorded before a void names a row that is now on the record as void, and an inverse
   * that wrote to it would be a second act wearing the first one's name. This is what an inverse
   * checks before it writes: the void is the newer fact, and it wins.
   */
  readonly #voidedIdentifiers = new Set<string>();

  constructor(context: SheetContext) {
    this.#context = context;
  }

  /**
   * Adopt what the listing answered with.
   *
   * Rows the reader has created and the server has not accepted yet survive the re-seed: they hold
   * typing, and a listing that arrived a moment later must not take it away.
   */
  adoptEntries(entries: readonly TimeEntrySummary[]): void {
    /*
     * The rows already on screen are read WITHOUT being tracked. This runs from an effect that
     * watches the listing, and reading the rows it is about to replace would make that effect
     * depend on its own output: it would re-run for ever, and it did until it was measured in a
     * browser. What the effect actually depends on is the listing, which is what it reads outside.
     */
    const unwritten = untrack(() => this.rows.filter((row) => row.entryIdentifier === null));
    this.rows = [...entries.map(sheetRowFromEntry), ...unwritten];
  }

  // ---- rows ---------------------------------------------------------------------------------

  rowByKey(key: string): SheetRow | undefined {
    return this.rows.find((row) => row.key === key);
  }

  /** Replace one row's fields, leaving every other row's identity untouched. */
  #patchRow(key: string, changes: Partial<SheetRow>): void {
    this.rows = this.rows.map((row) => (row.key === key ? { ...row, ...changes } : row));
  }

  /**
   * A new row, on the sheet immediately and on its way to the server as soon as it can be.
   *
   * The work date defaults to today when today is in view and to the end of the range otherwise,
   * so a row created while reading last week belongs to last week rather than appearing and
   * vanishing.
   *
   * No undo step is pushed. A row that has not been written is taken away by its own remove
   * control, and a row that HAS been written is an entry on the firm's record: dropping it off the
   * sheet would leave the entry standing while the screen said it had gone back.
   */
  addRow(workDate: string): SheetRow {
    this.#newRowCount += 1;
    this.#provisionalCount += 1;
    const sessionUserId = this.#context.sessionUserId();
    const members = this.#context.members();
    const me = members.find((member) => member.userId === sessionUserId);
    const row = newSheetRow({
      key: `unwritten-${String(this.#newRowCount)}`,
      workDate,
      // A sheet opened from a matter starts its rows there; one opened from the top bar starts them
      // nowhere, which is the whole point of a capture surface that never asks first.
      matterId: this.#context.matterFilter(),
      provisionalCode: provisionalTimeCode(this.#provisionalCount),
      timekeeperUserId: sessionUserId ?? "",
      timekeeperName: me?.displayName ?? "",
      enteredAt: this.#context.today(),
      currency: this.rows[0]?.currency ?? "USD",
    });
    this.rows = [...this.rows, row];
    return row;
  }

  /**
   * File a row on a matter, or take it off one.
   *
   * Only a row that is not yet an entry can be filed here. There is no route that moves an entry
   * from one matter to another, so a written row is refused rather than being changed on screen and
   * left where it was on the record; the refusal is said out loud at the moment it is attempted.
   *
   * A row filed on a matter writes itself the instant it has the rest of what capture needs, which
   * is why this ends in a save rather than only in a changed cell.
   */
  setMatter(key: string, matterId: string | null): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.matterId === matterId) return;
    if (row.entryIdentifier !== null) {
      // An entry the firm holds MOVES rather than being re-typed: it keeps its number, its memo,
      // its codes, its attachments and its whole history. Taking it OFF a matter is the one thing
      // a move cannot do — the record has to be somewhere — so that is refused rather than sent.
      if (matterId === null) {
        this.#context.announce(
          "An entry on the firm's record has to be on a matter. Move it to another one rather than taking it off this one.",
        );
        return;
      }
      void this.#refile(key, row.entryIdentifier, matterId);
      return;
    }
    this.#recordFieldChange(
      key,
      "the matter on this entry",
      { matterId: row.matterId },
      { matterId },
    );
    this.#patchRow(key, { matterId });
    this.#save(key);
  }

  /**
   * Move a written entry onto another matter.
   *
   * It is NOT the debounced cell save. A refile re-resolves the rate and the rounding against the
   * destination, so the row's money changes with its matter — the answer comes back from the write
   * and is adopted, rather than the row keeping figures that belonged to the matter it just left.
   *
   * No undo step is pushed. Moving it back is another refile, which the reader can simply do; a
   * stack entry that silently re-ran a cross-matter write on a record two people may be looking at
   * is a different act from putting a typed cell back.
   */
  async #refile(key: string, entryIdentifier: string, matterId: string): Promise<void> {
    const before = this.rowByKey(key)?.matterId ?? null;
    this.#patchRow(key, { matterId, saveState: "saving", saveFailure: null });
    const outcome = await refileTimeEntry(fetch, entryIdentifier, matterId, writeKey());
    if (outcome.kind !== "ok") {
      // The row goes back where it was: the record did not move, and a screen showing it on the
      // new matter would be the one thing worse than refusing.
      this.#patchRow(key, {
        matterId: before,
        saveState: "failed",
        saveFailure:
          outcome.kind === "problem" && outcome.problem.status === 409
            ? "This entry cannot be moved: it is past draft, on a bill, or claimed by one. It is unchanged."
            : "The entry was not moved. It is still on the matter it was on.",
      });
      return;
    }
    this.#patchRow(key, {
      saveState: "saved",
      saveFailure: null,
      billedMinutes: outcome.value.durationMinutes,
      rateE4: outcome.value.rateE4,
      amountMinor: outcome.value.amountMinor,
      currency: outcome.value.currency,
    });
    this.#context.announce(
      "The entry moved. Its number, its note and its files came with it; the rate and the rounding were re-read on the matter it moved to.",
    );
    this.#context.onChanged();
  }

  /** Set the work date, and answer whether the scope has to widen to keep the row in view. */
  setWorkDate(key: string, workDate: string): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.workDate === workDate || workDate === "") return;
    this.#recordFieldChange(
      key,
      "the work date on this entry",
      { workDate: row.workDate },
      { workDate },
    );
    this.#patchRow(key, { workDate });
    this.#save(key);
  }

  setDescription(key: string, description: string): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.description === description) return;
    this.#recordFieldChange(
      key,
      "the description on this entry",
      { description: row.description },
      { description },
    );
    this.#patchRow(key, { description });
    this.#save(key);
  }

  /**
   * Write the firm's own note on the entry.
   *
   * It rides the same debounced save as every other cell, and it is the one field on this row that
   * no client-facing projection selects — not the bill, not the export, not the printed sheet.
   */
  setMemo(key: string, memo: string): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.memo === memo) return;
    this.#recordFieldChange(key, "the internal memo on this entry", { memo: row.memo }, { memo });
    this.#patchRow(key, { memo });
    this.#save(key);
  }

  setWorkedSeconds(key: string, workedSeconds: number): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.workedSeconds === workedSeconds) return;
    this.#recordFieldChange(
      key,
      "the duration on this entry",
      { workedSeconds: row.workedSeconds },
      { workedSeconds },
    );
    if (this.timerRowKey === key) void this.pauseTimerOnRow();
    this.#patchRow(key, { workedSeconds });
    this.#save(key);
  }

  // ---- saving -------------------------------------------------------------------------------

  /**
   * Whether the server would accept this row as it stands.
   *
   * The matter is part of the answer, not an afterthought: capture takes a matter, so a matterless
   * row is not a failed write, it is a row that has not been sent. The mark on it says which.
   */
  #acceptable(row: SheetRow): boolean {
    return (
      row.matterId !== null &&
      row.description.trim() !== "" &&
      minutesFromSeconds(row.workedSeconds) > 0
    );
  }

  /**
   * Send a row's current values, once the keystrokes have stopped.
   *
   * One timer per row rather than one for the sheet: two rows edited in the same breath are two
   * writes, and a shared timer would make the second one cancel the first.
   */
  #save(key: string): void {
    const existing = this.#saveTimers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const row = this.rowByKey(key);
    if (row === undefined) return;
    if (!this.#acceptable(row)) {
      this.#patchRow(key, { saveState: "unsaved", saveFailure: null });
      return;
    }
    this.#patchRow(key, { saveState: "saving", saveFailure: null });
    this.#saveTimers.set(
      key,
      setTimeout(() => {
        void this.#writeRow(key);
      }, SAVE_SETTLE_MILLISECONDS),
    );
  }

  /** Answers whether the record now holds the row's values, so an inverse can tell. */
  async #writeRow(key: string): Promise<boolean> {
    const row = this.rowByKey(key);
    if (row === undefined) return false;
    // Not a failure: a row the capture route would refuse is a row that has not been sent, and the
    // mark on it already says so.
    if (!this.#acceptable(row)) return true;
    // The row's own matter, never the surface's: on a firm-wide sheet the two are different
    // questions and only the row knows the answer. Acceptability has already established it is
    // there; reading it into a constant is what lets the type system agree.
    const matterId = row.matterId;
    if (matterId === null) return true;
    const outcome =
      row.entryIdentifier === null
        ? await createTimeEntry(
            fetch,
            {
              matterId,
              timekeeperUserId: row.timekeeperUserId,
              workDate: row.workDate,
              rawDurationMinutes: minutesFromSeconds(row.workedSeconds),
              narrative: row.description.trim(),
              billable: row.billable,
              // Null clears rather than omits, so a memo emptied on the row is emptied on the
              // record — an internal note somebody deleted must not survive the save.
              memo: row.memo.trim() === "" ? null : row.memo,
            },
            writeKey(),
          )
        : await patchTimeEntry(
            fetch,
            row.entryIdentifier,
            {
              narrative: row.description.trim(),
              rawDurationMinutes: minutesFromSeconds(row.workedSeconds),
              workDate: row.workDate,
              memo: row.memo.trim() === "" ? null : row.memo,
            },
            writeKey(),
          );
    if (outcome.kind !== "ok") {
      this.#patchRow(key, {
        saveState: "failed",
        saveFailure:
          outcome.kind === "problem"
            ? `Not saved. The server answered ${String(outcome.problem.status)}. The record is unchanged.`
            : "Couldn't connect. The change wasn't saved.",
      });
      return false;
    }
    // A capture answers with the identity it minted AND the number it drew; an update answers with
    // the whole entry. Both are read for the number, because the Time Code cell should stop saying
    // TMP- the moment the firm's own reference exists rather than at the next listing.
    const written = outcome.value as { timeEntryId?: string; entryNumber?: string | null };
    this.#patchRow(key, {
      saveState: "saved",
      saveFailure: null,
      entryIdentifier: row.entryIdentifier ?? written.timeEntryId ?? null,
      entryNumber: written.entryNumber ?? row.entryNumber,
    });
    this.#context.onChanged();
    return true;
  }

  /**
   * Record one field's change as the pair of writes that walk it back and forward.
   *
   * The two patches are the field as it WAS and as it BECAME, and nothing else — which is what
   * keeps an undo to the one row the reader changed. Pushed before the change lands, because a step
   * holds the state to return to.
   */
  #recordFieldChange(
    key: string,
    label: string,
    was: Partial<SheetRow>,
    became: Partial<SheetRow>,
  ): void {
    this.history.push({
      label,
      undo: () => this.#applyAndWrite(key, was),
      redo: () => this.#applyAndWrite(key, became),
    });
  }

  /**
   * Put a field back and send it, now rather than after the settle — a reader who pressed Undo has
   * already stopped typing.
   *
   * It THROWS on anything that stops the record moving, because that is how the stack learns to
   * keep the step: a refused write leaves the act on the stack, still offered, and the reader gets
   * another attempt at the same one instead of the one beneath it.
   */
  async #applyAndWrite(key: string, values: Partial<SheetRow>): Promise<void> {
    const row = this.rowByKey(key);
    if (row === undefined) throw new Error("that row is no longer on the sheet");
    // The record moved under the step. Refusing is the honest answer: the void, the submission or
    // the approval is the newer fact, and it is not this stack's to rewrite.
    if (!isWorkable(row)) throw new Error("that entry is no longer a draft");
    this.#patchRow(key, values);
    const next = this.rowByKey(key);
    // Nothing to send: the row is not on the record at all, so the screen going back IS the whole
    // reversal and there is no write to wait for.
    if (next === undefined || !this.#acceptable(next)) {
      this.#patchRow(key, { saveState: "unsaved", saveFailure: null });
      return;
    }
    this.#patchRow(key, { saveState: "saving", saveFailure: null });
    if (!(await this.#writeRow(key))) throw new Error("the change was not written");
  }

  /**
   * Void a row. It stays on the record, numbered, and counts toward nothing.
   *
   * The two halves are different acts and they are offered on different terms. A row the server has
   * never seen is simply taken off the sheet, and putting it back is a step the stack can genuinely
   * perform, so it gets one. A row that IS an entry is voided on the firm's record, which this
   * stack cannot rewrite — so no step is pushed, and the announcement says both halves of the
   * truth: undo will not reach it, and the entry can still be restored from the ledger or the
   * record window, where the act that does reach it lives.
   */
  async voidRow(key: string): Promise<void> {
    const row = this.rowByKey(key);
    if (row === undefined) return;
    if (row.entryIdentifier === null) {
      // The row itself is the step: nothing reached the record, so putting it back is putting the
      // row back where it stood, with everything typed into it. The place is clamped on the way in
      // rather than remembered as a promise — rows come and go while a step sits on the stack.
      const removed = row;
      const stoodAt = this.rows.indexOf(row);
      this.history.push({
        label: "removing this row",
        undo: () => {
          const at = Math.min(Math.max(stoodAt, 0), this.rows.length);
          this.rows = [...this.rows.slice(0, at), removed, ...this.rows.slice(at)];
        },
        redo: () => {
          this.rows = this.rows.filter((other) => other.key !== key);
        },
      });
      this.rows = this.rows.filter((other) => other.key !== key);
      this.#context.announce("The row was removed. It had not been written to the record.");
      return;
    }
    const outcome = await voidTimeEntry(fetch, row.entryIdentifier, writeKey());
    if (outcome.kind !== "ok") {
      this.#patchRow(key, {
        saveState: "failed",
        saveFailure: "The entry was not voided. It is unchanged on the record.",
      });
      return;
    }
    this.#voidedIdentifiers.add(row.entryIdentifier);
    this.#patchRow(key, { status: "void" });
    this.#context.announce(
      "The entry was voided. It stays on the record and counts toward nothing. Undo does not reach it: restore it from the ledger or the record window.",
    );
    this.#context.onChanged();
  }

  // ---- the timer ----------------------------------------------------------------------------

  /** Seconds the current run has accrued, banked segments included. */
  elapsedSeconds(): number {
    void this.tick;
    const banked = this.#bankedSeconds;
    if (this.#segmentStartedAt === null) return banked;
    return banked + Math.floor((Date.now() - this.#segmentStartedAt) / 1000);
  }

  /** The seconds a row shows: its own, plus the run accruing into it. */
  liveSeconds(row: SheetRow): number {
    return this.timerRowKey === row.key
      ? row.workedSeconds + this.elapsedSeconds()
      : row.workedSeconds;
  }

  get timerRunning(): boolean {
    return this.#segmentStartedAt !== null;
  }

  /** Adopt whatever the server says the timekeeper's timer is doing. */
  async readTimerState(): Promise<void> {
    const outcome = await readTimer(fetch);
    if (outcome.kind !== "ok") return;
    const state = outcome.value;
    if (state.status !== "running" || state.startedAt === null) return;
    // A sheet opened from a matter adopts only that matter's run; a firm-wide sheet adopts
    // whatever is going, because every matter is in view.
    const filter = this.#context.matterFilter();
    if (filter !== null && state.matterId !== filter) return;
    this.#timerMatterId = state.matterId;
    this.#segmentStartedAt = Date.parse(state.startedAt);
    this.#bankedSeconds = 0;
  }

  /**
   * Start the firm's timer on a row.
   *
   * Only one timer runs at a time and the server is what enforces that, so this says what the start
   * cost rather than leaving the reader to discover that another row stopped.
   */
  async startTimerOnRow(key: string): Promise<void> {
    const row = this.rowByKey(key);
    if (row === undefined) return;
    const displaced = this.timerRowKey !== null && this.timerRowKey !== key;
    if (displaced) await this.#settleRunIntoItsRow();
    // The run is bound to the ROW's matter, which may be nothing at all: the firm's timer takes a
    // null matter, so time can be captured before anybody has decided where it belongs. What such a
    // run cannot do is become an entry on its own, which is settled where it is stopped.
    const outcome = await startTimer(
      fetch,
      { matterId: row.matterId, narrative: row.description.trim() },
      writeKey(),
    );
    if (outcome.kind !== "ok") {
      this.timerFailure = "The timer did not start. Nothing is running.";
      return;
    }
    this.timerFailure = null;
    this.#timerMatterId = row.matterId;
    this.timerRowKey = key;
    this.#bankedSeconds = 0;
    this.#segmentStartedAt = Date.parse(outcome.value.startedAt);
    this.rows = this.rows.map((other) => ({ ...other, timerRunning: other.key === key }));
    this.#context.announce(
      displaced
        ? "The timer is running on this row. The row it was on before was stopped and kept its time."
        : "The timer is running on this row.",
    );
  }

  /** Hold the run where it is. Nothing is lost: the banked seconds stay on the sheet. */
  async pauseTimerOnRow(): Promise<void> {
    if (this.#segmentStartedAt === null) return;
    this.#bankedSeconds = this.elapsedSeconds();
    this.#segmentStartedAt = null;
    const outcome = await pauseTimer(fetch);
    if (outcome.kind !== "ok") this.timerFailure = "The timer was not paused on the server.";
    this.rows = this.rows.map((row) => ({ ...row, timerRunning: false }));
  }

  async resumeTimerOnRow(): Promise<void> {
    if (this.timerRowKey === null || this.#segmentStartedAt !== null) return;
    const outcome = await resumeTimer(fetch);
    if (outcome.kind !== "ok") {
      this.timerFailure = "The timer did not resume. Nothing is running.";
      return;
    }
    this.timerFailure = null;
    this.#segmentStartedAt = Date.now();
    const key = this.timerRowKey;
    this.rows = this.rows.map((row) => ({ ...row, timerRunning: row.key === key }));
  }

  /**
   * Stop the run and put its time where it belongs.
   *
   * A row that is already an entry takes the elapsed time on to its own duration, so the work lands
   * where the person was typing. A row that is not yet an entry BECOMES the entry the timer
   * commits, which is the same act from the reader's side and a different route underneath.
   */
  async stopTimerOnRow(): Promise<void> {
    const key = this.timerRowKey;
    if (key === null) return;
    await this.#settleRunIntoItsRow();
    // What is said depends on where the time actually went, which is knowable only afterwards: a
    // row still short of a matter has the seconds and no entry, and saying otherwise would tell the
    // reader their work reached the record when it did not.
    const settled = this.rowByKey(key);
    this.#context.announce(
      settled !== undefined && settled.entryIdentifier === null
        ? "The timer stopped and its time is on the row. It reaches the record once the row has a matter."
        : "The timer stopped and its time is on the entry.",
    );
  }

  async #settleRunIntoItsRow(): Promise<void> {
    const key = this.timerRowKey;
    if (key === null) return;
    const elapsed = this.elapsedSeconds();
    const row = this.rowByKey(key);
    const runMatterId = this.#timerMatterId;
    this.#segmentStartedAt = null;
    this.#bankedSeconds = 0;
    this.timerRowKey = null;
    this.#timerMatterId = null;
    this.rows = this.rows.map((other) => ({ ...other, timerRunning: false }));
    if (row === undefined) return;
    /*
     * A run can only BECOME an entry where the server's own binding still says which matter it
     * belongs to and the row agrees. A run started before the matter was picked is bound to
     * nothing, and one started before the matter was changed is bound to the old one; in both
     * cases the run is let go and its seconds land on the row, which then writes itself through
     * capture as soon as it holds a matter. That is the same result from the reader's side and the
     * only one that cannot file time on a matter nobody chose.
     */
    const commitable =
      row.entryIdentifier === null && runMatterId !== null && runMatterId === row.matterId;
    if (commitable) {
      const outcome = await stopTimerAndCommit(fetch, writeKey());
      if (outcome.kind !== "ok") {
        this.timerFailure =
          "The timer stopped but its time was not recorded. The elapsed time is still on the row.";
        this.#patchRow(key, { workedSeconds: row.workedSeconds + elapsed });
        this.#save(key);
        return;
      }
      this.#patchRow(key, {
        entryIdentifier: outcome.value.timeEntryId,
        workedSeconds: row.workedSeconds + elapsed,
        saveState: "saved",
      });
      this.#context.onChanged();
      return;
    }
    await discardTimer(fetch);
    if (row.entryIdentifier !== null) {
      this.#recordFieldChange(
        key,
        "the timer's time on this entry",
        { workedSeconds: row.workedSeconds },
        { workedSeconds: row.workedSeconds + elapsed },
      );
    }
    this.#patchRow(key, { workedSeconds: row.workedSeconds + elapsed });
    this.#save(key);
  }

  /** Let go of every pending write, for a sheet that is closing. */
  dispose(): void {
    for (const timer of this.#saveTimers.values()) clearTimeout(timer);
    this.#saveTimers.clear();
  }
}
