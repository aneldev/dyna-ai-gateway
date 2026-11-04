import {createInterface} from "node:readline";

/**
 * Line input of the sandbox: a prompt in, the next line out, null at the end of the input.
 *
 * Returned by `createLineReader`; taken by `runChatSession` and `askPauseDecision`, and by the debugger session to wait for Enter.
 */
export interface ILineReader {
  /** Prints the prompt and resolves with the next line; null once the input has ended (Ctrl+D, end of a pipe). */
  question(prompt: string): Promise<string | null>;
  /** Closes the readline interface; stdin is released. */
  close(): void;
}

/**
 * createLineReader -- stdin lines, one per question, TTY or pipe
 *
 * # About
 *
 * > A pipe's lines arrive before anyone asks; they are queued and handed out one per question.
 *
 * `node:readline` emits every line as it arrives, pending question or not; a line read while nothing waits would be lost.
 * The queue keeps it, and a queued line is echoed after the prompt so a scripted session reads like a typed one.
 * `question` resolves null once the input ended (Ctrl+D, the end of the pipe).
 *
 * # Who needs it
 *
 * `runChatSession` for the chat, `sandbox.debug.ts` to wait for Enter.
 */
export const createLineReader = (): ILineReader => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  const queued: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;

  rl.on("line", (line: string): void => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    }
    else {
      queued.push(line);
    }
  });
  rl.on("close", (): void => {
    closed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });

  return {
    question: (prompt: string): Promise<string | null> => {
      process.stdout.write(prompt);
      const next = queued.shift();
      if (next !== undefined) {
        process.stdout.write(`${next}\n`);
        return Promise.resolve(next);
      }
      if (closed) return Promise.resolve(null);
      return new Promise(resolve => {
        waiting = resolve;
      });
    },
    close: (): void => rl.close(),
  };
};
