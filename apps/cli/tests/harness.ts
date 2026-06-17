import { vi, type MockInstance } from "vitest";

// Shared spies for the action-level tests. The actions render through
// `console.log`/`console.error`/`console.table` and abort through `process.exit`,
// so a test needs to capture both. There is no existing harness for this in the
// repo — the other CLI tests only call pure helpers — so this is the pattern.

// Marker baked into the faked `process.exit` so a test can tell "the action tried
// to exit" apart from any other throw. Tests match on /__exit__:<code>/ directly.
const EXIT_SENTINEL = "__exit__";

export interface Spies {
  log: MockInstance;
  error: MockInstance;
  exit: MockInstance;
  /** Everything written through console.log (console.table routes here too). */
  stdout(): string;
  /** Everything written through console.error. */
  stderr(): string;
  /** The code passed to the last process.exit call, or undefined if never called. */
  exitCode(): number | undefined;
  restore(): void;
}

export function spyConsoleAndExit(): Spies {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  // The throw is load-bearing: `fail()` is typed `never`, and actions like
  // `asof`/`evaluate` read the unwrapped value on the very next line. A
  // non-throwing stub would fall through into a bogus NaN-into-engine path
  // instead of aborting, so the stub has to interrupt control flow the way the
  // real `process.exit` does.
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null) => {
      throw new Error(`${EXIT_SENTINEL}:${code ?? 0}`);
    });

  const joined = (m: MockInstance): string =>
    m.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

  return {
    log,
    error,
    exit,
    stdout: () => joined(log),
    stderr: () => joined(error),
    exitCode: () => exit.mock.calls.at(-1)?.[0] as number | undefined,
    restore: () => {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    },
  };
}
