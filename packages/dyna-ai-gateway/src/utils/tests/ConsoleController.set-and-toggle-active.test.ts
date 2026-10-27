import {ConsoleController} from "../consoleController";

enum EDebug {
  OPTION = "OPTION",
}

test("setActive and toggleActive switch a key on and off", () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const c = new ConsoleController<EDebug>({active: {OPTION: true}});

  c.setActive(EDebug.OPTION, false);
  expect(c.isActive(EDebug.OPTION)).toBe(false);
  c.log(EDebug.OPTION, "silent");

  c.toggleActive(EDebug.OPTION);
  expect(c.isActive(EDebug.OPTION)).toBe(true);
  c.log(EDebug.OPTION, "printed");

  expect(log.mock.calls).toEqual([["OPTION", "printed"]]);
  log.mockRestore();
});
