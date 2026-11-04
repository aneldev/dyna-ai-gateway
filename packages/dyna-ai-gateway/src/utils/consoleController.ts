/* eslint-disable no-console -- this class is the console gate; every other file prints through it */

/** A key of the controller: the enum member or its string value. */
export type TConsoleKey<TKey extends string> = TKey | `${TKey}`;

/**
 * The switches of a `ConsoleController`: one boolean per key, all declared up front.
 *
 * Taken by the `ConsoleController` constructor; the keys are the members of the host's enum.
 */
export interface IConsoleControllerConfig<TKey extends string> {
  /** Which keys print; every key is declared. */
  active: Record<TKey, boolean>;
}

/**
 * ConsoleController -- the global `console` behind per-key switches
 *
 * # About
 *
 * > Every `console` method, with a key first; the key decides whether it prints.
 *
 * Developer output grouped by channel (an enum member per channel), switched on and off at runtime, prefixed with its
 * key so the lines of one channel are found at a glance. The labels of `count`, `time` and `profile` are prefixed too,
 * so two channels never share a counter or a timer. Browser and Node.
 *
 * - A silent channel costs one boolean read; the arguments are still evaluated by the caller.
 * - The only file of the gateway that calls `console` directly: everything else prints through an instance.
 *
 * # Who needs it
 *
 * The dev sandbox (`devConsole`, keyed by `EDevConsole`); a host that wants switchable debug output of its own.
 *
 * # Usage
 *
 * ```ts
 * const c = new ConsoleController<EDebug>({active: {ASK: true, RUN: false}});
 * c.log(EDebug.ASK, "Something", {strong: "d"}); // ASK Something {strong: "d"}
 * c.setActive(EDebug.RUN, true);
 * c.toggleActive(EDebug.ASK);
 * ```
 *
 * # Pitfalls
 *
 * `group` and `groupEnd` must be called with the same key: a group opens only when its key is active, and closes only
 * then. A `groupEnd` on a key switched off in between leaves the group open.
 */
export class ConsoleController<TKey extends string> {
  private readonly active: Record<string, boolean>;

  constructor(
    {active}: IConsoleControllerConfig<TKey>,
  ) {
    this.active = {...active};
  }

  // Activation

  /**
   * isActive -- whether a key prints
   *
   * # About
   *
   * > True only when the key was set to true; an unknown key is silent.
   */
  public isActive(key: TConsoleKey<TKey>): boolean {
    return this.active[key] === true;
  }

  /**
   * setActive -- switches a key on or off
   *
   * # About
   *
   * > Takes effect on the next call with that key.
   */
  public setActive(key: TConsoleKey<TKey>, active: boolean): void {
    this.active[key] = active;
  }

  /**
   * toggleActive -- flips a key
   *
   * # About
   *
   * > Off becomes on, on (or unknown) becomes off.
   */
  public toggleActive(key: TConsoleKey<TKey>): void {
    this.active[key] = !this.isActive(key);
  }

  // Output

  /**
   * log -- `console.log` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public log(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.log(key, ...data);
  }

  /**
   * info -- `console.info` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public info(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.info(key, ...data);
  }

  /**
   * warn -- `console.warn` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public warn(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.warn(key, ...data);
  }

  /**
   * error -- `console.error` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public error(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.error(key, ...data);
  }

  /**
   * debug -- `console.debug` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public debug(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.debug(key, ...data);
  }

  /**
   * trace -- `console.trace` with the key first
   *
   * # About
   *
   * > Prints `key …data` and the stack when the key is active; nothing otherwise.
   */
  public trace(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.trace(key, ...data);
  }

  /**
   * dir -- `console.dir` of one object under the key
   *
   * # About
   *
   * > The key on its own line, then the object: `console.dir` takes no prefix.
   *
   * `options` are `console.dir`'s (`depth`, `colors`, …). Nothing when the key is inactive.
   */
  public dir(key: TConsoleKey<TKey>, item: unknown, options?: object): void {
    if (!this.isActive(key)) return;
    console.log(key);
    console.dir(item, options);
  }

  /**
   * dirxml -- `console.dirxml` with the key first
   *
   * # About
   *
   * > Prints `key …data` when the key is active; nothing otherwise.
   */
  public dirxml(key: TConsoleKey<TKey>, ...data: unknown[]): void {
    if (this.isActive(key)) console.dirxml(key, ...data);
  }

  /**
   * table -- `console.table` under the key
   *
   * # About
   *
   * > The key on its own line, then the table: `console.table` takes no prefix.
   *
   * `properties` limits the columns, as in `console.table`. Nothing when the key is inactive.
   */
  public table(key: TConsoleKey<TKey>, tabularData: unknown, properties?: string[]): void {
    if (!this.isActive(key)) return;
    console.log(key);
    console.table(tabularData, properties);
  }

  /**
   * assert -- `console.assert` with the key in the message
   *
   * # About
   *
   * > Prints `key …data` when the key is active and the condition is false.
   */
  public assert(key: TConsoleKey<TKey>, condition: boolean, ...data: unknown[]): void {
    if (this.isActive(key)) console.assert(condition, key, ...data);
  }

  /**
   * clear -- `console.clear` guarded by a key
   *
   * # About
   *
   * > Clears the console only when the key is active.
   */
  public clear(key: TConsoleKey<TKey>): void {
    if (this.isActive(key)) console.clear();
  }

  // Groups — `groupEnd` closes only when the key is active, as `group` opened only then.

  /**
   * group -- `console.group` with the key first
   *
   * # About
   *
   * > Opens a group labelled `key …label` when the key is active; close it with `groupEnd` on the same key.
   */
  public group(key: TConsoleKey<TKey>, ...label: unknown[]): void {
    if (this.isActive(key)) console.group(key, ...label);
  }

  /**
   * groupCollapsed -- `console.groupCollapsed` with the key first
   *
   * # About
   *
   * > Opens a collapsed group labelled `key …label` when the key is active; close it with `groupEnd` on the same key.
   */
  public groupCollapsed(key: TConsoleKey<TKey>, ...label: unknown[]): void {
    if (this.isActive(key)) console.groupCollapsed(key, ...label);
  }

  /**
   * groupEnd -- closes the group of a key
   *
   * # About
   *
   * > Closes the innermost group only when the key is active, as `group` opened one only then.
   */
  public groupEnd(key: TConsoleKey<TKey>): void {
    if (this.isActive(key)) console.groupEnd();
  }

  // Counters, timers, profiles — the label is `<key> <label>`, so keys never share a counter or timer.

  /**
   * count -- `console.count` on the key's counter
   *
   * # About
   *
   * > The counter is `<key> <label>` (or the key alone), so keys never share one.
   */
  public count(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.count(this.getLabel(key, label));
  }

  /**
   * countReset -- `console.countReset` on the key's counter
   *
   * # About
   *
   * > Resets the counter `<key> <label>` (or the key alone).
   */
  public countReset(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.countReset(this.getLabel(key, label));
  }

  /**
   * time -- `console.time` on the key's timer
   *
   * # About
   *
   * > The timer is `<key> <label>` (or the key alone), so keys never share one.
   */
  public time(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.time(this.getLabel(key, label));
  }

  /**
   * timeLog -- `console.timeLog` on the key's timer
   *
   * # About
   *
   * > Prints the elapsed time of `<key> <label>` and `…data`; the timer keeps running.
   */
  public timeLog(key: TConsoleKey<TKey>, label?: string, ...data: unknown[]): void {
    if (this.isActive(key)) console.timeLog(this.getLabel(key, label), ...data);
  }

  /**
   * timeEnd -- `console.timeEnd` on the key's timer
   *
   * # About
   *
   * > Prints the elapsed time of `<key> <label>` and stops the timer.
   */
  public timeEnd(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.timeEnd(this.getLabel(key, label));
  }

  /**
   * timeStamp -- `console.timeStamp` with the key's label
   *
   * # About
   *
   * > A marker `<key> <label>` in the browser's performance timeline; a no-op in Node.
   */
  public timeStamp(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.timeStamp(this.getLabel(key, label));
  }

  /**
   * profile -- `console.profile` under the key's label
   *
   * # About
   *
   * > Starts the CPU profile `<key> <label>` in the browser's dev tools; a no-op in Node.
   */
  public profile(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.profile(this.getLabel(key, label));
  }

  /**
   * profileEnd -- `console.profileEnd` under the key's label
   *
   * # About
   *
   * > Stops the CPU profile `<key> <label>`.
   */
  public profileEnd(key: TConsoleKey<TKey>, label?: string): void {
    if (this.isActive(key)) console.profileEnd(this.getLabel(key, label));
  }

  /** `<key> <label>`, or the key alone: the name counters, timers and profiles are kept under. */
  private getLabel(key: TConsoleKey<TKey>, label?: string): string {
    return label === undefined ? key : `${key} ${label}`;
  }
}
