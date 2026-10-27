import {ZodType} from "zod";

import {
  IChunk,
  IFileRef,
  IIssue,
  IToolResultPart,
  IUserContext,
} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";
import {
  IInlineFilePart,
  ILLMClient,
  IModelResult,
} from "../llm-client";
import {IModelRegistry} from "../model-registry";

/** Configuration of the Guardrails. Lands in IAIGatewayConfig.guardrails. Fixed at construction: other rules need a new gateway. */
export interface IGuardrailsConfig {
  /** Reject longer prompts. Default 20_000. */
  maxPromptChars?: number;
  /** Time a rule may take before it counts as failed (ERROR `rule_error`); a rule's own timeoutMs wins. Default 10_000. */
  ruleTimeoutMs?: number;
  /**
   * The app's rules on the prompt (moderation, a topic filter, …). They run after the built-in rules (prompt not empty,
   * not over maxPromptChars, no prompt-injection markers) and only when those passed. An ERROR issue returns FAILED and
   * the prompt is not stored. Names are unique, also against the built-in rules. Default none.
   */
  inputRules?: IInputRule[];
  /**
   * The app's rules on the answer (business checks such as sums or ids, grounding, moderation). They run after the
   * built-in output checks (schema, truncation) and only when those passed. An ERROR issue returns FAILED and the answer
   * is not stored (in a run, the tool turns stay: the tools did run, D70). Names are unique. Default none.
   */
  outputRules?: IOutputRule[];
  /**
   * The developer's channel for failed rules: a rule threw (its own code, its service, a judge that answered out of shape) or
   * gave no answer within its timeout.
   *
   * > One place to log, count or alert on broken rules, instead of a callback on every rule.
   *
   * Called once per failed rule, built-in rules included, fire-and-forget: the check never waits for it, and a handler that
   * throws is logged and ignored. With or without a handler, every failure is logged on the server, and the caller gets only
   * the short ERROR issue `rule_error` (`IRuleErrorReport.issue`). Never called for a call the caller aborted, nor for a judge
   * call the usage adapter refused: neither is a failure of the rule.
   *
   * @example report => logger.error({rule: report.ruleName, stage: report.stage, failure: report.failure, error: report.error}) - one log line per broken rule, with the error the caller never sees
   */
  onRuleError?: TOnRuleErrorHandler;
}

/**
 * What the Guardrails hold: the judge of the rules calls the model through the one client, so it is checked, reported and traced,
 * and reads the model's caps from the registry (a temperature only where the model takes one, D82).
 */
export interface IGuardrailsDeps {
  llmClient: ILLMClient;
  modelRegistry: IModelRegistry;
}

/**
 * Checks around a model call: the gateway's built-in rules, then the app's. Rules are fixed at construction.
 *
 * Implemented by `Guardrails`; the type of `IAIGatewayDeps.guardrails`, so a host may pass its own in `overrides`.
 */
export interface IGuardrails {
  /**
   * Sanitises the user prompt (trims, normalises line endings) and screens it before the call: the built-in rules
   * (not empty unless files come with it, not over maxPromptChars, no prompt-injection marker), then — only when those
   * passed — the app's input rules, in parallel.
   * The call's `abortSignal` reaches every rule and its judge call; an aborted call rejects with the signal's reason (D90).
   */
  checkInput(args: {
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
  }): Promise<IInputCheck>;

  /**
   * Checks the model output: flags truncation (finishReason LENGTH) as a WARNING and, with a schema, parses the output
   * against it — `result.structured`, or the text as JSON when the LLMClient gave no structured value. Then — only when
   * those passed — the app's output rules, in parallel, with the parsed output (or the text) and the evidence of the call.
   * The call's `abortSignal` reaches every rule and its judge call; an aborted call rejects with the signal's reason (D90).
   */
  checkOutput<TStructured = unknown>(args: {
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
  }): Promise<IOutputCheck<TStructured>>;

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
  parseStructured<TStructured>(args: {
    text: string;
    /** The structured value the model returned itself, when any; it is validated instead of the text. */
    structured?: unknown;
    schema: ZodType<TStructured>;
  }): {
    structured?: TStructured;
    issues: IIssue[];
  };
}

/** Which of the profile's models answers a judge call. */
export enum EJudgeModel {
  /** The profile's `modelId`. */
  MAIN = "MAIN",
  /** The profile's `cheapModelId`; falls back to the main model when the profile has none. */
  CHEAP = "CHEAP",
}

/**
 * One classification call for a rule: a cheap, fixed-format model call, reported to the usage adapter and recorded in the trace
 * like every other call. One completion only: no thread, no memory, no templates, no tools and no guardrails on itself.
 * The evidence of the check goes with it, the rule does not pass it: an input rule's judge sends the prompt, an output
 * rule's judge sends the question and the answer; the call's own arguments add files, KB chunks or tool results.
 * The call is aborted with the rule's `abortSignal` (its timeout).
 * Returns the issues the model found (empty = pass); the rule returns them as they are or maps them.
 * Throws when the model does not answer in the expected shape — the rule then fails as `rule_error`, never passes.
 */
export interface IJudgeArgs {
  /** What to check, e.g. "Does the prompt seek instructions for weapons or explosives?". */
  instruction: string;
  /** Default CHEAP. */
  model?: EJudgeModel;
}

/** A judge call of an input rule: the prompt always, plus the files the filter picks. */
export interface IInputJudgeArgs extends IJudgeArgs {
  /** The files of the prompt sent with their bytes, e.g. `file => file.mime.startsWith("image/")`; `() => false` for none. */
  fileFilter: (file: IFileRef) => boolean;
}

/** A judge call of an output rule: the question and the answer always, plus what is switched on. */
export interface IOutputJudgeArgs extends IJudgeArgs {
  /** Send the KB chunks that were in the prompt (grounding). */
  chunks: boolean;
  /** Send the tool results of the run. */
  toolResults: boolean;
}

/** The judge of an input rule. */
export type TInputJudgeHandler = (args: IInputJudgeArgs) => Promise<IIssue[]>;

/** The judge of an output rule. */
export type TOutputJudgeHandler = (args: IOutputJudgeArgs) => Promise<IIssue[]>;

/** One rule on the prompt, before the model call. */
export interface IInputRule {
  /** Machine name, e.g. "moderation"; stamped on its issues as `ruleName`. */
  name: string;
  /** Overrides IGuardrailsConfig.ruleTimeoutMs for this rule. */
  timeoutMs?: number;
  /**
   * Returns issues; empty array = pass. The app's rules run in parallel. A throw, or no answer within the timeout, becomes
   * the ERROR issue `rule_error` (the error is logged on the server and reported to `IGuardrailsConfig.onRuleError`).
   * `abortSignal` is aborted at the timeout.
   */
  check(args: {
    evidence: IInputEvidence;
    abortSignal: AbortSignal;
    /** Asks a model, for rules that classify (moderation, topic scope). */
    judge: TInputJudgeHandler;
  }): Promise<IIssue[]>;
}

/** Everything an input rule may inspect. */
export interface IInputEvidence {
  /** Sanitised prompt (trimmed, normalised). */
  prompt: string;
  /** The files of the prompt (pointers). */
  files: IFileRef[];
  /** The same files with their bytes, in the order of `files`; the judge sends the ones its `fileFilter` picks. */
  inlineFiles: IInlineFilePart[];
  userContext: IUserContext;
  /** The profile of the call. */
  profile: IAIProfile;
  /** The thread of the call; undefined when the call creates a new thread (it does not exist yet). */
  threadId?: string;
}

/** One rule on the answer, after the model call. */
export interface IOutputRule {
  /** Machine name, e.g. "invoice_sum"; stamped on its issues as `ruleName`. */
  name: string;
  /** Overrides IGuardrailsConfig.ruleTimeoutMs for this rule. */
  timeoutMs?: number;
  /**
   * Returns issues; empty array = pass. The app's rules run in parallel. A throw, or no answer within the timeout, becomes
   * the ERROR issue `rule_error` (the error is logged on the server and reported to `IGuardrailsConfig.onRuleError`).
   * `abortSignal` is aborted at the timeout.
   */
  check(args: {
    evidence: IOutputEvidence;
    abortSignal: AbortSignal;
    /** Asks a model, for rules that classify (moderation, grounding). */
    judge: TOutputJudgeHandler;
  }): Promise<IIssue[]>;
}

/** Everything an output rule may inspect. */
export interface IOutputEvidence {
  /** The user's question the answer is for (sanitised). */
  prompt: string;
  /** The parsed answer when an outputSchema was given, otherwise the answer's text. */
  output: unknown;
  /** KB chunks that were in the prompt. */
  chunks: IChunk[];
  /** Tool results of this run. */
  toolResults: IToolResultPart[];
  userContext: IUserContext;
  /** The profile of the call. */
  profile: IAIProfile;
  threadId: string;
}

/** Result of the input check. */
export interface IInputCheck {
  /** Sanitised prompt (trimmed, normalised). */
  prompt: string;
  issues: IIssue[];
  /** False when an ERROR issue exists. */
  ok: boolean;
  /** The trace entries of the judge calls this check made (kind GUARDRAIL_JUDGE); the gateway annotates them with the issues (D73). */
  traceIds: string[];
}

/** Result of the output check. */
export interface IOutputCheck<TStructured = unknown> {
  /** The parsed value; present when a schema was given and the output matches it. */
  structured?: TStructured;
  issues: IIssue[];
  /** False when an ERROR issue exists. */
  ok: boolean;
  /** The trace entries of the judge calls this check made (kind GUARDRAIL_JUDGE); the gateway annotates them with the issues (D73). */
  traceIds: string[];
}

/**
 * Called once per failed rule with everything the Guardrails know about it.
 *
 * The handler of `IGuardrailsConfig.onRuleError`; the return value is ignored and a thrown error is logged, never felt by the check.
 */
export type TOnRuleErrorHandler = (report: IRuleErrorReport) => void | Promise<void>;

/** Which check a rule belongs to. */
export enum ERuleStage {
  /** A rule on the prompt, before the model call (`IGuardrailsConfig.inputRules` and the built-in ones). */
  INPUT = "INPUT",
  /** A rule on the answer, after the model call (`IGuardrailsConfig.outputRules`). */
  OUTPUT = "OUTPUT",
}

/** How a rule failed. */
export enum ERuleFailure {
  /**
   * The rule's `check` threw or rejected.
   *
   * > Its own code, the service behind it, or its judge (a model call that failed or answered out of shape).
   */
  THREW = "THREW",
  /** The rule gave no answer within its timeout (`IInputRule.timeoutMs` or `IGuardrailsConfig.ruleTimeoutMs`). */
  TIMED_OUT = "TIMED_OUT",
}

/**
 * Everything the Guardrails know about one failed rule. Written for the developer, so nothing is held back; the caller of the
 * gateway gets only `issue`.
 *
 * Handed to `IGuardrailsConfig.onRuleError` by the Guardrails, once per failed rule, right after the failure became the issue.
 */
export interface IRuleErrorReport {
  /** Tenant of the call. */
  tenantId: string;
  /** Who was calling. */
  userContext: IUserContext;
  /** Thread of the call; undefined for the input check of a call that creates a new thread (it does not exist yet). */
  threadId?: string;
  /** Which check the rule belongs to; it tells which evidence `evidence` is. */
  stage: ERuleStage;
  /** The rule's `name`, as on `issue.ruleName`. */
  ruleName: string;
  /** How the rule failed. */
  failure: ERuleFailure;
  /** The error as the rule threw it, untouched; undefined when the rule timed out. */
  error?: unknown;
  /**
   * The ERROR issue `rule_error` the caller got for this failure.
   *
   * > The key into the rest of the record: the response's `issues` and the annotated judge trace entries carry it (D73).
   */
  issue: IIssue;
  /** What the rule was checking: an `IInputEvidence` on the INPUT stage, an `IOutputEvidence` on the OUTPUT stage. */
  evidence: IInputEvidence | IOutputEvidence;
  /**
   * The trace entries of the judge calls this rule made before it failed (kind GUARDRAIL_JUDGE).
   *
   * > A judge that answered out of shape: the entry holds the request and the model's answer.
   */
  traceIds: string[];
  /** The timeout the rule ran under, its own or the default. */
  timeoutMs: number;
  /** Time from the start of the rule to the failure. */
  durationMs: number;
  /** When the failure was recorded. */
  at: Date;
}
