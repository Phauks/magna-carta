// What to do when the thing reading our output goes away — `pnpm test | head` being the case that
// prompted this.
//
// THE FAILURE THIS PREVENTS. `head` exits as soon as it has its lines, closing the read end of the
// pipe. The run is then writing into a pipe nobody holds. Node ignores SIGPIPE and turns the failed
// write into an asynchronous `EPIPE` on the stream, so nothing dies of its own accord: a reporter that
// swallows that error neither finishes nor makes progress, and the run sits at 0% CPU **still holding
// the single-flight lock**. That shape is the trap — a held lock plus a 0%-CPU holder is exactly what
// genuine contention looks like, so the diagnosis goes to the lock rather than to the closed pipe. It
// has to be cleared by hand, and `| head` against a long suite is the obvious thing to type.
//
// Note that pid-based reclaim (lock.mjs) cannot rescue this: the holder is not dead, it is blocked, so
// a liveness probe correctly reports it alive and correctly refuses the next run. Only ending the run
// frees the lock, which is why the parent has to notice the broken pipe itself rather than trust the
// runner to die.
//
// WHY THE PARENT HAS TO OWN THE WRITES TO SEE IT. With `stdio: "inherit"` the runner writes straight to
// our file descriptor, so the failure happens inside the child and the parent observes nothing. A parent
// cannot detect a broken pipe without writing to it either — an empty `write("")` resolves true without
// reaching the syscall, and a real write reports `EPIPE` asynchronously on the stream's `error` event
// rather than throwing. So the only reliable detector is to forward the child's output through the
// parent's own stream and listen for that error.
//
// Forwarding costs the child its TTY, which would lose colour and the progress spinner — so it is only
// done when there is a pipe to break. When our stdout IS a TTY there is no reader to go away and
// `inherit` is kept, byte-for-byte the behaviour it has always had. When it is not a TTY (`| head`, a
// redirect to a file, CI) the child's stdout was never going to be a TTY anyway, so forwarding costs
// nothing that was not already gone.

/**
 * Stream errors that all mean "the reader is gone". `EPIPE` is the pipe closing under us;
 * the two `ERR_STREAM_*` codes are the same condition observed one tick later, once the destination has
 * already been torn down.
 */
export const BROKEN_PIPE_CODES = new Set([
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

/** Is this error the reader going away, rather than a fault worth reporting? */
export function isBrokenPipe(error) {
  return error !== null && typeof error === "object" && BROKEN_PIPE_CODES.has(error.code);
}

/**
 * The exit code for a run cut short by a closed pipe: the conventional 128 + SIGPIPE(13) that a shell
 * reports when a pipeline member dies of SIGPIPE. It is deliberately NOT 0 — the suite did not pass,
 * it stopped early — and deliberately not 1, so it is distinguishable from a test failure.
 */
export const BROKEN_PIPE_EXIT_CODE = 141;

/**
 * How to wire the child's output: `"inherit"` hands it our descriptors, `"forward"` asks for pipes the
 * parent copies through so it can see the destination fail. Keyed only on whether our own stdout is a
 * TTY, per the reasoning above.
 */
export function outputMode(stdoutIsTty) {
  return stdoutIsTty ? "inherit" : "forward";
}

/** The `stdio` option for a given output mode: stdin always inherits, so a watch run stays interactive. */
export function stdioFor(mode) {
  return mode === "inherit" ? "inherit" : ["inherit", "pipe", "pipe"];
}

/**
 * Write `text` to `stream`, treating a broken pipe as nothing to report. Used for the guard's own
 * messages: they must not become an uncaught exception, least of all while the lock is held.
 */
export function writeIgnoringBrokenPipe(stream, text) {
  try {
    stream.write(text);
  } catch (error) {
    if (!isBrokenPipe(error)) throw error;
  }
}
