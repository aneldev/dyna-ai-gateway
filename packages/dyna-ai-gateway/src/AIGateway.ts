import {dynaError} from "dyna-error";
import {ZodType} from "zod";

import {
  IFileRef,
  IPage,
  IPageArgs,
  IToolDef,
  ITurn,
  IUserContext,
  EPartKind,
} from "./contracts";

import {
  IAIProfile,
  IAIProfileStore,
  IInputCheck,
  IKbIngestor,
  IModelRegistry,
  IModelRequest,
  IModelResult,
  IPromptTemplateStore,
  IResumeDecision,
  IRun,
  IThread,
  IToolRegistry,
  ITrace,
  IUsageGuard,
  IUserMemoryFact,
  IWorkingMemoryState,
  EMessageRole,
  EPauseKind,
  EResumeAction,
  ERunStatus,
  ETraceKind,
  isUsageDeniedError,
  joinSystem,
} from "./internal";

import {
  IBackgroundTasks,
  IInFlightCalls,
  IUserCalls,
  EForgetUserMode,
  TOnCallEventHandler,
  ICallSignal,
  ICheckedOutput,
  abortReason,
  annotateJudgeTraces,
  annotateTraces,
  appendTurns,
  checkOutput,
  closeRun,
  createBackgroundTasks,
  createInFlightCalls,
  createUserCalls,
  createGatewayDeps,
  createRunHooks,
  emitAnswerWithdrawn,
  findPrompt,
  forgetUser,
  getBuiltInToolNames,
  getOwnThread,
  isFailedResponse,
  makeOwnerKey,
  makeAbortedResponse,
  makeCallSignal,
  makeFailedResponse,
  makeUsageDeniedResponse,
  prepareCall,
  resetThreadMemory,
  restoreInlineBytes,
  settleRun,
  settleReview,
  parseEditedAnswer,
  splitRunTools,
  startCall,
  updateMemory,
  withThreadLease,
  withoutReviewedAnswer,
} from "./orchestration";

import {
  IAIGatewayConfig,
  IAIGatewayDeps,
  IAIGatewayOverrides,
  IDeleteArgs,
  IDeleteResult,
  IForgetUserResult,
  IFailedResponse,
  IGatewayCall,
  IGatewayAskInput,
  IGatewayRunInput,
  IPausedRunSummary,
  TGatewayResponse,
  EGatewayResponseKind,
} from "./types";
import {deleteThreads} from "./utils/deleteThreads";

/**
 * AIGateway -- the facade of the gateway and its composition root
 *
 * # About
 *
 * > One object the application talks to; every child of the gateway behind it.
 *
 * Creates every child once from `IAIGatewayConfig` (through `createGatewayDeps`), injects the shared instances, and runs a
 * call as a sequence of child calls: no prompt text, no token math, no SDK of its own.
 *
 * - Three calls:
 *   - `ask` (one grounded answer, no tools)
 *   - `run` (an agent run with tools, may pause for a human),
 *   - `resume` (continues a paused run with the human's decisions). The three return at once with an `IGatewayCall`: `events` to
 *   stream, `response` to await (D38).
 * - Thread, file and memory management for the UI (`listThreads`, `getTurns`, `uploadFile`, `getUserFacts`, …), the
 *   erasure of a user (`deleteUserData`, `anonymizeUserData`) and of conversations (`delete`), the scheduled jobs
 *   (`expirePausedRuns`, `recoverStuckRuns`) and a graceful `shutdown`.
 * - The admin surfaces as getters (`modelRegistry`, `aiProfileStore`, `promptTemplateStore`, `toolRegistry`, `trace`,
 *   `usageGuard`) and the second root, `kbIngestor`, for the knowledge-base write endpoints.
 *
 * The host application constructs one per process and keeps it: the children hold caches, the background work and the
 * calls in flight.
 *
 * # Who needs it
 *
 * The host application: its HTTP handlers for the chat, the approval screens and the admin pages; its scheduled jobs; its
 * SIGTERM handler. Nothing inside the gateway calls the facade.
 *
 * # What needs
 *
 * `IAIGatewayConfig`: one config per child, with the repositories and adapters the host implements (or the in-memory ones,
 * for tests and the first run). Optionally `IAIGatewayOverrides`: a factory per child the host replaces (tests: a fake
 * `llmClient`).
 *
 * # Usage
 *
 * ## When to use it
 *
 * `ask` for a question an answer settles: a summary, a classification, a grounded reply over the knowledge base, a
 * structured extraction (`outputSchema`). `run` when the model may act through tools, pause for an approval or a question
 * to the user, and the answer may be reviewed. `resume` from the request that carries the human's decision, often from
 * another user than the asker.
 *
 * ## When shouldn't use it
 *
 * Not for writing documents into the knowledge base: that is `kbIngestor`. Not from inside a tool: a tool receives the
 * user context and the thread id and talks to the application's own services.
 *
 * # Pitfalls
 *
 * One call at a time on a thread (D77): a second `ask` / `run` on a thread with a call in flight is a 409; keep every call's
 * `timeoutMs` at or under `IThreadStoreConfig.leaseMs`. `response` resolves FAILED for what the call could not do (a
 * rejected prompt, a blocked answer, a refused model call, an abort, a timeout, D90) and rejects for what the caller got
 * wrong (an unknown profile or thread, another user's thread, a thread that waits for a human) or a provider failure.
 * Call `shutdown` before the process ends, or `whenIdle` in tests: the memory updates run in the background after an answer.
 */
export class AIGateway {
  private readonly deps: IAIGatewayDeps;
  private readonly background: IBackgroundTasks = createBackgroundTasks();
  private readonly userCalls: IUserCalls = createUserCalls();
  private readonly inFlightCalls: IInFlightCalls = createInFlightCalls();
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly config: IAIGatewayConfig,
    /** Factories for the deps the host builds itself; each gets its dep's config and deps (tests: `{llmClient: () => fake}`). */
    overrides: IAIGatewayOverrides = {},
  ) {
    this.deps = createGatewayDeps({
      config,
      overrides,
    });
  }

  /**
   * ask -- one grounded answer, no tools
   *
   * # About
   *
   * > A question in, an answer out, streamed while it is written.
   *
   * Returns at once (D38): `events` streams the answer, `response` is the final ANSWER or FAILED. The call screens the
   * prompt (guardrails), stores the user turn, searches the knowledge base within `kbFilters`, builds the request with the
   * thread's memory and the user's facts, calls the model once, checks the answer, stores it and annotates the trace; the
   * memory updates follow in the background.
   *
   * - `response` is FAILED when the prompt is rejected, the answer does not pass the checks (a failed answer is not stored),
   *   the usage adapter refuses the model call, or `abortSignal` / `timeoutMs` stop the call (D90). Nothing is thrown for
   *   those.
   * - `response` rejects with the `dynaError` of a child for what the caller got wrong or the provider broke: an unknown
   *   profile, thread or model, another user's thread (404), a thread that waits for a human or has a call in flight (409),
   *   a provider failure.
   *
   * The path: `makeCallSignal` → `getOwnThread` → the thread's lease (`withThreadLease`) → `prepareCall` →
   * `LLMClient.complete` → `checkOutput` → the assistant turn → the response → `scheduleMemory`.
   *
   * # Who needs it
   *
   * The host's chat endpoint for a conversation without tools, and every feature that needs one answer from the model over
   * the knowledge base: a summary button, an extraction with `outputSchema`, a classification.
   *
   * # What needs
   *
   * A profile the tenant has (`profileId`, required, D103), a `kbFilters` scope (an empty `libraryIds` = no search), and for
   * `files` the pointers `uploadFile` returned to the calling user.
   *
   * # Usage
   *
   * ## When to use it
   *
   * The answer is the whole job: nothing has to be looked up through a tool, nobody has to approve anything.
   *
   * ## When shouldn't use it
   *
   * `run` when the model should act (tools), when a human may have to approve a step or review the answer, or when
   * "remember this" must be acted on at once: `ask` has no tools, so the user memory grows only from the background
   * extraction (after the first answer, then every `extractEveryTurns` turns).
   *
   * # Pitfalls
   *
   * Read `events` before the first `await` when you stream (`const {events, response} = gateway.ask(input)`): the stream is
   * collected from its first access. The user turn is stored even when the answer fails. The thread is locked for the
   * duration of the call (D77).
   */
  public ask<TStructured = unknown>(input: IGatewayAskInput<TStructured>): IGatewayCall<TStructured> {
    return startCall({
      execute: this.asInFlightCall(({
        onEvent,
        shutdownSignal,
      }): Promise<TGatewayResponse<TStructured>> => this.asUserCall({
        tenantId: input.userContext.tenantId,
        userIds: [input.userContext.userId],
      }, async (): Promise<TGatewayResponse<TStructured>> => {
        // The signal first: a call already given up, or a bad deadline, never takes the thread's lease
        const callSignal = makeCallSignal({
          abortSignal: input.abortSignal,
          timeoutMs: input.timeoutMs,
          shutdownSignal,
        });
        if (callSignal?.signal.aborted) {
          return makeAbortedResponse({
            threadId: input.threadId,
            callSignal,
          });
        }
        // Another user's thread is a 404 before the lease (D32): a busy thread of someone else is never a 409 that tells it exists
        if (input.threadId) {
          await getOwnThread({
            deps: this.deps,
            userContext: input.userContext,
            threadId: input.threadId,
          });
        }
        return withThreadLease({
          deps: this.deps,
          tenantId: input.userContext.tenantId,
          threadId: input.threadId,
          run: () => this.executeAsk({
            input,
            callSignal,
            onEvent,
          }),
        });
      })),
    });
  }

  /**
   * The work of `ask` under the thread's lease: `prepareCall`, one model call, the output checks, the assistant turn, the
   * response, the memory in the background. Answers FAILED for an abort or a refused model call, rethrows the rest.
   */
  private async executeAsk<TStructured>(
    {
      input,
      callSignal,
      onEvent,
    }: {
      input: IGatewayAskInput<TStructured>;
      callSignal?: ICallSignal;
      onEvent: TOnCallEventHandler;
    },
  ): Promise<TGatewayResponse<TStructured>> {
    const signal = callSignal?.signal;
    // The thread the response of an abort names: the input's until the call has its own
    let threadId = input.threadId;
    try {
      const prepared = await prepareCall({
        deps: this.deps,
        config: this.config,
        input,
        withTools: false,
        callSignal,
      });
      if (isFailedResponse(prepared)) return prepared;
      const {
        profile,
        thread,
        context,
        issues,
        chunks,
      } = prepared;
      const {userContext} = input;
      const {tenantId} = userContext;
      threadId = thread.id;

      // 7. The model, streaming on the call's events
      const result = await this.deps.llmClient.complete({
        request: context.request,
        meta: {
          tenantId,
          userId: userContext.userId,
          profileId: profile.id,
          threadId: thread.id,
          kind: ETraceKind.CHAT,
        },
        hooks: {onEvent},
        abortSignal: signal,
      });

      // 8. Output checks
      let checked: ICheckedOutput<TStructured>;
      try {
        checked = await checkOutput({
          deps: this.deps,
          result,
          outputSchema: input.outputSchema,
          prompt: findPrompt({messages: context.request.messages}),
          userContext,
          profile,
          threadId: thread.id,
          chunks,
          toolResults: [],
          issues,
          abortSignal: signal,
        });
      }
      catch (error) {
        // Aborted, or an output judge's call refused by the usage adapter: the answer nobody checked is not shown
        const failed = this.failedResponseOrThrow({
          error,
          callSignal,
          threadId: thread.id,
        });
        await annotateTraces({
          deps: this.deps,
          tenantId,
          traceIds: [result.traceId],
          chunkIds: context.chunkIds,
          issues: [...issues, ...failed.issues],
          templateVersion: context.templateVersion,
        });
        // The answer was already streamed: the stream withdraws it, as for a blocked one (D74)
        emitAnswerWithdrawn({
          onEvent,
          issues: failed.issues,
        });
        return failed;
      }
      await annotateTraces({
        deps: this.deps,
        tenantId,
        traceIds: [result.traceId],
        chunkIds: context.chunkIds,
        issues: checked.issues,
        templateVersion: context.templateVersion,
      });
      await annotateJudgeTraces({
        deps: this.deps,
        tenantId,
        traceIds: checked.traceIds,
        issues: checked.issues,
      });
      if (!checked.ok) {
        emitAnswerWithdrawn({
          onEvent,
          issues: checked.issues,
        });
      }

      // 9. The assistant turn; a failed answer is not stored
      if (checked.ok) {
        await appendTurns({
          deps: this.deps,
          tenantId,
          threadId: thread.id,
          turns: this.deps.turnBuilder.buildAssistantTurns({result}),
        });
      }

      // 10. The response
      const response: TGatewayResponse<TStructured> =
        checked.ok
          ? {
            kind: EGatewayResponseKind.ANSWER,
            threadId: thread.id,
            text: result.text,
            structured: checked.structured,
            citations: context.chunkIds,
            issues: checked.issues,
            usage: result.usage,
            ...input.debug && {
              debug: {
                system: joinSystem({blocks: context.request.system}),
                messages: [
                  ...context.request.messages,
                  {
                    role: EMessageRole.ASSISTANT,
                    parts: [
                      {
                        kind: EPartKind.TEXT,
                        text: result.text,
                      },
                    ],
                  },
                ],
                steps: 1,
              },
            },
          }
          : makeFailedResponse({
            threadId: thread.id,
            reason: "The answer did not pass the checks",
            issues: checked.issues,
          });
      // 11. Memory, in the background
      if (checked.ok) {
        this.scheduleMemory({
          userContext,
          threadId: thread.id,
          profile,
          previousTurnCount: thread.turnCount,
          request: context.request,
          result,
        });
      }
      return response;
    }
    catch (error) {
      return this.failedResponseOrThrow({
        error,
        callSignal,
        threadId,
      });
    }
  }

  /**
   * run -- an agent run with tools; may pause for a human
   *
   * # About
   *
   * > The model works the task through the tools until it answers, a tool ends the run, or a human has to step in.
   *
   * Returns at once (D38): `events` streams the run (text, tool requests and results, step ends, a pause), `response` is the
   * final ANSWER, PAUSED or FAILED. The model sees the tools the `ToolPolicy` resolves for the profile, the user's
   * permissions and the call (`activeTools`, `additionalTools`); every step goes through the usage adapter. A tool whose
   * policy says NEEDS_APPROVAL, a question the model asks the user and, on a profile with `reviewAnswers` (D99), the
   * finished answer pause the run: it is stored, the thread waits for a human, and `resume` continues it.
   *
   * - The tool turns a run produced (tool requests, tool results) are stored even when the final answer fails the checks,
   *   because the tools did run; the failed answer itself is not stored (D70).
   * - `abortSignal` / `timeoutMs` stop the call (D90): the model call and the tool in flight are aborted, the response is
   *   FAILED with the reason, the steps that completed are stored, a tool call the abort cut gets an error result, and a
   *   paused run is never created.
   * - `response` rejects as in `ask` for what the caller got wrong; a tool name outside what the profile and the
   *   permissions allow is a 400 before anything is stored (D48).
   *
   * The path is `ask`'s with `LLMClient.run` in place of `complete`, the hooks of `createRunHooks` (execute a tool, decide
   * a call, narrow the tools of a step) and `settleRun` for the turns, the pause and the response.
   *
   * # Who needs it
   *
   * The host's chat endpoint for an assistant that acts: a support agent with a refund tool, an accounting assistant that
   * posts a credit note after an approval, a form the model fills by asking the user.
   *
   * # What needs
   *
   * As `ask`, plus the tools: registered in `IToolRegistryConfig.tools` or passed as `additionalTools`, allowed by the
   * profile's `allowedTools` and the user's permissions.
   *
   * # Usage
   *
   * ## When to use it
   *
   * The model needs tools, a step may need a human, or the answer must be reviewed before the user sees it.
   *
   * ## When shouldn't use it
   *
   * `ask` for a plain answer: one model call, no tool list in the prompt, and it never pauses.
   *
   * # Pitfalls
   *
   * Keep the PAUSED response's `pauseId` and `envelopes`: `resume` needs one decision per envelope. A paused run holds the
   * thread AWAITING_HUMAN until it is resumed, cancelled or expired (`expirePausedRuns`). `additionalTools` and
   * `outputSchema` are not stored with a paused run: `resume` must receive them again.
   */
  public run<TStructured = unknown>(input: IGatewayRunInput<TStructured>): IGatewayCall<TStructured> {
    return startCall({
      execute: this.asInFlightCall(({
        onEvent,
        shutdownSignal,
      }): Promise<TGatewayResponse<TStructured>> => this.asUserCall({
        tenantId: input.userContext.tenantId,
        userIds: [input.userContext.userId],
      }, async (): Promise<TGatewayResponse<TStructured>> => {
        // The signal first: a call already given up, or a bad deadline, never takes the thread's lease
        const callSignal = makeCallSignal({
          abortSignal: input.abortSignal,
          timeoutMs: input.timeoutMs,
          shutdownSignal,
        });
        if (callSignal?.signal.aborted) {
          return makeAbortedResponse({
            threadId: input.threadId,
            callSignal,
          });
        }
        // Another user's thread is a 404 before the lease (D32): a busy thread of someone else is never a 409 that tells it exists
        if (input.threadId) {
          await getOwnThread({
            deps: this.deps,
            userContext: input.userContext,
            threadId: input.threadId,
          });
        }
        return withThreadLease({
          deps: this.deps,
          tenantId: input.userContext.tenantId,
          threadId: input.threadId,
          run: () => this.executeRun({
            input,
            callSignal,
            onEvent,
          }),
        });
      })),
    });
  }

  /**
   * The work of `run` under the thread's lease: `prepareCall` with the tools, the agent loop with the run hooks, `settleRun`
   * for the turns, the pause and the response, the memory on an ANSWER. Answers FAILED for an abort or a refused model call.
   */
  private async executeRun<TStructured>(
    {
      input,
      callSignal,
      onEvent,
    }: {
      input: IGatewayRunInput<TStructured>;
      callSignal?: ICallSignal;
      onEvent: TOnCallEventHandler;
    },
  ): Promise<TGatewayResponse<TStructured>> {
    const signal = callSignal?.signal;
    // The thread the response of an abort names: the input's until the call has its own
    let threadId = input.threadId;
    try {
      const prepared = await prepareCall({
        deps: this.deps,
        config: this.config,
        input,
        withTools: true,
        callSignal,
      });
      if (isFailedResponse(prepared)) return prepared;
      const {
        profile,
        thread,
        resolved,
        context,
        issues,
        chunks,
      } = prepared;
      const {userContext} = input;
      threadId = thread.id;

      const outcome = await this.deps.llmClient.run({
        request: context.request,
        meta: {
          tenantId: userContext.tenantId,
          userId: userContext.userId,
          profileId: profile.id,
          threadId: thread.id,
          kind: ETraceKind.RUN_STEP,
        },
        tools: resolved.tools,
        hooks: createRunHooks({
          deps: this.deps,
          userContext,
          threadId: thread.id,
          resolved,
          holdText: profile.reviewAnswers === true,
          onEvent,
        }),
        limits: {maxSteps: profile.limits.maxStepsPerRun},
        parallelToolCalls: profile.parallelToolCalls ?? true,
        abortSignal: signal,
      });

      const response = await settleRun({
        deps: this.deps,
        userContext,
        threadId: thread.id,
        profile,
        request: context.request,
        toolNames: resolved.tools.map(tool => tool.name),
        outcome,
        sentMessages: context.request.messages.length,
        outputSchema: input.outputSchema,
        issues,
        templateVersion: context.templateVersion,
        chunks,
        // The thread as prepareCall loaded it: its turnCount is the count before this run's question (D36)
        startTurnCount: thread.turnCount,
        // The call's skills stay with the run (D124): a resume offers them again
        skills: input.skills,
        debug: input.debug,
        onEvent,
        callSignal,
      });
      if (response.kind === EGatewayResponseKind.ANSWER) {
        this.scheduleMemory({
          userContext,
          threadId: thread.id,
          profile,
          previousTurnCount: thread.turnCount,
          request: context.request,
          result: outcome.result,
        });
      }
      return response;
    }
    catch (error) {
      return this.failedResponseOrThrow({
        error,
        callSignal,
        threadId,
      });
    }
  }

  /**
   * resume -- continues a paused run with the human's decisions
   *
   * # About
   *
   * > The human has decided; the run goes on from where it stopped.
   *
   * One decision per envelope of the pause (D102), each named by the envelope's `callId` (a pause of one envelope takes one
   * decision without it). On a tool approval the step continues: APPROVE or EDIT executes the call (an edited input goes
   * through the tool's policy again, D109), REJECT hands the rejection text to the model. On a user question the answers
   * reach the model. On a reviewed answer (D99) no model is called: APPROVE delivers it, EDIT delivers `editedInput` as the
   * new text (parsed through the run's `outputSchema` again), REJECT drops it and the call is FAILED with the reviewer's
   * text as the reason. The run may pause again when a later step needs an approval or its answer is reviewed.
   *
   * - The tools run with the context of the user who resumes (the approver is accountable for them); the run stays the
   *   asker's (D32): the memory extracted after it, its trace entries and the screens of the answer are under the user who
   *   started it.
   * - The run continues on its profile as it is now, or on `profileId` (D65): the model, the output cap, the tools and the
   *   limits come from that profile; the system prompt and the messages so far stay. The review of the answer and the
   *   approvals are those of both profiles (D113): a switch never skips a guard the run started under. The skills the run
   *   kept (D124) and the profile's are offered again through a rebuilt `dyna_aigw_load_skill`; the system prompt keeps the list of
   *   the start.
   * - The free text of an ANSWER goes through the input rules like a prompt (D71): an ERROR returns FAILED and the run
   *   stays paused, so the user can answer again; WARNINGs travel on the response.
   * - A resumed run answers like one that never paused (D36): its answer cites the knowledge-base chunks of its first step,
   *   its trace entries carry the template version, the user's facts are extracted from the whole run.
   * - `abortSignal` / `timeoutMs` stop the resume as they stop a call (D90). An abort during the step closes the run as
   *   FAILED (its open tool call gets an error result, the thread is open again); an abort before the step, while the
   *   answer is screened, leaves the run paused. When the continuation throws, the run is marked FAILED, its pending tool
   *   call is closed in the thread and the thread is opened again.
   *
   * The path: `makeCallSignal` → `RunStore.load` → the thread's lease → `continueRun` (the gate's `matchDecisions`, the
   * profile, the tools, the answer screen, `HumanGate.resume`, `LLMClient.run`, `settleRun`), or `continueReview` for a
   * reviewed answer.
   *
   * # Who needs it
   *
   * The host's endpoint behind the approval card, the user-question form and the reviewer's screen; called from another
   * request than the `run` that paused, and often by another user.
   *
   * # What needs
   *
   * The `runId` and `pauseId` of the PAUSED response (a decision for an earlier pause of the run is a 409, D110), and the
   * same `additionalTools` (D66) and `outputSchema` (D36) the run started with: a stored run keeps neither (a Zod schema is
   * code).
   *
   * # Usage
   *
   * ## When to use it
   *
   * A `run` or an earlier `resume` returned PAUSED and the human has decided.
   *
   * ## When shouldn't use it
   *
   * `cancelRun` drops a paused run without a decision. A new `run` on the thread is refused while the run waits.
   *
   * # Pitfalls
   *
   * A decision that names no envelope, an envelope left without one, an action its envelope does not allow, a pending tool
   * the profile does not allow, a skill name in both the run and the profile, or an EDIT that misses the schema is a 400,
   * and the run stays paused. Without the `outputSchema` a structured run answers in plain text, and an EDIT of a
   * structured reviewed answer is a 400.
   */
  public resume<TStructured = unknown>(
    {
      userContext,
      runId,
      pauseId,
      decisions,
      profileId,
      additionalTools,
      outputSchema,
      debug,
      abortSignal,
      timeoutMs,
    }: {
      userContext: IUserContext;
      runId: string;
      /**
       * The pause the decisions are for: `IPausedResponse.pauseId` (each envelope carries it too). A run can pause again under
       * the same `runId`; a decision for an earlier pause is a 409, so a retried approval never decides the next pause.
       */
      pauseId: string;
      /** One per envelope of the pause (`IPausedResponse.envelopes`), named by its `callId`; one envelope takes one decision without it. */
      decisions: IResumeDecision[];
      /** Continue on another profile (its model, tools, limits); omit for the profile the run started with. */
      profileId?: string;
      /** The tools the run started with (IGatewayRunInput.additionalTools); a run tool that is in neither the registry nor here is a 400. */
      additionalTools?: IToolDef[];
      /**
       * The schema the run started with (IGatewayRunInput.outputSchema), handed in again: a stored run keeps none (D36).
       *
       * > Types `structured` of the resumed answer, as on `run()`.
       *
       * Omit it for a run started without one. Without it a structured run answers in plain text, and an EDIT of a structured
       * reviewed answer is a 400.
       */
      outputSchema?: ZodType<TStructured>;
      /** Attach the transcript to the answer, as IGatewayAskInput.debug. */
      debug?: boolean;
      /** Stops the resume when aborted, as IGatewayAskInput.abortSignal. */
      abortSignal?: AbortSignal;
      /** Deadline of the resume in milliseconds, as IGatewayAskInput.timeoutMs. */
      timeoutMs?: number;
    },
  ): IGatewayCall<TStructured> {
    return startCall({
      execute: this.asInFlightCall(({
        onEvent,
        shutdownSignal,
      }): Promise<TGatewayResponse<TStructured>> => this.executeResume({
        userContext,
        runId,
        pauseId,
        decisions,
        profileId,
        additionalTools,
        outputSchema,
        debug,
        abortSignal,
        timeoutMs,
        shutdownSignal,
        onEvent,
      })),
    });
  }

  /**
   * The outer half of `resume`: the call signal first (a bad deadline never reads the run), the run loaded, then the lease on
   * its thread and `continueRun`. Runs as a call of the resumer and the asker both: the tools act for the one, the run
   * writes the other's data.
   */
  private async executeResume<TStructured>(
    {
      userContext,
      runId,
      pauseId,
      decisions,
      profileId,
      additionalTools = [],
      outputSchema,
      debug = false,
      abortSignal,
      timeoutMs,
      shutdownSignal,
      onEvent,
    }: {
      userContext: IUserContext;
      runId: string;
      pauseId: string;
      decisions: IResumeDecision[];
      profileId?: string;
      additionalTools?: IToolDef[];
      outputSchema?: ZodType<TStructured>;
      onEvent: TOnCallEventHandler;
      debug?: boolean;
      abortSignal?: AbortSignal;
      timeoutMs?: number;
      shutdownSignal: AbortSignal;
    },
  ): Promise<TGatewayResponse<TStructured>> {
    const {tenantId} = userContext;
    // The signal first: a bad deadline is refused before the run is read
    const callSignal = makeCallSignal({
      abortSignal,
      timeoutMs,
      shutdownSignal,
    });
    const paused = await this.deps.runStore.load({
      tenantId,
      runId,
    });
    // The resumer and the asker both: the run writes the asker's data, the tools act for the resumer
    return this.asUserCall({
      tenantId,
      userIds: [userContext.userId, paused.userId],
    }, async (): Promise<TGatewayResponse<TStructured>> => {
      // A resume already given up never takes the thread's lease; the run stays as it is
      if (callSignal?.signal.aborted) {
        return makeAbortedResponse({
          threadId: paused.threadId,
          callSignal,
        });
      }
      return withThreadLease({
        deps: this.deps,
        tenantId,
        threadId: paused.threadId,
        run: () => this.continueRun({
          paused,
          userContext,
          pauseId,
          decisions,
          profileId,
          additionalTools,
          outputSchema,
          debug,
          callSignal,
          onEvent,
        }),
      });
    });
  }

  /**
   * The work of `resume` under the thread's lease: the decisions matched to the pause, the profile and the tools checked,
   * the free text screened, the gate, the step, the settlement; a failure after the gate closes the run FAILED.
   */
  private async continueRun<TStructured>(
    {
      paused,
      userContext,
      pauseId,
      decisions,
      profileId,
      additionalTools,
      outputSchema,
      debug,
      callSignal,
      onEvent,
    }: {
      paused: IRun;
      userContext: IUserContext;
      pauseId: string;
      decisions: IResumeDecision[];
      profileId?: string;
      additionalTools: IToolDef[];
      outputSchema?: ZodType<TStructured>;
      debug: boolean;
      callSignal?: ICallSignal;
      onEvent: TOnCallEventHandler;
    },
  ): Promise<TGatewayResponse<TStructured>> {
    const {tenantId} = userContext;
    const runId = paused.id;
    const signal = callSignal?.signal;
    // The run is the asker's: memory, trace and the screens follow them; the tools run with the approver's context (D32)
    const askerContext: IUserContext = {
      ...userContext,
      userId: paused.userId,
    };
    try {
      // A run that cannot take these decisions is refused before the profile reads and the judge call of the answer screen
      const pairs = this.deps.humanGate.matchDecisions({
        run: paused,
        pauseId,
        decisions,
      });
      const [firstPair] = pairs;
      // The decisions as the gate checked them: an answer carries the card's question texts and only what the card offers
      const checkedDecisions = pairs.map(pair => pair.decision);
      // The profile and the tools are checked before the run leaves PAUSED: a refused resume changes nothing
      const profile = await this.getResumeProfile({
        tenantId,
        paused,
        profileId,
      });
      // A reviewed answer needs no tools and no model: the one decision settles the stored answer (D99)
      if (firstPair?.envelope.kind === EPauseKind.RESULT_REVIEW) {
        return await this.continueReview({
          paused,
          userContext: askerContext,
          pauseId,
          decision: firstPair.decision,
          profile,
          outputSchema,
          debug,
          callSignal,
          onEvent,
        });
      }
      const model = await this.deps.modelRegistry.getModel({modelId: profile.modelId});
      // The skills follow this resume's profile like its tools (D65), the run's own come with it (D124); a duplicate between the two is a 400 and the run stays paused.
      // `dyna_aigw_load_skill` is rebuilt from them: the stored prompt still lists the skills of the start, the enum offers these
      const skills = this.deps.skillRegistry.resolve({
        profile,
        skills: paused.skills,
      });
      const loadSkillTool = skills.length > 0 ? [this.deps.skillRegistry.makeLoadSkillTool({skills})] : [];
      const runTools = splitRunTools({
        deps: this.deps,
        runId,
        toolNames: paused.toolNames,
        additionalTools,
      });
      const resolved = this.deps.toolPolicy.resolve({
        allTools: [...runTools.allTools, ...loadSkillTool],
        additionalTools: runTools.additionalTools,
        profile,
        userContext,
        caps: model.caps,
        builtInTools: [
          ...getBuiltInToolNames({config: this.config}),
          ...loadSkillTool.map(tool => tool.name),
        ],
      });
      // Every pending tool of the pause must be offered by the profile the run continues on (D65)
      const pendingToolName = (paused.pending ?? [])
        .flatMap(envelope => envelope.kind === EPauseKind.TOOL_APPROVAL ? [envelope.toolCall.toolName] : [])
        .find(toolName => !resolved.tools.some(tool => tool.name === toolName));
      if (pendingToolName !== undefined) {
        throw dynaError({
          code: 5374489246351,
          status: 400,
          message: `AIGateway: the pending tool [${pendingToolName}] of run [${runId}] is not allowed by profile [${profile.id}]`,
          userMessage: `This AI profile doesn't offer the [${pendingToolName}] tool, please use the another AI profile`,
          data: {
            runId,
            profileId: profile.id,
            toolName: pendingToolName,
          },
        });
      }

      // What the user typed is a prompt for the model: screened like one, before the run leaves PAUSED (D71)
      const answerCheck = await this.checkAnswerText({
        decisions: checkedDecisions,
        userContext: askerContext,
        profile,
        threadId: paused.threadId,
        abortSignal: signal,
      });
      await annotateJudgeTraces({
        deps: this.deps,
        tenantId,
        traceIds: answerCheck.traceIds,
        issues: answerCheck.issues,
      });
      if (!answerCheck.ok) {
        return makeFailedResponse({
          threadId: paused.threadId,
          reason: "The answer was rejected",
          issues: answerCheck.issues,
        });
      }

      // The screen's trace write sits between the check and the step: a stop pressed in that gap still leaves the run paused
      signal?.throwIfAborted();
      const resumed = await this.deps.humanGate.resume({
        tenantId,
        runId,
        pauseId,
        decisions: checkedDecisions,
      });
      // The stored request was built for the profile the run started with; the model and its cap follow this resume's profile
      // The schema is the caller's again: a stored run keeps none (D36)
      const request: IModelRequest = {
        ...resumed.request,
        modelId: model.id,
        maxOutputTokens: Math.min(profile.limits.maxOutputTokens, model.caps.maxOutputTokens),
        messages: resumed.messages,
        ...outputSchema && {outputSchema},
      };
      const run: IRun = {
        ...resumed,
        profileId: profile.id,
        request: {
          ...resumed.request,
          modelId: request.modelId,
          maxOutputTokens: request.maxOutputTokens,
        },
      };

      // The thread's turn count before the step, once read: tells `closeRun` how far back the step's turns can reach
      let turnCountBefore: number | undefined;
      try {
        // Inside the try: the run is RUNNING from here, and a failure must close it
        if (run.profileId !== resumed.profileId) await this.deps.runStore.save({run});
        const {turnCount} = await this.deps.threadStore.getThread({
          tenantId,
          threadId: run.threadId,
        });
        turnCountBefore = turnCount;
        const outcome = await this.deps.llmClient.run({
          request,
          meta: {
            tenantId,
            userId: askerContext.userId,
            profileId: profile.id,
            threadId: run.threadId,
            runId: run.id,
            kind: ETraceKind.RUN_STEP,
          },
          tools: resolved.tools,
          hooks: createRunHooks({
            deps: this.deps,
            userContext,
            threadId: run.threadId,
            runId: run.id,
            resolved,
            holdText: profile.reviewAnswers === true,
            onEvent,
          }),
          limits: {maxSteps: profile.limits.maxStepsPerRun},
          parallelToolCalls: profile.parallelToolCalls ?? true,
          abortSignal: signal,
          resume: {
            // The stored run keeps no file bytes: loaded again for the model, under the asker who uploaded them
            messages: await restoreInlineBytes({
              deps: this.deps,
              tenantId,
              userId: run.userId,
              messages: run.messages,
            }),
            decisions: checkedDecisions,
            // The policy's text for a rejection travels with each call's envelope (D87)
            rejectionTexts: Object.fromEntries((paused.pending ?? []).flatMap(envelope =>
              envelope.kind === EPauseKind.TOOL_APPROVAL && envelope.rejectionText !== undefined ? [[envelope.callId, envelope.rejectionText]] : [])),
          },
        });

        const response = await settleRun({
          deps: this.deps,
          userContext: askerContext,
          threadId: run.threadId,
          profile,
          request,
          toolNames: run.toolNames,
          outcome,
          sentMessages: run.messages.length,
          outputSchema,
          issues: answerCheck.issues,
          previousRun: run,
          debug,
          onEvent,
          callSignal,
        });
        if (response.kind === EGatewayResponseKind.ANSWER) {
          this.scheduleMemory({
            userContext: askerContext,
            threadId: run.threadId,
            profile,
            // The whole run is new to the memory, not only the resumed part (D36)
            previousTurnCount: run.startTurnCount,
            request,
            result: outcome.result,
          });
        }

        return response;
      }
      catch (error) {
        await this.closeFailedRun({
          tenantId,
          run,
          callSignal,
          turnCountBefore,
        });
        throw error;
      }
    }
    catch (error) {
      return this.failedResponseOrThrow({
        error,
        callSignal,
        threadId: paused.threadId,
      });
    }
  }


  /**
   * cancelRun -- drops a paused run without a decision
   *
   * # About
   *
   * > The run becomes CANCELLED, its pending tool call is closed as rejected in the thread, the thread is open again.
   *
   * `HumanGate.cancel` marks the run, `closeRun` does the thread work ("Cancelled by the user"). A run that does not exist
   * is the RunStore's 404.
   *
   * # Who needs it
   *
   * The host's "dismiss" action next to an approval card or a question. Open to every user of the tenant, like `resume`
   * (D32): the run id is the key, a random UUID nobody can guess (D115).
   */
  public async cancelRun(
    {
      userContext,
      runId,
    }: {
      userContext: IUserContext;
      runId: string;
    },
  ): Promise<void> {
    const {tenantId} = userContext;
    const run = await this.deps.runStore.load({
      tenantId,
      runId,
    });
    await this.deps.humanGate.cancel({
      tenantId,
      runId,
    });
    await closeRun({
      deps: this.deps,
      tenantId,
      run,
      status: ERunStatus.CANCELLED,
      rejected: true,
      reason: "Cancelled by the user",
    });
  }

  /**
   * uploadFile -- stores an upload and returns its pointer
   *
   * # About
   *
   * > The bytes go to the `FileStore`; the application keeps the pointer.
   *
   * The file is the calling user's. The pointer goes into `IGatewayAskInput.files` of a later call, where the model reads
   * the image or the PDF. Refused with a 400: a type outside `fileStore.allowedMime` (default PNG, JPEG, WebP, GIF, PDF; no
   * SVG), an empty file, a name over 255 characters or with control characters; with a 413: a file over `fileStore.maxBytes`;
   * with a 409 while the user is being erased (D114).
   *
   * # Who needs it
   *
   * The host's upload endpoint, before the chat call that sends the file.
   *
   * # Pitfalls
   *
   * A pointer of another user in a call is a 400. A file nobody references stays until `deleteFile`, the `delete` of its
   * thread or the erasure of the user.
   */
  public async uploadFile(
    {
      userContext,
      bytes,
      mime,
      name,
    }: {
      userContext: IUserContext;
      bytes: Uint8Array;
      mime: string;
      name: string;
    },
  ): Promise<IFileRef> {
    return this.asUserCall({
      tenantId: userContext.tenantId,
      userIds: [userContext.userId],
    }, () => this.deps.fileStore.put({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      bytes,
      mime,
      name,
    }));
  }

  /**
   * deleteFile -- removes one uploaded file of the calling user
   *
   * # About
   *
   * > For a file that is not referenced yet, or no longer needed.
   *
   * Another user's file is not touched.
   *
   * # Who needs it
   *
   * The host's "remove attachment" before the message is sent.
   */
  public async deleteFile(
    {
      userContext,
      fileId,
    }: {
      userContext: IUserContext;
      fileId: string;
    },
  ): Promise<void> {
    await this.deps.fileStore.remove({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      fileId,
    });
  }

  /**
   * getFileUrl -- a short-lived URL of one uploaded file of the calling user, for a screen
   *
   * # About
   *
   * > The browser fetches the bytes from the storage; they never pass through the server.
   *
   * The adapter signs a URL for the file, valid for `ttlSec` seconds (default 900). The file must be the calling user's:
   * another user's, or an unknown id, is the adapter's 404.
   *
   * # Who needs it
   *
   * The host's chat screen, to show an uploaded image or open a PDF; the `files.toUrl` hook of the Vercel UI module.
   */
  public async getFileUrl(
    {
      userContext,
      fileId,
      ttlSec,
    }: {
      userContext: IUserContext;
      fileId: string;
      /**
       * How long the URL stays valid, in seconds.
       *
       * @default 900
       */
      ttlSec?: number;
    },
  ): Promise<string> {
    return this.deps.fileStore.getSignedUrl({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      fileId,
      ...ttlSec === undefined ? {} : {ttlSec},
    });
  }

  /**
   * removeFilesByUser -- deletes every file a user uploaded
   *
   * # About
   *
   * > The files only; `deleteUserData` is the whole "forget this user".
   *
   * Returns the number of files deleted. Raw ids, no user check: an admin surface.
   *
   * # Who needs it
   *
   * The host, when only the uploads of a user must go (GDPR); `deleteUserData` and `anonymizeUserData` remove the files as
   * one of their steps.
   */
  public async removeFilesByUser(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<number> {
    return this.deps.fileStore.removeFilesByUser({
      tenantId,
      userId,
    });
  }

  /**
   * deleteUserData -- "forget this user" by erasure
   *
   * # About
   *
   * > Everything the gateway holds about one person in a tenant, gone from every store in one call.
   *
   * Deletes the files the user uploaded, the facts remembered about them, their threads with every turn and working
   * memory, their runs and their trace entries (D54). What the app's usage adapter stored is the app's to erase. Returns the counts per
   * place; `pseudonym` is null.
   *
   * - Waits for the user's own background work first, so nothing is written after the erasure.
   * - While it runs, the user's new calls (`ask`, `run`, `resume`, `uploadFile`, `upsertUserFact`) are a 409, and it waits
   *   for the calls of the user already running (D114).
   *
   * # Who needs it
   *
   * The application, on a data-subject erasure request (GDPR). Raw ids, no user check: an admin surface, the host decides
   * who may call it.
   *
   * # Usage
   *
   * ## When to use it
   *
   * The law or the user asks that the person's data is removed and nothing has to stay for statistics or audit.
   *
   * ## When shouldn't use it
   *
   * `anonymizeUserData` when the counts, usage and cost must stay for the books; `delete` when only some conversations go
   * and the user stays.
   *
   * # Pitfalls
   *
   * Hard delete, no way back. A second call finds nothing and returns zeros. "Busy" is the thread's lease, the lock `ask` /
   * `run` / `resume` hold for the duration of a call (a PAUSED run holds none: its thread is erased and the run with it).
   * A thread of the user with a live lease (a call on another instance of the gateway) is refused with a `dynaError` of status 409, code `5377210486241`, and
   * `data.busyThreadIds` naming the threads, before anything is erased: the host retries when the call ended -- the gateway
   * waits only for the calls of this instance.
   */
  public async deleteUserData(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<IForgetUserResult> {
    return this.userCalls.whileErasing({
      tenantId,
      userId,
    }, () => forgetUser({
      deps: this.deps,
      background: this.background,
      tenantId,
      userId,
      mode: EForgetUserMode.DELETE,
    }));
  }

  /**
   * anonymizeUserData -- "forget this user" by pseudonymisation
   *
   * # About
   *
   * > The person goes, the numbers stay.
   *
   * The threads, runs and trace entries stay as skeletons for the statistics and the audit -- status, counts, usage,
   * cost, dates -- under one random pseudonym `@anon-<uuid>`, the same on every row of this call (D54). What identifies
   * the person goes, as in `deleteUserData`: files, turns, remembered facts, prompts, answers, system prompts. An open run
   * is CANCELLED. Returns the counts per place and the pseudonym.
   *
   * - Waits for the user's own background work first, so nothing is written after the erasure.
   * - While it runs, the user's new calls (`ask`, `run`, `resume`, `uploadFile`, `upsertUserFact`) are a 409, and it waits
   *   for the calls of the user already running (D114).
   *
   * # Who needs it
   *
   * The application, on a data-subject erasure request (GDPR) where the books must keep the usage and the cost. Raw ids,
   * no user check: an admin surface, the host decides who may call it.
   *
   * # Usage
   *
   * ## When to use it
   *
   * The person must become unidentifiable but the tenant's statistics, billing and audit trail must keep their rows.
   *
   * ## When shouldn't use it
   *
   * `deleteUserData` when nothing has to stay; `delete` when only some conversations go and the user stays.
   *
   * # Pitfalls
   *
   * No way back: the mapping user -> pseudonym exists only in the returned value. Keep it only where the law asks for it.
   * A second call for the same user finds nothing: the rows already carry a pseudonym. "Busy" is the thread's lease, the
   * lock `ask` / `run` / `resume` hold for the duration of a call (a PAUSED run holds none: its thread is kept as a skeleton
   * and the run cancelled). A thread of the user with a live lease (a call on another instance of the gateway) is refused with a `dynaError` of status 409, code `5377210486241`,
   * and `data.busyThreadIds` naming the threads, before anything is touched, so the user's rows never end up under two
   * pseudonyms: the host retries when the call ended.
   */
  public async anonymizeUserData(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<IForgetUserResult> {
    return this.userCalls.whileErasing({
      tenantId,
      userId,
    }, () => forgetUser({
      deps: this.deps,
      background: this.background,
      tenantId,
      userId,
      mode: EForgetUserMode.ANONYMIZE,
    }));
  }

  /**
   * delete -- removes threads with everything they left behind
   *
   * # About
   *
   * > The threads of a tenant, of one user, or a chosen list, gone from every store in one call.
   *
   * Thread, turns, working memory, files, runs and trace entries of every matched thread are deleted; the count of threads
   * comes back. A thread with a call in flight (its lease is live: the lock `ask` / `run` / `resume` hold for the duration of
   * a call; a PAUSED run holds none and goes with its thread) is skipped and not counted -- no error; an unknown id, or one of
   * another tenant or user, is ignored. The background memory updates of the owners are awaited first, so nothing is
   * written after the delete. User facts are not touched: they belong to the user, not to a thread.
   *
   * # Who needs it
   *
   * The application: the user's "delete conversation(s)", a tenant's retention job, a test's teardown. Raw ids, no user
   * check: an admin surface, the host decides who may call it.
   *
   * # Usage
   *
   * ## When to use it
   *
   * `{tenantId, threadIds: ["t-1", "t-2"], userId}` for the user's own delete; `{tenantId, threadIds: "all"}` for a tenant's
   * reset; `{tenantId, threadIds: "all", userId}` to wipe one user's conversations while keeping the user.
   *
   * ## When shouldn't use it
   *
   * "Forget this user" is `deleteUserData` or `anonymizeUserData`: they also remove the files and facts of the user.
   *
   * # Pitfalls
   *
   * Hard delete, no way back. A second call with the same ids returns 0.
   */
  public async delete(args: IDeleteArgs): Promise<IDeleteResult> {
    return deleteThreads({
      ...args,
      deps: this.deps,
      background: this.background,
    });
  }

  /**
   * listThreads -- the conversations of the calling user, for the sidebar of a chat screen
   *
   * # About
   *
   * > One page of the user's threads, newest first.
   *
   * Pages as the Vercel chat client does: the first read passes `startingAfter: null, endingBefore: null` and gets the newest
   * `limit` threads; `endingBefore` the last id shown reads the next, older page; `startingAfter` an id reads the newer ones.
   * Only the calling user's threads of the tenant are listed and accepted as cursors.
   *
   * # Pitfalls
   *
   * `limit` outside 1–200 or both cursors at once is a 400; a cursor that is not one of the user's threads is a 404.
   * The order is by creation: a thread used again keeps its place, it does not move to the top.
   */
  public listThreads(
    {
      userContext,
      page,
    }: {
      userContext: IUserContext;
      page: IPageArgs;
    },
  ): Promise<IPage<IThread>> {
    return this.deps.threadStore.listThreads({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      page,
    });
  }

  /**
   * getTurns -- the history of a thread, for a chat screen that opens it
   *
   * # About
   *
   * > Every turn of the thread, oldest first, in one read.
   *
   * No paging: a chat screen draws the whole conversation, as the Vercel chat client loads a chat. The thread must be the
   * calling user's; another user's thread is a 404, like an unknown one.
   */
  public async getTurns(
    {
      userContext,
      threadId,
    }: {
      userContext: IUserContext;
      threadId: string;
    },
  ): Promise<ITurn[]> {
    await getOwnThread({
      deps: this.deps,
      userContext,
      threadId,
    });
    return this.deps.threadStore.getTurns({
      tenantId: userContext.tenantId,
      threadId,
    });
  }


  /**
   * renameThread -- gives a thread the title the user typed
   *
   * # About
   *
   * > The user's own name for a conversation.
   *
   * Sets or replaces the title; a thread has none until this sets it. The thread must be the calling user's; another user's
   * thread is a 404, like an unknown one.
   */
  public async renameThread(
    {
      userContext,
      threadId,
      title,
    }: {
      userContext: IUserContext;
      threadId: string;
      title: string;
    },
  ): Promise<void> {
    await getOwnThread({
      deps: this.deps,
      userContext,
      threadId,
    });
    await this.deps.threadStore.updateThread({
      tenantId: userContext.tenantId,
      threadId,
      title,
    });
  }

  /**
   * getUserFacts -- what the gateway remembers about the calling user
   *
   * # About
   *
   * > The user's facts, across threads, for a "what you know about me" screen.
   *
   * The facts the `UserMemoryStore` extracted in the background and the ones set by hand (`upsertUserFact`); every one of
   * them goes into every prompt of the user.
   *
   * # Who needs it
   *
   * The host's memory settings screen, next to `upsertUserFact`, `removeUserFact` and `clearUserFacts`.
   */
  public async getUserFacts(
    {userContext}: { userContext: IUserContext },
  ): Promise<IUserMemoryFact[]> {
    return this.deps.userMemoryStore.getFacts({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
    });
  }

  /**
   * removeUserFact -- forgets one fact about the calling user
   *
   * # About
   *
   * > One entry of the memory screen, gone.
   *
   * A key that is not there changes nothing.
   */
  public async removeUserFact(
    {
      userContext,
      key,
    }: {
      userContext: IUserContext;
      key: string;
    },
  ): Promise<void> {
    await this.deps.userMemoryStore.removeFact({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      key,
    });
  }

  /**
   * upsertUserFact -- sets one remembered fact of the calling user by hand
   *
   * # About
   *
   * > The user tells the assistant what to remember, without a conversation.
   *
   * Same key = replace. Throws a 400 for an empty key or value, and for a key or value over `userMemoryStore.maxFactChars`
   * (default 500): every fact goes into every prompt of the user. A 409 while the user is being erased (D114).
   *
   * # Who needs it
   *
   * The host's memory settings screen ("add", "edit").
   */
  public async upsertUserFact(
    {
      userContext,
      key,
      value,
    }: {
      userContext: IUserContext;
      key: string;
      value: string;
    },
  ): Promise<void> {
    await this.asUserCall({
      tenantId: userContext.tenantId,
      userIds: [userContext.userId],
    }, () => this.deps.userMemoryStore.upsertFact({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
      key,
      value,
    }));
  }

  /**
   * clearUserFacts -- forgets every fact about the calling user
   *
   * # About
   *
   * > "Forget what you know about me": the facts only, threads and files stay.
   */
  public async clearUserFacts(
    {userContext}: { userContext: IUserContext },
  ): Promise<void> {
    await this.deps.userMemoryStore.clear({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
    });
  }

  /**
   * getThreadMemory -- what the gateway remembers about one conversation
   *
   * # About
   *
   * > The summary and the notes of a thread, for a "memory of this chat" panel.
   *
   * Under `SLIDING_WINDOW` nothing is written, so the state is empty, or what an earlier `SUMMARY_BUFFER` period left
   * (ignored, never wiped). The thread must be the calling user's; another user's thread is a 404.
   *
   * # Who needs it
   *
   * The host's chat screen, next to `resetThreadMemory`.
   */
  public async getThreadMemory(
    {
      userContext,
      threadId,
    }: {
      userContext: IUserContext;
      threadId: string;
    },
  ): Promise<IWorkingMemoryState> {
    await getOwnThread({
      deps: this.deps,
      userContext,
      threadId,
    });
    return this.deps.workingMemory.getState({
      tenantId: userContext.tenantId,
      threadId,
    });
  }

  /**
   * resetThreadMemory -- "forget this thread": clears its memory, the turns stay
   *
   * # About
   *
   * > The conversation is kept; what the model remembers of it is dropped.
   *
   * Runs after the memory updates of the thread that are already queued, so a late update does not bring the memory back.
   * Another user's thread is a 404.
   */
  public async resetThreadMemory(
    {
      userContext,
      threadId,
    }: {
      userContext: IUserContext;
      threadId: string;
    },
  ): Promise<void> {
    await resetThreadMemory({
      deps: this.deps,
      background: this.background,
      userContext,
      threadId,
    });
  }

  /**
   * whenIdle -- resolves when the background work is done
   *
   * # About
   *
   * > The memory updates after an answer run in the background; this is how to wait for them.
   *
   * Never rejects: a background task that fails is reported, not thrown.
   *
   * # Who needs it
   *
   * Tests, before they read the memory; `shutdown`, as its last step. A server calls `shutdown`.
   */
  public whenIdle(): Promise<void> {
    return this.background.whenIdle();
  }

  /**
   * shutdown -- stops taking calls, drains the ones in flight, aborts the rest (D96)
   *
   * # About
   *
   * > A server that is stopped finishes what it is doing instead of cutting calls in half.
   *
   * From the first call on, every new `ask`, `run` and `resume` is refused with a 503 (the client did nothing wrong and
   * may retry on another instance). The calls in flight get `timeoutMs` to end; the ones still running after it are
   * aborted through their call signal (D90), so each closes its run, releases its thread lease and keeps its turns, and
   * answers FAILED with `call_aborted`. Then the background memory updates land (`whenIdle`). Paused runs are untouched:
   * they are stored. A second call returns the same promise.
   *
   * # Who needs it
   *
   * The application's SIGTERM handler, before it closes its HTTP server and its database connections.
   *
   * # Pitfalls
   *
   * A crash (kill -9, out of memory) skips all of it. There is
   * no way back: a gateway that was shut down takes no call again; construct a new one.
   */
  public shutdown(
    {timeoutMs}: {
      /** The grace period of the calls in flight, in milliseconds; a positive integer, as `IGatewayAskInput.timeoutMs`. */
      timeoutMs: number;
    },
  ): Promise<void> {
    // Validated before the promise is kept: a bad period throws here and leaves the gateway open
    const deadline = makeCallSignal({timeoutMs})?.deadline;
    if (!this.shutdownPromise) this.shutdownPromise = this.executeShutdown({deadline});
    return this.shutdownPromise;
  }

  /**
   * expirePausedRuns -- the scheduled job's entry: closes the pauses nobody answered in time
   *
   * # About
   *
   * > Each expired pause ends like a cancelled one: run CANCELLED, its pending tool call closed as rejected in the thread,
   * > the thread open again. Returns how many were closed; a thread that could not be closed is logged and skipped.
   *
   * `HumanGate.expirePaused` picks and cancels the due runs (D75); `closeRun` does the thread work for each.
   *
   * # Who needs it
   *
   * A scheduled job of the application, once per tenant and interval; the interval decides how long a thread stays blocked
   * past the pause's `expiresAt`.
   */
  public async expirePausedRuns({tenantId}: { tenantId: string }): Promise<number> {
    const expired = await this.deps.humanGate.expirePaused({tenantId});
    let closed = 0;
    for (const run of expired) {
      // The gate has already set this run to CANCELLED, so a later job never sees it again.
      // When closing its thread fails: log it, go on with the next run, never abort the batch (D76)
      try {
        await closeRun({
          deps: this.deps,
          tenantId,
          run,
          status: ERunStatus.CANCELLED,
          rejected: true,
          reason: "The approval expired",
        });
        closed++;
      }
      catch (error) {
        console.error(`Internal error 5375202005313: AIGateway: expired run [${run.id}] was cancelled but its thread [${run.threadId}] could not be closed`, error);
      }
    }
    return closed;
  }

  /**
   * recoverStuckRuns -- the scheduled job's entry: fails the runs an instance that died left RUNNING
   *
   * # About
   *
   * > A run nobody works on any more is closed like a broken one: run FAILED, its cut tool call answered with an error in
   * > the thread, the thread open again. Returns how many were recovered.
   *
   * An instance that dies inside a call leaves its run RUNNING and, after a `resume`, its thread waiting for a human:
   * no door reopens it (D97). The job lists the RUNNING runs of the tenant and, for each, takes the thread's lease first:
   * a live call holds it, so a lease obtained proves nobody works on the thread. Then it moves the run RUNNING to FAILED
   * atomically (D69), closes it with `closeRun` and releases the lease.
   *
   * # Who needs it
   *
   * A scheduled job of the application, once per tenant and interval, next to `expirePausedRuns`.
   *
   * # Pitfalls
   *
   * A thread that is busy (409) is skipped, so is one that cannot be closed (logged, D76); both are found again by the
   * next job. The proof holds only while a call's `timeoutMs` (D90) is at most the thread's `leaseMs` (D77): a longer live
   * call loses its lease and can be failed by the job while it runs.
   */
  public async recoverStuckRuns({tenantId}: { tenantId: string }): Promise<number> {
    const running = await this.deps.runStore.listRunning({tenantId});
    let recovered = 0;
    for (const run of running) {
      let token: string;
      try {
        token = await this.deps.threadStore.acquireLease({
          tenantId,
          threadId: run.threadId,
        });
      }
      catch {
        // Busy (a live call holds it) or gone: not ours to touch
        continue;
      }
      try {
        const failed = await this.deps.runStore.transition({
          tenantId,
          runId: run.id,
          from: ERunStatus.RUNNING,
          to: ERunStatus.FAILED,
        });
        // Settled between the listing and the lease: nothing left to recover
        if (!failed) continue;
        await closeRun({
          deps: this.deps,
          tenantId,
          run: failed,
          status: ERunStatus.FAILED,
          rejected: false,
          reason: "The call was cut off: the server stopped before it finished",
        });
        recovered++;
      }
      catch (error) {
        console.error(`Internal error 5375202005324: AIGateway: stuck run [${run.id}] was failed but its thread [${run.threadId}] could not be closed`, error);
      }
      finally {
        await this.deps.threadStore.releaseLease({
          tenantId,
          threadId: run.threadId,
          token,
        });
      }
    }
    return recovered;
  }

  /**
   * listPausedRuns -- the runs that wait for a human, of the calling user
   *
   * # About
   *
   * > What the user's UI lists as "waiting for approval" or "in review".
   *
   * A summary per run (`IPausedRunSummary`), never the stored run: no system prompt, no messages, and a review's envelope
   * without the draft answer (D99, D111); the reviewer reads the whole run with `getPausedRun`.
   *
   * # Who needs it
   *
   * The host's inbox of pending approvals and questions, for the user who asked.
   */
  public async listPausedRuns(
    {userContext}: { userContext: IUserContext },
  ): Promise<IPausedRunSummary[]> {
    const runs = await this.deps.humanGate.listPaused({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
    });
    return runs.flatMap((run): IPausedRunSummary[] => {
      const [first, ...rest] = (run.pending ?? []).map(withoutReviewedAnswer);
      if (!first) return [];
      return [{
        runId: run.id,
        threadId: run.threadId,
        profileId: run.profileId,
        pauseId: first.pauseId,
        envelopes: [first, ...rest],
        createdAt: run.createdAt,
        expiresAt: first.expiresAt,
      }];
    });
  }

  /**
   * getPausedRun -- the stored run, for the reviewer's or the approver's screen
   *
   * # About
   *
   * > The whole pause: the draft answer of a review, the tool calls, the request the run was built with.
   *
   * Raw ids, no user check: an admin surface like `trace`, the host decides who may read it (a reviewer of the tenant). The
   * envelopes carry the draft answer (`IResultReviewEnvelope.result`), and the run its system prompt and messages.
   *
   * # Who needs it
   *
   * The reviewer's UI of a profile with `reviewAnswers` (D99): the asker's PAUSED response and `listPausedRuns` leave the
   * draft out.
   *
   * # Pitfalls
   *
   * Never hand it to the end user who asked: it holds the system prompt (memory notes, KB excerpts) and every tool output.
   * A run that does not exist is the RunStore's 404.
   */
  public async getPausedRun(
    {
      tenantId,
      runId,
    }: {
      tenantId: string;
      runId: string;
    },
  ): Promise<IRun> {
    return this.deps.runStore.load({
      tenantId,
      runId,
    });
  }

  /**
   * kbIngestor -- the second root: the write side of the knowledge base
   *
   * # About
   *
   * > Documents go in here; the calls read them through `ask` and `run`.
   *
   * # Who needs it
   *
   * The host's knowledge-base write endpoints and import jobs.
   */
  public get kbIngestor(): IKbIngestor {
    return this.deps.kbIngestor;
  }

  /**
   * modelRegistry -- the admin surface of the models
   *
   * # About
   *
   * > Which models exist, with their caps and prices.
   *
   * Raw ids, no user check: the host checks the owner permission before it calls, as for every admin getter.
   *
   * # Who needs it
   *
   * The host's admin pages and seed scripts.
   */
  public get modelRegistry(): IModelRegistry {
    return this.deps.modelRegistry;
  }

  /**
   * aiProfileStore -- the admin surface of the profiles
   *
   * # About
   *
   * > Create, change and read the profiles of a tenant.
   *
   * Raw ids, no user check: the host checks the owner permission before it calls.
   *
   * # Who needs it
   *
   * The host's admin pages and seed scripts.
   */
  public get aiProfileStore(): IAIProfileStore {
    return this.deps.aiProfileStore;
  }

  /**
   * promptTemplateStore -- the admin surface of the prompt templates
   *
   * # About
   *
   * > The versions of every template: read, add one, set the active one.
   *
   * Raw ids, no user check: the host checks the owner permission before it calls.
   *
   * # Who needs it
   *
   * The host's prompt editor and seed scripts.
   */
  public get promptTemplateStore(): IPromptTemplateStore {
    return this.deps.promptTemplateStore;
  }

  /**
   * toolRegistry -- the admin surface of the tools
   *
   * # About
   *
   * > The tools as registered, the built-in ones included, for a page that lists them.
   *
   * # Who needs it
   *
   * The host's admin pages; a profile editor that offers the tool names for `allowedTools`.
   */
  public get toolRegistry(): IToolRegistry {
    return this.deps.toolRegistry;
  }

  /**
   * trace -- the admin surface of the model calls
   *
   * # About
   *
   * > Every model call of the tenant, for the audit page and for debugging.
   *
   * Raw ids, no user check: it holds system prompts and tool outputs, so the host checks the owner permission before it
   * calls.
   *
   * # Who needs it
   *
   * The host's audit and debugging pages.
   */
  public get trace(): ITrace {
    return this.deps.trace;
  }

  /**
   * usageGuard -- the gateway's side of the usage adapter
   *
   * # About
   *
   * > The checks and the reports the gateway's model calls go through, over the adapter the host passed.
   *
   * # Who needs it
   *
   * A host that checks or reports usage outside a call, with the gateway's own logic.
   */
  public get usageGuard(): IUsageGuard {
    return this.deps.usageGuard;
  }

  /**
   * The profile a resume continues on (D65). A switch keeps what the run started under: the review of the answer and the
   * approvals are the union of both profiles (D113), so a resume cannot pick a profile that skips them. A paused run's
   * profile that no longer exists is the AIProfileStore's 404: its rules are not known, so the switch is refused.
   */
  private async getResumeProfile(
    {
      tenantId,
      paused,
      profileId,
    }: {
      tenantId: string;
      paused: IRun;
      profileId?: string;
    },
  ): Promise<IAIProfile> {
    const profile = await this.deps.aiProfileStore.getProfile({
      tenantId,
      profileId: profileId ?? paused.profileId,
    });
    if (profile.id === paused.profileId) return profile;
    const started = await this.deps.aiProfileStore.getProfile({
      tenantId,
      profileId: paused.profileId,
    });
    return {
      ...profile,
      reviewAnswers: profile.reviewAnswers === true || started.reviewAnswers === true,
      approvals: [...new Set([...profile.approvals, ...started.approvals])],
    };
  }

  /**
   * The work of `resume` on a RESULT_REVIEW pause (D99): the gate, then the settlement of the stored answer; no tools, no
   * model step. `userContext` is the asker's (D32).
   */
  private async continueReview<TStructured>(
    {
      paused,
      userContext,
      pauseId,
      decision,
      profile,
      outputSchema,
      debug,
      callSignal,
      onEvent,
    }: {
      paused: IRun;
      userContext: IUserContext;
      pauseId: string;
      decision: IResumeDecision;
      profile: IAIProfile;
      outputSchema?: ZodType<TStructured>;
      debug: boolean;
      callSignal?: ICallSignal;
      onEvent: TOnCallEventHandler;
    },
  ): Promise<TGatewayResponse<TStructured>> {
    const {tenantId} = userContext;
    // Nothing of the decision reaches the model, so there is no answer screen.
    // An edit that cannot be delivered is refused before the run leaves PAUSED; a stop pressed before the gate leaves it paused.
    const edited =
      decision.action === EResumeAction.EDIT
        ? parseEditedAnswer({
          deps: this.deps,
          run: paused,
          decision,
          outputSchema,
        })
        : undefined;
    callSignal?.signal.throwIfAborted();
    const resumed = await this.deps.humanGate.resume({
      tenantId,
      runId: paused.id,
      pauseId,
      decisions: [decision],
    });
    const run: IRun = {
      ...resumed,
      profileId: profile.id,
    };
    // The thread's turn count before the settlement, once read: tells `closeRun` how far back its turns can reach
    let turnCountBefore: number | undefined;
    try {
      // Inside the try: the run is RUNNING from here, and a failure must close it
      if (run.profileId !== resumed.profileId) await this.deps.runStore.save({run});
      const {turnCount} = await this.deps.threadStore.getThread({
        tenantId,
        threadId: run.threadId,
      });
      turnCountBefore = turnCount;
      const response = await settleReview<TStructured>({
        deps: this.deps,
        userContext,
        run,
        decision,
        edited,
        debug,
        onEvent,
      });
      if (response.kind === EGatewayResponseKind.ANSWER) {
        this.scheduleMemory({
          userContext,
          threadId: run.threadId,
          profile,
          // The whole run is new to the memory, not only the resumed part (D36)
          previousTurnCount: run.startTurnCount,
          // The answer is the human's decision, not a model result
          request: {
            ...run.request,
            messages: run.messages,
          },
        });
      }
      return response;
    }
    catch (error) {
      await this.closeFailedRun({
        tenantId,
        run,
        callSignal,
        turnCountBefore,
      });
      throw error;
    }
  }

  /**
   * A run that left PAUSED and was not settled must not stay RUNNING, signal aborted or not: closed FAILED through `closeRun`
   * (it reads the thread, so a settlement that broke after storing its turns is closed without a second result). When even
   * that fails, the run is at least marked FAILED and the thread is left awaiting the human, logged for an operator.
   */
  private async closeFailedRun(
    {
      tenantId,
      run,
      callSignal,
      turnCountBefore,
    }: {
      tenantId: string;
      run: IRun;
      callSignal?: ICallSignal;
      turnCountBefore?: number;
    },
  ): Promise<void> {
    try {
      await closeRun({
        deps: this.deps,
        tenantId,
        run,
        status: ERunStatus.FAILED,
        rejected: false,
        reason:
          callSignal?.signal.aborted
            ? abortReason({callSignal})
            : "The run failed before it completed",
        turnCountBefore,
      });
    }
    catch (closeError) {
      // The cause is what the caller must see. Nothing else reaches a run that is not PAUSED.
      console.error(
        `Internal error 5376412760091: AIGateway: run [${run.id}] of thread [${run.threadId}] failed and could not be closed; the thread is left awaiting the human`,
        closeError,
      );
      await this.deps.runStore.setStatus({
        tenantId,
        runId: run.id,
        status: ERunStatus.FAILED,
      }).catch((statusError: unknown) => {
        console.error(`Internal error 5376412760096: AIGateway: run [${run.id}] could not be marked FAILED, it stays RUNNING`, statusError);
      });
    }
  }

  /**
   * Step 11 of a call: the memory of the thread and of the user, after an answer, in the background.
   * One update at a time per thread; `whenIdle` waits for them.
   */
  private scheduleMemory(
    {
      userContext,
      threadId,
      profile,
      previousTurnCount,
      request,
      result,
    }: {
      userContext: IUserContext;
      threadId: string;
      profile: IAIProfile;
      /** Turns of the thread before the call that just ended. */
      previousTurnCount: number;
      /** The request the answer was produced for, when the gateway has it. */
      request?: IModelRequest;
      /** The model's answer; absent when a human wrote or edited it (a reviewed run). */
      result?: IModelResult;
    },
  ): void {
    this.background.run(threadId, () => updateMemory({
      deps: this.deps,
      config: this.config,
      userContext,
      threadId,
      profile,
      previousTurnCount,
      request,
      result,
    }), makeOwnerKey(userContext.tenantId, userContext.userId));
  }

  /**
   * The input rules on the free text of the ANSWER decisions (D71), once for all of them; decisions without free text pass untouched.
   * `prompt` of the evidence is the typed answers joined by blank lines; files none; `threadId` the run's thread.
   */
  private async checkAnswerText(
    {
      decisions,
      userContext,
      profile,
      threadId,
      abortSignal,
    }: {
      decisions: IResumeDecision[];
      userContext: IUserContext;
      profile: IAIProfile;
      threadId: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<IInputCheck> {
    const freeText = decisions
      .flatMap(decision => decision.action === EResumeAction.ANSWER ? decision.answers ?? [] : [])
      .map(answer => answer.freeText?.trim() ?? "")
      .filter(text => text.length > 0)
      .join("\n\n");
    if (!freeText) {
      return {
        prompt: "",
        issues: [],
        ok: true,
        traceIds: [],
      };
    }
    return this.deps.guardrails.checkInput({
      prompt: freeText,
      files: [],
      inlineFiles: [],
      userContext,
      profile,
      threadId,
      abortSignal,
    });
  }

  /**
   * The FAILED response of a call that was stopped: its signal is aborted, or the usage adapter refused one of its model
   * calls (`isUsageDeniedError`). Rethrows `error` otherwise.
   * An error that is not the aborted signal's reason is logged first: the caller stopped the call, but a layer broke on the way.
   */
  private failedResponseOrThrow(
    {
      error,
      callSignal,
      threadId,
    }: {
      error: unknown;
      callSignal?: ICallSignal;
      threadId?: string;
    },
  ): IFailedResponse {
    if (callSignal?.signal.aborted) {
      if (error !== callSignal.signal.reason) {
        console.error("Internal error 5376412760013: AIGateway: the call was aborted but failed with another error", error);
      }
      return makeAbortedResponse({
        threadId,
        callSignal,
      });
    }
    if (isUsageDeniedError(error)) {
      return makeUsageDeniedResponse({
        threadId,
        denied: error.data,
      });
    }
    throw error;
  }

  /**
   * Runs one call of these users; refused with a 409 while one of them is being erased, and an erasure that starts meanwhile
   * waits for it to end (D114).
   */
  private async asUserCall<T>(
    {
      tenantId,
      userIds,
    }: {
      tenantId: string;
      userIds: string[];
    },
    call: () => Promise<T>,
  ): Promise<T> {
    const end = this.userCalls.begin({
      tenantId,
      userIds,
    });
    try {
      return await call();
    }
    finally {
      end();
    }
  }

  /**
   * Registers the call with the in-flight set the moment the door is called, not when the work starts: a `shutdown` in the
   * same tick then still sees it. Once `shutdown` began the returned execute rejects with the 503 instead.
   */
  private asInFlightCall<T>(
    work: (args: {onEvent: TOnCallEventHandler; shutdownSignal: AbortSignal}) => Promise<T>,
  ): (args: {onEvent: TOnCallEventHandler}) => Promise<T> {
    let registration: ReturnType<IInFlightCalls["begin"]>;
    try {
      registration = this.inFlightCalls.begin();
    }
    catch (error) {
      return (): Promise<T> => Promise.reject(error);
    }
    return async ({onEvent}): Promise<T> => {
      try {
        return await work({
          onEvent,
          shutdownSignal: registration.signal,
        });
      }
      finally {
        registration.end();
      }
    };
  }

  /**
   * Close the door, drain within the grace period, abort what is left, let the background work land.
   * Runs once: `shutdown` keeps its promise.
   */
  private async executeShutdown({deadline}: {deadline?: AbortSignal}): Promise<void> {
    this.inFlightCalls.close();
    const drained = await Promise.race([
      this.inFlightCalls.whenEmpty().then((): boolean => true),
      new Promise<boolean>(resolve => deadline?.addEventListener("abort", () => resolve(false), {once: true})),
    ]);
    if (!drained) {
      this.inFlightCalls.abortAll();
      await this.inFlightCalls.whenEmpty();
    }
    await this.whenIdle();
  }

}
