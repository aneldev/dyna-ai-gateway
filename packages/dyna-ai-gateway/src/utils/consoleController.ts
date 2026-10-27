/* eslint-disable no-console -- this class is the console gate; every other file prints through it */

/** A key of the controller: the enum member or its string value. */
export type TConsoleKey<TKey extends string> = TKey | `${TKey}`;

export interface IConsoleControllerConfig<TKey extends string> {
  /** Which keys print; every key is declared. */
  active: Record<TKey, boolean>;
}

/**
 * The global `console` behind per-key switches (browser and Node).
 * Every method is the `console` method with the key first; the output is prefixed with the key, labels (`time`, `count`, `profile`) too.
 *
 * ```ts
 * const c = new ConsoleController<EDebug>({active: {ASK: true, RUN: false}});
 * c.log(EDebug.ASK, "Something", {strong: "d"}); // ASK Something {strong: "d"}
 * c.setActive(EDebug.RUN, true);
 * c.toggleActive(EDebug.ASK);
 * ```
 */
export class ConsoleController<TKey extends string> {
  private readonly active: Record<string, boolean>;

  constructor(
    {active}: IConsoleControllerConfig<TKey>,
  ) {
    this.active = {...active};
  }

  // Activation

  public isActive(key: TConsoleKey<TKey>): boolean {
    return this.active[key] === true;
  }

  public setActive(key: TConsoleKey<TKey>, active: boolean): void {
    this.active[key] = active;
  }

  public toggleActive(key: TConsoleKey<TKey>): void {
    this.active[key] = !this.isActive(key);
  }

  // Output

  public log(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.log(key, ...data);
  }

  public info(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.info(key, ...data);
  }

  public warn(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.warn(key, ...data);
  }

  public error(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.error(key, ...data);
  }

  public debug(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.debug(key, ...data);
  }

  public trace(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.trace(key, ...data);
  }

  /** Prints the key, then the object with `console.dir` (which takes no prefix). */
  public dir(key: TConsoleKey<TKey>, item: unknown, options?: object): void {
    if (!this.isActive(key)) return;
    console.log(key);
    console.dir(item, options);
  }

  public dirxml(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.dirxml(key, ...data);
  }

  /** Prints the key, then the table (which takes no prefix). */
  public table(key: TConsoleKey<TKey>, tabularData: unknown, properties?: string[]): void {
    if (!this.isActive(key)) return;
    console.log(key);
    console.table(tabularData, properties);
  }

  public assert(key: TConsoleKey<TKey>, condition: boolean, ...data: unknown[]): void {
    if (this.isActive(key)) console.assert(condition, key, ...data);
  }

  public clear(key: TConsoleKey<TKey>): void {
    if (this.isActive(key)) console.clear();
  }

  // Groups — `groupEnd` closes only when the key is active, as `group` opened only then.

  public group(key: TConsoleKey<TKey>, ...label: unknown[]): void {
    if (this.isActive(key)) console.group(key, ...label);
  }

  public groupCollapsed(key: TConsoleKey<TKey>, ...label: unknown[]): void {
    if (this.isActive(key)) console.groupCollapsed(key, ...label);
  }

  public groupEnd(key: TConsoleKey<TKey>): void {
    if (this.isActive(key)) console.groupEnd();
  }

  // Counters, timers, profiles — the label is `<key> <label>`, so keys never share a counter or timer.

  public count(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.count(this.getLabel(key, label));
  }

  public countReset(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.countReset(this.getLabel(key, label));
  }

  public time(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.time(this.getLabel(key, label));
  }

  public timeLog(key: TConsoleKey<TKey>, label?: string, ...data: unknown[]): void {
    if (this.isActive(key)) console.timeLog(this.getLabel(key, label), ...data);
  }

  public timeEnd(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.timeEnd(this.getLabel(key, label));
  }

  public timeStamp(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.timeStamp(this.getLabel(key, label));
  }

  public profile(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.profile(this.getLabel(key, label));
  }

  public profileEnd(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.profileEnd(this.getLabel(key, label));
  }

  private getLabel(key: TConsoleKey<TKey>, label?: string): string {
    return label === undefined ? key : `${key} ${label}`;
  }
}
