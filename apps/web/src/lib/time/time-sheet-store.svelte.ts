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
 * THE MATTER OF AN ENTRY THAT ALREADY EXISTS IS NOT SETTABLE HERE. Nothing in the contract moves an
 * entry from one matter to another, so the picker is offered on a row that has not been written and
 * the cell states the dependency on one that has. Offering the change and dropping it would be the
 * worse failure: the reader would believe the entry had moved.
 *
 * THE TIMER IS THE FIRM'S, NOT THE PAGE'S. One timer per timekeeper, held on the server, so
 * starting one on a second row stops the first and a reload does not lose it. Where it lands
 * differs by the row it was started from: a row that is already an entry takes the elapsed time on
 * to its own duration, and a row that is not becomes the entry the timer commits.
 *
 * UNDO PUTS THE SHEET BACK, THEN PUTS THE RECORD BACK. A step restores the rows immediately, so the
 * screen answers at once, and then writes the restored values through. An undo is itself a change
 * the firm made, and it reaches the record as one.
 *
 * SO ONLY WHAT CAN ACTUALLY BE PUT BACK IS OFFERED AS A STEP. The stack writes changed FIELDS back
 * through the update route, which is the only reversal this surface has. Striking an entry is not
 * one of them: nothing un-strikes an entry, so a strike pushes no step and says at the moment it
 * happens that undo does not reach it. Offering the step and then announcing a reversal that never
 * ran is the worse failure, because the reader believes the record went back.
 */
import { untrack } from "svelte";
import type { FirmMemberSummary } from "$lib/members/members-api.ts";
import type { TimeEntrySummary } from "$lib/matters/time-api.ts";
import { SheetHistory } from "./time-sheet-history.svelte.ts";
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

/** A row's fields, held for the undo stack. */
type RowSnapshot = readonly SheetRow[];

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

  readonly history: SheetHistory<RowSnapshot>;

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
   * Entries struck since this sheet opened.
   *
   * A snapshot taken before a strike still holds that row as a draft, so restoring it would put a
   * struck entry back on the sheet as workable and then try to write to it. The strike is the newer
   * fact and it survives the restore.
   */
  readonly #struckIdentifiers = new Set<string>();

  constructor(context: SheetContext) {
    this.#context = context;
    this.history = new SheetHistory<RowSnapshot>(
      () => this.rows.map((row) => ({ ...row })),
      (snapshot) => {
        this.rows = snapshot.map((row) =>
          row.entryIdentifier !== null && this.#struckIdentifiers.has(row.entryIdentifier)
            ? { ...row, status: "void" as const }
            : { ...row },
        );
        void this.#writeBackEverySavedRow();
      },
    );
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
      this.#context.announce(
        "This entry is on the firm's record, and nothing moves an entry from one matter to another yet. It stays where it is.",
      );
      return;
    }
    this.history.push("the matter on this entry");
    this.#patchRow(key, { matterId });
    this.#save(key);
  }

  /** Set the work date, and answer whether the scope has to widen to keep the row in view. */
  setWorkDate(key: string, workDate: string): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.workDate === workDate || workDate === "") return;
    this.history.push(`the work date on this entry`);
    this.#patchRow(key, { workDate });
    this.#save(key);
  }

  setDescription(key: string, description: string): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.description === description) return;
    this.history.push("the description on this entry");
    this.#patchRow(key, { description });
    this.#save(key);
  }

  setWorkedSeconds(key: string, workedSeconds: number): void {
    const row = this.rowByKey(key);
    if (row === undefined || row.workedSeconds === workedSeconds) return;
    this.history.push("the duration on this entry");
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

  async #writeRow(key: string): Promise<void> {
    const row = this.rowByKey(key);
    if (row === undefined || !this.#acceptable(row)) return;
    // The row's own matter, never the surface's: on a firm-wide sheet the two are different
    // questions and only the row knows the answer. Acceptability has already established it is
    // there; reading it into a constant is what lets the type system agree.
    const matterId = row.matterId;
    if (matterId === null) return;
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
            },
            writeKey(),
          );
    if (outcome.kind !== "ok") {
      this.#patchRow(key, {
        saveState: "failed",
        saveFailure:
          outcome.kind === "problem"
            ? `Not saved. The server answered ${String(outcome.problem.status)}. The record is unchanged.`
            : "Nothing answered. The change was not saved and the record is unchanged.",
      });
      return;
    }
    const written = outcome.value as { timeEntryId?: string };
    this.#patchRow(key, {
      saveState: "saved",
      saveFailure: null,
      entryIdentifier: row.entryIdentifier ?? written.timeEntryId ?? null,
    });
    this.#context.onChanged();
  }

  /** After an undo, write every row that already exists back the way the stack put it. */
  async #writeBackEverySavedRow(): Promise<void> {
    await Promise.all(
      this.rows
        .filter((row) => row.entryIdentifier !== null && isWorkable(row) && this.#acceptable(row))
        .map((row) => this.#writeRow(row.key)),
    );
  }

  /**
   * Strike a row. It stays on the record, numbered, and counts toward nothing.
   *
   * The two halves are different acts and they are offered on different terms. A row the server has
   * never seen is simply taken off the sheet, and putting it back is a step the stack can genuinely
   * perform, so it gets one. A row that IS an entry is struck on the firm's record, and there is no
   * route that un-strikes one — so no step is pushed and the announcement says as much, at the
   * moment it is true, rather than leaving the reader to press undo and be told it worked.
   */
  async voidRow(key: string): Promise<void> {
    const row = this.rowByKey(key);
    if (row === undefined) return;
    if (row.entryIdentifier === null) {
      this.history.push("removing this row");
      this.rows = this.rows.filter((other) => other.key !== key);
      this.#context.announce("The row was removed. It had not been written to the record.");
      return;
    }
    const outcome = await voidTimeEntry(fetch, row.entryIdentifier, writeKey());
    if (outcome.kind !== "ok") {
      this.#patchRow(key, {
        saveState: "failed",
        saveFailure: "The entry was not struck. It is unchanged on the record.",
      });
      return;
    }
    this.#struckIdentifiers.add(row.entryIdentifier);
    this.#patchRow(key, { status: "void" });
    this.#context.announce(
      "The entry was struck. It stays on the record and counts toward nothing. Undo does not reach it: nothing un-strikes an entry.",
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
    if (row.entryIdentifier !== null) this.history.push("the timer's time on this entry");
    this.#patchRow(key, { workedSeconds: row.workedSeconds + elapsed });
    this.#save(key);
  }

  /** Let go of every pending write, for a sheet that is closing. */
  dispose(): void {
    for (const timer of this.#saveTimers.values()) clearTimeout(timer);
    this.#saveTimers.clear();
  }
}
