import {ConsoleController} from "../consoleController";

enum EDebug {
  ASK = "ASK",
}

test("timers and counters carry the key in their label, so keys never share one", () => {
  const time = jest.spyOn(console, "time").mockImplementation(() => undefined);
  const timeEnd = jest.spyOn(console, "timeEnd").mockImplementation(() => undefined);
  const count = jest.spyOn(console, "count").mockImplementation(() => undefined);
  const c = new ConsoleController<EDebug>({active: {ASK: true}});

  c.time(EDebug.ASK, "fetch");
  c.timeEnd(EDebug.ASK, "fetch");
  c.count(EDebug.ASK);

  expect(time).toHaveBeenCalledWith("ASK fetch");
  expect(timeEnd).toHaveBeenCalledWith("ASK fetch");
  expect(count).toHaveBeenCalledWith("ASK");
  [time, timeEnd, count].forEach(spy => spy.mockRestore());
});
