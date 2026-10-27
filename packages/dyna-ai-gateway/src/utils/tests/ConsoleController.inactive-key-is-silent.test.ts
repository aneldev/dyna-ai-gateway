import {ConsoleController} from "../consoleController";

enum EDebug {
  OPTION = "OPTION",
}

test("an inactive key prints nothing, on every console method", () => {
  const spies = (["log", "warn", "error", "table", "group", "time"] as const)
    .map(method => jest.spyOn(console, method).mockImplementation(() => undefined));
  const c = new ConsoleController<EDebug>({active: {OPTION: false}});

  c.log(EDebug.OPTION, "Something");
  c.warn(EDebug.OPTION, "Something");
  c.error(EDebug.OPTION, "Something");
  c.table(EDebug.OPTION, [{a: 1}]);
  c.group(EDebug.OPTION, "Something");
  c.time(EDebug.OPTION, "fetch");

  spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
  spies.forEach(spy => spy.mockRestore());
});
