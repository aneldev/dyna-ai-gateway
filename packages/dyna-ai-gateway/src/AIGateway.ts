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

/** Facade and composition root. The business service's only entry point. */
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
   * One grounded answer, no tools. Returns at once (D38): `events` streams the answer, `response` is the final response.
   * `response` is FAILED when the prompt is rejected or the answer does not pass the checks (a failed answer is not stored).
   * It rejects with the dynaError of a child for what the caller got wrong or the provider broke: unknown profile, thread or model,
   * a thread that waits for a human, a provider failure.
   * User memory: facts are extracted in the background after the first answer and then every `extractEveryTurns` turns;
   * nothing is stored on request. ask() has no tools, so "remember this" is not acted on at once. Use run() for that.
   * `abortSignal` / `timeoutMs` of the input stop the call (D90): the response is FAILED with the reason, nothing is thrown.
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
   * Agent run with tools; may return PAUSED. Returns at once (D38): `events` streams the run, `response` is the final response.
   * The model sees the tools ToolPolicy resolves for the profile and the user; a tool that needs approval pauses the run:
   * the run is stored, the thread waits for a human, and `resume` continues it. On a profile with `reviewAnswers` (D99) the
   * finished answer pauses the run too, once it passed the output checks: the envelope shows it to a reviewer, and `resume`
   * delivers, edits or drops it without another model call.
   * The tool turns a run produced (tool requests, tool results) are stored even when the final answer fails the checks, because
   * the tools did run; the failed answer itself is not stored (D70).
   * `abortSignal` / `timeoutMs` of the input stop the call (D90): the model call and the tool in flight are aborted, the response
   * is FAILED with the reason; the steps that completed are stored (the tools did run), a tool call the abort cut gets an error
   * result, and a paused run is never created.
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
   * Continues a paused run with the human's decisions: one per envelope of the pause (D102), each named by the envelope's
   * `callId` (a pause of one envelope takes one decision without it); a decision that names no envelope, an envelope left
   * without one, or an action its envelope does not allow is a 400 and the run stays paused. May pause again when a later
   * step needs approval, or when the answer it produces is reviewed (D99). On a reviewed answer no model is called: APPROVE delivers it, EDIT delivers `editedInput`
   * as the new text (parsed through the run's `outputSchema` again; a miss is a 400 and the run stays paused), REJECT drops
   * it and the call is FAILED with `text` as the reason.
   * The tools run with the context of the user who resumes (the approver is accountable for them); the run stays the asker's
   * (D32): the memory extracted after it, its trace entries and the screens of the answer are under the user who started it.
   * When the continuation throws, the run is marked FAILED,
   * its pending tool call is closed in the thread and the thread is opened again.
   * The run continues on its profile as it is now, or on `profileId` (D65): the model, the output cap, the tools and the
   * limits come from that profile; the system prompt and the messages so far stay. The review of the answer and the
   * approvals are those of both profiles (D113): a switch never skips a guard the run started under. A pending tool the profile does not
   * allow is a 400 and the run stays paused. A run that started with `additionalTools` (D66) needs them again.
   * The free text of an ANSWER goes through the input rules like a prompt (D71): an ERROR returns FAILED and the run stays
   * paused, so the user can answer again; WARNINGs travel on the response.
   * `abortSignal` / `timeoutMs` stop the resume as they stop a call (D90): FAILED with the reason. An abort during the step closes
   * the run as FAILED (its open tool call gets an error result, the thread is open again); an abort before the step, while the
   * answer is screened, leaves the run paused.
   * A resumed run answers like one that never paused (D36): its answer cites the knowledge-base chunks of its first step, its
   * trace entries carry the template version, and the user's facts are extracted from the whole run. What a stored run cannot
   * keep is the `outputSchema` (a zod schema is code): a run started with one is resumed with the same schema again, or its
   * answer is plain text (an EDIT of a structured reviewed answer without it is a 400).
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

  /** The work of `resume` under the thread's lease: the checks, the gate, the step, the settlement. */
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
      const resolved = this.deps.toolPolicy.resolve({
        ...splitRunTools({
          deps: this.deps,
          runId,
          toolNames: paused.toolNames,
          additionalTools,
        }),
        profile,
        userContext,
        caps: model.caps,
        builtInTools: getBuiltInToolNames({config: this.config}),
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
   * Cancels a paused run: the run becomes CANCELLED, its pending tool call is closed as rejected in the thread, the thread is open again.
   * Open to every user of the tenant, like `resume` (D32): the run id is the key, a random UUID nobody can guess (D115).
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
   * Stores an upload; returns the pointer to pass in IGatewayAskInput.files. The file is the calling user's.
   * Refused with a 400: a type outside `fileStore.allowedMime` (default PNG, JPEG, WebP, GIF, PDF; no SVG), an empty file, a name
   * over 255 characters or with control characters; with a 413: a file over `fileStore.maxBytes`.
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

  /** Deletes an uploaded file of the calling user that is not referenced yet or no longer needed. Another user's file is not touched. */
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

  /** Deletes every file a user uploaded, for a "forget this user" request (GDPR). Returns the number of files deleted. */
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
   * Replaces the title, also the one the working memory wrote. The thread must be the calling user's; another user's thread
   * is a 404, like an unknown one.
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

  /** User memory management for the UI: what the gateway remembers about the calling user, across threads. */
  public async getUserFacts(
    {userContext}: { userContext: IUserContext },
  ): Promise<IUserMemoryFact[]> {
    return this.deps.userMemoryStore.getFacts({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
    });
  }

  /** Removes one remembered fact of the calling user. A key that is not there changes nothing. */
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
   * Sets one remembered fact of the calling user by hand; same key = replace. Throws a 400 for an empty key or value, and for a
   * key or value over `userMemoryStore.maxFactChars` (default 500): every fact goes into every prompt of the user.
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

  /** Removes every remembered fact of the calling user. */
  public async clearUserFacts(
    {userContext}: { userContext: IUserContext },
  ): Promise<void> {
    await this.deps.userMemoryStore.clear({
      tenantId: userContext.tenantId,
      userId: userContext.userId,
    });
  }

  /**
   * Thread memory for the UI: what the gateway remembers about one conversation of the calling user. Under `SLIDING_WINDOW`
   * nothing is written, so the state is empty, or what an earlier `SUMMARY_BUFFER` period left (ignored, never wiped).
   * Another user's thread is a 404.
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
   * Clears the memory of one conversation of the calling user ("forget this thread"); the turns stay.
   * Runs after the memory updates of the thread that are already queued. Another user's thread is a 404.
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
   * Resolves when the gateway's background work (the memory updates after an answer) is done.
   * For a server that shuts down, and for tests. Never rejects: a background task that fails is reported, not thrown.
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
   * The runs that wait for a human, of the calling user: what the user's UI lists ("waiting for approval", "in review").
   * A summary per run, never the stored run: no system prompt, no messages, and a review's envelope without the draft
   * answer (D99) — the reviewer reads the whole run with `getPausedRun`.
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

  /** The second root, for the KB write endpoints. */
  public get kbIngestor(): IKbIngestor {
    return this.deps.kbIngestor;
  }

  /** Admin surfaces (owner permission checked by the caller). */
  public get modelRegistry(): IModelRegistry {
    return this.deps.modelRegistry;
  }

  public get aiProfileStore(): IAIProfileStore {
    return this.deps.aiProfileStore;
  }

  public get promptTemplateStore(): IPromptTemplateStore {
    return this.deps.promptTemplateStore;
  }

  public get toolRegistry(): IToolRegistry {
    return this.deps.toolRegistry;
  }

  public get trace(): ITrace {
    return this.deps.trace;
  }

  public get usageGuard(): IUsageGuard {
    return this.deps.usageGuard;
  }

  /** Step 11: the memory of the thread and of the user, after an answer, one update at a time per thread. */
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

  /** The work of `resume` on a RESULT_REVIEW pause (D99): the gate, then the settlement of the stored answer; no tools, no model step. `userContext` is the asker's (D32). */
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

  /** Runs one call of these users; refused with a 409 while one of them is being erased, which waits for it to end (D114). */
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

  /** Close the door, drain within the grace period, abort what is left, let the background work land. */
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
