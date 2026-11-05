import {ZodType} from "zod";
import {dynaError} from "dyna-error";

import {
  IChunk,
  IFileRef,
  IIssue,
  IToolResultPart,
  IUserContext,
  EIssueSeverity,
} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";
import {
  IInlineFilePart,
  ILLMClientCallMeta,
  IModelResult,
  EFinishReason,
} from "../llm-client";
import {ETraceKind} from "../trace";
import {isUsageDeniedError} from "../usage-guard";

import {
  IGuardrails,
  IGuardrailsConfig,
  IGuardrailsDeps,
  IInputCheck,
  IInputEvidence,
  IInputRule,
  IOutputCheck,
  IOutputEvidence,
  IOutputRule,
  IRuleErrorReport,
  TInputJudgeHandler,
  TOnRuleErrorHandler,
  TOutputJudgeHandler,
  ERuleFailure,
  ERuleStage,
} from "./types";

import {createBuiltInInputRules} from "./utils/builtInInputRules";
import {createJudge} from "./utils/createJudge";
import {
  toInputJudgeParts,
  toOutputJudgeParts,
} from "./utils/judgeEvidence";

const DEFAULT_MAX_PROMPT_CHARS = 20_000;
const DEFAULT_RULE_TIMEOUT_MS = 10_000;
/** Sentinel of the abort race; a rule cannot return it. */
const ABORTED: unique symbol = Symbol("aborted");

/** True when one issue is ERROR: the check fails and the next stage does not run. */
/** True when one issue is ERROR: the check fails and the next stage does not run. */
const hasError = (issues: IIssue[]): boolean => issues.some(issue => issue.severity === EIssueSeverity.ERROR);

/** What every rule looks like to the runner: input and output rules differ only in their evidence and their judge. */
interface IRule<TEvidence, TJudge> {
  /** The rule's name, stamped on its issues. */
  name: string;
  /** The rule's own timeout; the config's `ruleTimeoutMs` when absent. */
  timeoutMs?: number;
  /** The rule itself: issues out, empty = pass. */
  check(args: {
    evidence: TEvidence;
    abortSignal: AbortSignal;
    judge: TJudge;
  }): Promise<IIssue[]>;
}

/** Makes the judge of one rule run, bound to the rule's abort signal; `onTraceId` collects the rule's own judge calls. */
type TMakeJudgeHandler<TJudge> = (args: {
  abortSignal: AbortSignal;
  onTraceId: (traceId: string) => void;
}) => TJudge;

/**
 * Guardrails -- every check around a model call, in one place
 *
 * # About
 *
 * > The gateway knows that rules exist, not what the app's rules check.
 *
 * Two checks: `checkInput` on the prompt before the model call, `checkOutput` on the answer after it. Each runs the gateway's
 * built-in rules first (prompt not empty, not over `maxPromptChars`, no prompt-injection marker; answer not truncated, matches
 * the schema) and the app's `inputRules` / `outputRules` only when those passed, so a paid moderation call is never made for a
 * prompt that is already rejected. The app's rules run in parallel, each under its timeout; a rule that throws or times out is
 * the ERROR issue `rule_error`, so a broken rule never lets anything pass (D47). A rule that classifies asks a model through
 * the `judge` it receives: one completion on the profile's cheap or main model, checked with the usage adapter, reported to it
 * and traced like every other call (D57, D59). The severity of an issue is the only verdict: ERROR fails the call, WARNING
 * flags it (D49).
 *
 * Sits between the orchestration (`prepareCall`, `checkOutput`, `parseEditedAnswer`), which calls it, and the `LLMClient`,
 * which the judge calls go through.
 *
 * # Who needs it
 *
 * `AIGateway`, through the orchestration, on every `ask`, `run` and `resume`. Constructed once from
 * `IAIGatewayConfig.guardrails`; a host replaces it through `IAIGatewayDeps.guardrails`.
 *
 * # What needs
 *
 * `IGuardrailsConfig`: the app's rules and the limits, fixed at construction. `IGuardrailsDeps`: the `LLMClient` and the
 * `ModelRegistry` the judge calls use, so the Guardrails are created after them.
 *
 * # Pitfalls
 *
 * Rules are fixed at construction: there is no `addRule`, a gateway that needs other rules is constructed again. Rule names
 * are unique, the app's input rules also against the built-in names; a duplicate throws `5373891090405`. The error a rule
 * threw never reaches the caller's issues, it goes to the server log and to `onRuleError` only (D107).
 */
export class Guardrails implements IGuardrails {
  private readonly ruleTimeoutMs: number;
  private readonly builtInInputRules: IInputRule[];
  private readonly inputRules: IInputRule[];
  private readonly outputRules: IOutputRule[];
  private readonly onRuleError?: TOnRuleErrorHandler;

  constructor(
    {
      maxPromptChars = DEFAULT_MAX_PROMPT_CHARS,
      ruleTimeoutMs = DEFAULT_RULE_TIMEOUT_MS,
      inputRules = [],
      outputRules = [],
      onRuleError,
    }: IGuardrailsConfig,
    private readonly deps: IGuardrailsDeps,
  ) {
    this.ruleTimeoutMs = ruleTimeoutMs;
    this.builtInInputRules = createBuiltInInputRules({maxPromptChars});
    this.inputRules = [...inputRules];
    this.outputRules = [...outputRules];
    this.onRuleError = onRuleError;
    this.assertUniqueNames([...this.builtInInputRules, ...this.inputRules]);
    this.assertUniqueNames(this.outputRules);
  }

  /**
   * checkInput -- screens the prompt before the model call
   *
   * # About
   *
   * > The built-in rules first, the app's only when those passed.
   *
   * Sanitises the prompt (trims, normalises line endings), then runs the built-in input rules (not empty unless files come
   * with it, not over `maxPromptChars`, no prompt-injection marker) and, only when none of them returned an ERROR, the app's
   * `inputRules` in parallel. Returns the sanitised prompt, every issue stamped with its rule's name, `ok` and the trace ids
   * of the judge calls, which the gateway annotates with the issues (D73). The call's `abortSignal` reaches every rule and
   * its judge call; an aborted call rejects with the signal's reason, not with a `rule_error` (D90).
   *
   * # Who needs it
   *
   * `prepareCall`, on the prompt of every `ask` and `run`; `AIGateway.resume`, on the free text a user typed into a question
   * of the model (D62), with no files.
   */
  public async checkInput(
    {
      prompt,
      files,
      inlineFiles,
      userContext,
      profile,
      threadId,
      abortSignal,
    }: {
      prompt: string;
      files: IFileRef[];
      /** The same files with their bytes; the rules' judge sends them to the model. */
      inlineFiles: IInlineFilePart[];
      userContext: IUserContext;
      profile: IAIProfile;
      /** Undefined when the call creates a new thread. */
      threadId?: string;
      /**
       * The call's signal: merged into every rule's.
       * An aborted call rejects with the signal's reason, no `rule_error`; so does a judge call the usage adapter refused, with that error.
       */
      abortSignal?: AbortSignal;
    },
  ): Promise<IInputCheck> {
    const evidence: IInputEvidence = {
      prompt: prompt.replace(/\r\n?/g, "\n").trim(),
      files,
      inlineFiles,
      userContext,
      profile,
      threadId,
    };
    const meta = this.makeMeta({
      userContext,
      profile,
      threadId,
    });
    const traceIds: string[] = [];
    const makeJudge: TMakeJudgeHandler<TInputJudgeHandler> = ({
      abortSignal: ruleSignal,
      onTraceId,
    }) => createJudge({
      llmClient: this.deps.llmClient,
      modelRegistry: this.deps.modelRegistry,
      profile,
      meta,
      abortSignal: ruleSignal,
      onTraceId: (traceId): void => {
        traceIds.push(traceId);
        onTraceId(traceId);
      },
      toEvidenceParts: ({fileFilter}) => toInputJudgeParts({
        evidence,
        fileFilter,
      }),
    });
    const issues = await this.runRules({
      stage: ERuleStage.INPUT,
      rules: this.builtInInputRules,
      evidence,
      makeJudge,
      abortSignal,
    });
    if (!hasError(issues)) {
      issues.push(...await this.runRules({
        stage: ERuleStage.INPUT,
        rules: this.inputRules,
        evidence,
        makeJudge,
        abortSignal,
      }));
    }

    return {
      prompt: evidence.prompt,
      issues,
      ok: !hasError(issues),
      traceIds,
    };
  }

  /**
   * checkOutput -- screens the answer after the model call
   *
   * # About
   *
   * > Truncation and schema first, the app's rules only when those passed.
   *
   * Flags a `finishReason` LENGTH as the WARNING `output_truncated` and, with a schema, parses the output against it with
   * `parseStructured`. Only when no ERROR came out of that, the app's `outputRules` run in parallel on the parsed value (or
   * the text) with the evidence of the call: the question, the KB chunks, the tool results, the user context, the profile and
   * the thread. Returns the parsed value, every issue stamped with its rule's name, `ok` and the trace ids of the judge calls,
   * which the gateway annotates with the issues (D73). The call's `abortSignal` reaches every rule and its judge call; an
   * aborted call rejects with the signal's reason, not with a `rule_error` (D90).
   *
   * # Who needs it
   *
   * `checkOutput` of the orchestration, on the answer of every `ask` and of every run that ended with text (`settleRun`).
   */
  public async checkOutput<TStructured = unknown>(
    {
      result,
      schema,
      prompt,
      chunks,
      toolResults,
      userContext,
      profile,
      threadId,
      abortSignal,
    }: {
      result: IModelResult;
      /** Zod schema of the expected answer; omit for a free-text answer. */
      schema?: ZodType<TStructured>;
      /** The user's question the answer is for. */
      prompt: string;
      /** The knowledge-base chunks that were in the request. */
      chunks: IChunk[];
      toolResults: IToolResultPart[];
      userContext: IUserContext;
      profile: IAIProfile;
      threadId: string;
      /**
       * The call's signal: merged into every rule's.
       * An aborted call rejects with the signal's reason, no `rule_error`; so does a judge call the usage adapter refused, with that error.
       */
      abortSignal?: AbortSignal;
    },
  ): Promise<IOutputCheck<TStructured>> {
    const issues: IIssue[] = [];
    const traceIds: string[] = [];
    if (result.finishReason === EFinishReason.LENGTH) {
      issues.push({
        code: "output_truncated",
        message: "The model stopped at the output token limit; the answer may be incomplete",
        severity: EIssueSeverity.WARNING,
      });
    }

    let structured: TStructured | undefined;
    if (schema !== undefined) {
      const parsed = this.parseStructured({
        text: result.text,
        structured: result.structured,
        schema,
      });
      structured = parsed.structured;
      issues.push(...parsed.issues);
    }
    if (!hasError(issues)) {
      const evidence: IOutputEvidence = {
        prompt,
        output: structured ?? result.text,
        chunks,
        toolResults,
        userContext,
        profile,
        threadId,
      };
      const meta = this.makeMeta({
        userContext,
        profile,
        threadId,
      });
      const makeJudge: TMakeJudgeHandler<TOutputJudgeHandler> = ({
        abortSignal: ruleSignal,
        onTraceId,
      }) => createJudge({
        llmClient: this.deps.llmClient,
        modelRegistry: this.deps.modelRegistry,
        profile,
        meta,
        abortSignal: ruleSignal,
        onTraceId: (traceId): void => {
          traceIds.push(traceId);
          onTraceId(traceId);
        },
        toEvidenceParts: ({
          chunks: withChunks, toolResults: withToolResults,
        }) => toOutputJudgeParts({
          evidence,
          withChunks,
          withToolResults,
        }),
      });
      issues.push(...await this.runRules({
        stage: ERuleStage.OUTPUT,
        rules: this.outputRules,
        evidence,
        makeJudge,
        abortSignal,
      }));
    }

    return {
      structured,
      issues,
      ok: !hasError(issues),
      traceIds,
    };
  }

  /**
   * parseStructured -- the schema check of an answer, on its own
   *
   * # About
   *
   * > Text in, the typed value or the issue out; no rule runs.
   *
   * The model's own structured value is taken when it gave one, else the text is parsed as JSON; the result is validated
   * against the schema. A text that is not JSON is `output_invalid_json`, a value the schema rejects is `output_schema`
   * (with the first failing field), both ERROR; `structured` is then absent.
   *
   * # Who needs it
   *
   * `checkOutput`, before the output rules; `AIGateway.resume`, on the text a reviewer edited (D99), which must still match
   * the schema the run was started with but is not screened by the rules.
   */
  public parseStructured<TStructured>(
    {
      text,
      structured,
      schema,
    }: {
      text: string;
      /** The structured value the model returned itself, when any; it is validated instead of the text. */
      structured?: unknown;
      schema: ZodType<TStructured>;
    },
  ): {
    structured?: TStructured;
    issues: IIssue[];
  } {
    let candidate: unknown = structured;
    if (candidate === undefined) {
      try {
        candidate = JSON.parse(text);
      }
      catch {
        return {
          issues: [{
            code: "output_invalid_json",
            message: "The model output is not valid JSON",
            severity: EIssueSeverity.ERROR,
          }],
        };
      }
    }

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        issues: [{
          code: "output_schema",
          message: `The model output does not match the schema: ${first?.message ?? "unknown"}`,
          severity: EIssueSeverity.ERROR,
          field: first?.path.map(String).join("."),
        }],
      };
    }
    return {
      structured: parsed.data,
      issues: [],
    };
  }

  /** The meta of one check's judge calls: tenant, user, profile, thread, kind GUARDRAIL_JUDGE. */
  private makeMeta(
    {
      userContext,
      profile,
      threadId,
    }: {
      userContext: IUserContext;
      profile: IAIProfile;
      threadId?: string;
    },
  ): ILLMClientCallMeta {
    return {
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      profileId: profile.id,
      threadId,
      kind: ETraceKind.GUARDRAIL_JUDGE,
    };
  }

  /** Runs the rules in parallel; the issues come back in rule order, stamped with the rule's name. */
  private async runRules<TEvidence extends IInputEvidence | IOutputEvidence, TJudge>(
    {
      stage,
      rules,
      evidence,
      makeJudge,
      abortSignal,
    }: {
      stage: ERuleStage;
      rules: IRule<TEvidence, TJudge>[];
      evidence: TEvidence;
      makeJudge: TMakeJudgeHandler<TJudge>;
      abortSignal?: AbortSignal;
    },
  ): Promise<IIssue[]> {
    abortSignal?.throwIfAborted();
    const results = await Promise.all(rules.map(rule => this.runRule({
      stage,
      rule,
      evidence,
      makeJudge,
      abortSignal,
    })));
    return results.flat();
  }

  /**
   * One rule under its timeout, with its own judge: a judge call in flight is aborted with the rule. A throw or a
   * timeout becomes the ERROR issue `rule_error`; the error itself goes to the server log and to `onRuleError` only,
   * because issues reach the caller (and maybe the end user) and the trace.
   * The call's `abortSignal` is merged into the rule's: an aborted call throws the signal's reason, not a `rule_error`, unlogged.
   * A judge call the usage adapter refused throws that error the same way: the app's no is not the rule's failure.
   */
  private async runRule<TEvidence extends IInputEvidence | IOutputEvidence, TJudge>(
    {
      stage,
      rule,
      evidence,
      makeJudge,
      abortSignal,
    }: {
      stage: ERuleStage;
      rule: IRule<TEvidence, TJudge>;
      evidence: TEvidence;
      makeJudge: TMakeJudgeHandler<TJudge>;
      abortSignal?: AbortSignal;
    },
  ): Promise<IIssue[]> {
    const timeoutMs = rule.timeoutMs ?? this.ruleTimeoutMs;
    const startedAt = Date.now();
    const traceIds: string[] = [];
    const fail = (failure: ERuleFailure, issue: IIssue, error?: unknown): IIssue[] => {
      this.reportFailure({
        tenantId: evidence.userContext.tenantId,
        userContext: evidence.userContext,
        ...evidence.threadId === undefined ? {} : {threadId: evidence.threadId},
        stage,
        ruleName: rule.name,
        failure,
        ...error === undefined ? {} : {error},
        issue,
        evidence,
        traceIds,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        at: new Date(),
      });
      return [issue];
    };
    const controller = new AbortController();
    const ruleSignal = abortSignal
      ? AbortSignal.any([abortSignal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<typeof ABORTED>(resolve => {
      if (!abortSignal) return;
      onAbort = (): void => resolve(ABORTED);
      abortSignal.addEventListener("abort", onAbort, {once: true});
    });
    try {
      const issues = await Promise.race([
        rule.check({
          evidence,
          abortSignal: ruleSignal,
          judge: makeJudge({
            abortSignal: ruleSignal,
            onTraceId: traceId => traceIds.push(traceId),
          }),
        }),
        timeout,
        aborted,
      ]);
      if (issues === ABORTED) throw abortSignal?.reason;
      if (issues === null) {
        controller.abort();
        console.error(`Internal error 5373906148950: Guardrails: rule [${rule.name}] gave no answer within ${timeoutMs} ms`);
        return fail(ERuleFailure.TIMED_OUT, this.makeRuleError(rule.name, `did not answer within ${timeoutMs} ms`));
      }
      return issues.map(issue => ({
        ...issue,
        ruleName: rule.name,
      }));
    }
    catch (error) {
      // The call was stopped: its reason is what the caller gets, whatever the rule threw on the way out
      if (abortSignal?.aborted) {
        if (error !== abortSignal.reason) {
          console.error(`Internal error 5376412760063: Guardrails: the call was aborted but rule [${rule.name}] failed with another error`, error);
        }
        throw abortSignal.reason;
      }
      if (isUsageDeniedError(error)) throw error;
      console.error(`Internal error 5373906148953: Guardrails: rule [${rule.name}] failed`, error);
      return fail(ERuleFailure.THREW, this.makeRuleError(rule.name, "failed"), error);
    }
    finally {
      clearTimeout(timer);
      if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Hands a failed rule to `onRuleError` without waiting; nothing without a handler.
   * A handler that throws or rejects is logged and ignored: the check never feels it.
   */
  private reportFailure(report: IRuleErrorReport): void {
    if (!this.onRuleError) return;
    const logHandlerFailure = (handlerError: unknown): void => console.error(`Internal error 5376512834017: Guardrails: the onRuleError handler failed for rule [${report.ruleName}]`, handlerError);
    try {
      Promise.resolve(this.onRuleError(report)).catch(logHandlerFailure);
    }
    catch (handlerError) {
      logHandlerFailure(handlerError);
    }
  }

  /** The ERROR issue `rule_error` of a rule that threw or timed out; `what` says which. */
  private makeRuleError(ruleName: string, what: string): IIssue {
    return {
      code: "rule_error",
      message: `The check [${ruleName}] ${what}`,
      severity: EIssueSeverity.ERROR,
      ruleName,
    };
  }

  /** Throws when two rules share a name: an issue must point at one rule. */
  private assertUniqueNames(rules: {name: string}[]): void {
    const seen = new Set<string>();
    for (const {name} of rules) {
      if (seen.has(name)) {
        throw dynaError({
          code: 5373891090405,
          status: 400,
          message: `Guardrails: a rule named [${name}] already exists`,
          data: {name},
        });
      }
      seen.add(name);
    }
  }
}
