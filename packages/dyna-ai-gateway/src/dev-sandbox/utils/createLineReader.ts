import {createInterface} from "node:readline";

export interface ILineReader {
  /** Prints the prompt and resolves with the next line; null once the input has ended (Ctrl+D, end of a pipe). */
  question(prompt: string): Promise<string | null>;
  close(): void;
}

/**
 * Line input that also works when stdin is a pipe: readline emits lines as they arrive, even while no question
 * is pending, so they are queued here and handed out one per question instead of being lost.
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
