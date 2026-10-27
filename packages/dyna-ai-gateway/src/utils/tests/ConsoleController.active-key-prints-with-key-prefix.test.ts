import {ConsoleController} from "../consoleController";

enum EDebug {
  OPTION = "OPTION",
}

test("an active key prints through console.log, the key first, the objects as objects", () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const c = new ConsoleController<EDebug>({active: {OPTION: true}});

  c.log(EDebug.OPTION, "Something", {strong: "d"});
  c.log("OPTION", "By value");

  expect(log.mock.calls).toEqual([
    ["OPTION", "Something", {strong: "d"}],
    ["OPTION", "By value"],
  ]);
  log.mockRestore();
});
