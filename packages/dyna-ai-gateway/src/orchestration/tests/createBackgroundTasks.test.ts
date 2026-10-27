import {createBackgroundTasks} from "../createBackgroundTasks";

interface IDeferred {
  promise: Promise<void>;
  resolve(): void;
}

const makeDeferred = (): IDeferred => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return {
    promise,
    resolve,
  };
};

describe("createBackgroundTasks", () => {
  afterEach(() => jest.restoreAllMocks());

  test("whenIdle resolves at once when nothing was started", async () => {
    await expect(createBackgroundTasks().whenIdle()).resolves.toBeUndefined();
  });

  test("the tasks of one key run one after the other, in the order they were started", async () => {
    const tasks = createBackgroundTasks();
    const first = makeDeferred();
    const log: string[] = [];
    tasks.run("thread-1", async () => {
      log.push("first starts");
      await first.promise;
      log.push("first ends");
    });
    tasks.run("thread-1", async () => {
      log.push("second starts");
    });
    await Promise.resolve();
    first.resolve();
    await tasks.whenIdle();
    expect(log).toEqual(["first starts", "first ends", "second starts"]);
  });

  test("the tasks of different keys do not wait for each other", async () => {
    const tasks = createBackgroundTasks();
    const first = makeDeferred();
    const log: string[] = [];
    tasks.run("thread-1", async () => {
      await first.promise;
      log.push("thread-1");
    });
    tasks.run("thread-2", async () => {
      log.push("thread-2");
    });
    await new Promise(setImmediate);
    first.resolve();
    await tasks.whenIdle();
    expect(log).toEqual(["thread-2", "thread-1"]);
  });

  test("a task that throws is reported with its code and the next task of the key still runs", async () => {
    const tasks = createBackgroundTasks();
    const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const log: string[] = [];
    tasks.run("thread-1", async () => {
      throw new Error("the store is down");
    });
    tasks.run("thread-1", async () => {
      log.push("second");
    });
    await tasks.whenIdle();
    expect([log, String(report.mock.calls[0][0]).startsWith("Internal error 5372600823804: ")]).toEqual([["second"], true]);
  });

  test("whenIdle also waits for a task that was started while it was waiting", async () => {
    const tasks = createBackgroundTasks();
    const log: string[] = [];
    tasks.run("thread-1", async () => {
      tasks.run("thread-2", async () => {
        await new Promise(setImmediate);
        log.push("started later");
      });
    });
    await tasks.whenIdle();
    expect(log).toEqual(["started later"]);
  });
});
