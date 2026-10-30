import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {
  IChunk,
  IIssue,
  ISkill,
  IToolResultPart,
  IUserContext,
  EIssueSeverity,
  EPartKind,
  ETurnRole,
} from "../contracts";
import {
  IAIProfile,
  IMessage,
  IModelRequest,
  IRun,
  IRunOutcome,
  IUsageDeniedErrorData,
  EFinishReason,
  EMessageRole,
  ERunOutcomeStatus,
  ERunStatus,
  EThreadStatus,
  getUnresolvedToolCalls,
  joinSystem,
  makePauseEnvelopeDraft,
  withoutInlineBytes,
  withoutOutputSchema,
  isUsageDeniedError,
} from "../internal";
import {
  IAIGatewayDeps,
  IGatewayRunInput,
  IPausedResponse,
  TGatewayResponse,
  EGatewayResponseKind,
} from "../types";

import {abortReason} from "./abortReason";
import {annotateJudgeTraces} from "./annotateJudgeTraces";
import {annotateTraces} from "./annotateTraces";
import {findPrompt} from "./findPrompt";
import {appendTurns} from "./appendTurns";
import {
  ICheckedOutput,
  checkOutput,
} from "./checkOutput";
import {emitAnswerWithdrawn} from "./emitAnswerWithdrawn";
import {makeAbortedResponse} from "./makeAbortedResponse";
import {ICallSignal} from "./makeCallSignal";
import {makeFailedResponse} from "./makeFailedResponse";
import {
  USAGE_DENIED_REASON,
  makeUsageDeniedIssue,
} from "./makeUsageDeniedResponse";
import {settleReviewPause} from "./settleReviewPause";
import {TOnCallEventHandler} from "./startCall";

/**
 * settleRun -- stores what a run produced and shapes its response
 *
 * # About
 *
 * > After `LLMClient.run` returns, for `run()` and `resume()` alike.
 *
 * - PAUSED: the run is stored through HumanGate with the envelope of the pending call (approval or userQuestions, D62),
 *   the turns so far are appended, the thread waits for a human. With the call's signal already aborted (the stop landed
 *   between the loop and here) the outcome is settled as ABORTED instead: an aborted run never pauses (D90).
 * - DONE: the answer is checked first; the turns are appended, a resumed run is closed and its thread reopened.
 *   The tool turns are always stored, the tools did run; the final answer is stored only when it passed the checks (D70).
 *   An answer that passed on a profile with `reviewAnswers` is not stored yet: the run pauses for a human with the answer
 *   (`settleReviewPause`, D99); a blocked answer is FAILED as always, never reviewed.
 * - ABORTED, or the call's signal fired during the output check (D90): the turns of the completed steps are stored as for a
 *   blocked answer, a tool call the abort cut gets an error result, a resumed run is closed FAILED and its thread reopened;
 *   the response is the aborted one, and ANSWER_WITHDRAWN is sent when the answer was already streamed.
 *
 * # Who needs it
 *
 * `AIGateway.executeRun` and `AIGateway.executeResume`.
 */
export const settleRun = async <TStructured>(
  {
    deps,
    userContext,
    threadId,
    profile,
    request,
    toolNames,
    outcome,
    sentMessages,
    outputSchema,
    issues,
    templateVersion,
    chunks = [],
    startTurnCount,
    skills,
    previousRun,
    debug = false,
    onEvent,
    callSignal,
  }: {
    deps: IAIGatewayDeps;
    userContext: IUserContext;
    threadId: string;
    profile: IAIProfile;
    request: IModelRequest;
    toolNames: string[];
    outcome: IRunOutcome;
    /** How many of outcome.messages the gateway sent; the rest is what the run produced. */
    sentMessages: number;
    outputSchema: IGatewayRunInput<TStructured>["outputSchema"];
    issues: IIssue[];
    /** Version of CHAT_MAIN the request was rendered from; omitted on a resume: the stored run's (D36). */
    templateVersion?: number;
    /**
     * The knowledge-base chunks in the request: the evidence of the output rules, and for a fresh run the citations of the
     * answer. None on a resume: its request is the stored one, and the citations are the stored run's `chunkIds` (D36).
     */
    chunks?: IChunk[];
    /** The thread's turn count before the run's question was stored; omitted on a resume: the stored run's (D36). */
    startTurnCount?: number;
    /** The skills the call brought (D124), stored on the run for its resumes; omitted on a resume: the stored run's. */
    skills?: ISkill[];
    /** The run being resumed; omitted for a fresh run. */
    previousRun?: IRun;
    /** Attach the transcript to the answer (IGatewayRunInput.debug). */
    debug?: boolean;
    /** The call's stream (D38): ANSWER_WITHDRAWN goes there when the answer fails the checks (D74). */
    onEvent: TOnCallEventHandler;
    /**
     * The call's signal: for the output rules and their judge calls, the pause that is not taken once it fired,
     * and the words of an aborted outcome.
     */
    callSignal?: ICallSignal;
  },
): Promise<TGatewayResponse<TStructured>> => {
  const {tenantId} = userContext;
  const producedMessages = outcome.messages.slice(sentMessages);
  // A resumed run remembers what its first step had (D36): a fresh run brings it, a resumed one reads it from the stored run
  const remembered: IRunMemory = previousRun
    ? {
      startTurnCount: previousRun.startTurnCount,
      chunkIds: previousRun.chunkIds,
      templateVersion: previousRun.templateVersion,
      ...previousRun.skills && {skills: previousRun.skills},
    }
    : requireRunMemory({
      threadId,
      startTurnCount,
      chunkIds: chunks.map(chunk => chunk.id),
      templateVersion,
      skills,
    });
  const {
    chunkIds,
    templateVersion: rememberedTemplateVersion,
  } = remembered;
  const settleArgs = {
    deps,
    tenantId,
    threadId,
    request,
    outcome,
    issues,
    chunkIds,
    templateVersion: rememberedTemplateVersion,
    previousRun,
    onEvent,
  };

  if (outcome.status === ERunOutcomeStatus.ABORTED) {
    if (!callSignal) {
      throw dynaError({
        code: 5376412760037,
        status: 500,
        message: "AIGateway: the LLMClient returned an aborted run, but the call has no signal",
        data: {threadId},
      });
    }
    return settleAbortedRun({
      ...settleArgs,
      callSignal,
      producedMessages,
      answerStreamed: false,
    });
  }

  if (outcome.status === ERunOutcomeStatus.PAUSED) {
    // The stop landed between the loop's pause and this settlement: an aborted run never pauses
    if (callSignal?.signal.aborted) {
      return settleAbortedRun({
        ...settleArgs,
        callSignal,
        producedMessages,
        answerStreamed: false,
      });
    }
    const pendingCalls = outcome.pendingCalls ?? [];
    if (pendingCalls.length === 0) {
      throw dynaError({
        code: 5372584062318,
        status: 500,
        message: "AIGateway: the LLMClient returned a paused run without a pending tool call",
        data: {threadId},
      });
    }
    const {
      messages: _sentMessages,
      ...requestWithoutMessages
    } = request;
    const now = new Date();
    const envelopes = await deps.humanGate.pause({
      tenantId,
      run: {
        id: previousRun?.id ?? randomUUID(),
        tenantId,
        threadId,
        userId: previousRun?.userId ?? userContext.userId,
        profileId: profile.id,
        status: ERunStatus.PAUSED,
        // No zod schema in the run: the caller hands it to `resume` again (D36)
        request: withoutOutputSchema(requestWithoutMessages),
        toolNames,
        // No copy of an uploaded file in the run: a resume loads the bytes again (restoreInlineBytes)
        messages: withoutInlineBytes(outcome.messages),
        ...remembered,
        steps: (previousRun?.steps ?? 0) + outcome.steps,
        createdAt: previousRun?.createdAt ?? now,
        updatedAt: now,
      },
      envelopes: pendingCalls.map(pendingCall => makePauseEnvelopeDraft({
        toolCall: pendingCall.call,
        rejectionText: pendingCall.rejectionText,
        reasonCode: pendingCall.reasonCode,
      })),
    });
    await appendTurns({
      deps,
      tenantId,
      threadId,
      turns: deps.turnBuilder.buildAssistantTurns({
        // A paused run has no final result yet: the model id and the usage so far are what the turns need
        result: {
          modelId: request.modelId,
          text: "",
          toolCalls: [],
          finishReason: EFinishReason.TOOL_CALLS,
          usage: outcome.usage,
          latencyMs: 0,
          traceId: outcome.traceIds[outcome.traceIds.length - 1] ?? "",
        },
        runMessages: producedMessages,
      }),
    });
    await deps.threadStore.updateThread({
      tenantId,
      threadId,
      status: EThreadStatus.AWAITING_HUMAN,
    });
    await annotateTraces({
      deps,
      tenantId,
      traceIds: outcome.traceIds,
      chunkIds,
      issues,
      templateVersion: rememberedTemplateVersion,
    });
    const [first, ...rest] = envelopes;
    if (!first) {
      throw dynaError({
        code: 5376634521055,
        status: 500,
        message: "AIGateway: the pause stored no envelope",
        data: {threadId},
      });
    }
    const paused: IPausedResponse = {
      kind: EGatewayResponseKind.PAUSED,
      threadId,
      pauseId: first.pauseId,
      envelopes: [first, ...rest],
    };
    return paused;
  }

  const result = outcome.result;
  if (!result) {
    throw dynaError({
      code: 5372584062330,
      status: 500,
      message: "AIGateway: the LLMClient returned a finished run without a result",
      data: {threadId},
    });
  }
  // A step after the first that the usage adapter refused ended the run (finishReason LENGTH): the answer so far carries it as a warning
  const runIssues = outcome.usageDenied
    ? [...issues, makeUsageDeniedIssue({
      denied: outcome.usageDenied,
      severity: EIssueSeverity.WARNING,
    })]
    : issues;
  let checked: ICheckedOutput<TStructured>;
  let outputDenied: IUsageDeniedErrorData | undefined;
  try {
    checked = await checkOutput({
      deps,
      result,
      outputSchema,
      prompt: findPrompt({messages: outcome.messages}),
      userContext,
      profile,
      threadId,
      chunks,
      toolResults: producedMessages.flatMap(message => message.parts.filter((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT)),
      issues: runIssues,
      abortSignal: callSignal?.signal,
    });
  }
  catch (error) {
    if (isUsageDeniedError(error)) {
      // An output judge's call the usage adapter refused: the answer nobody checked is withdrawn, as a blocked one
      outputDenied = error.data;
      checked = {
        structured: undefined,
        ok: false,
        issues: [...runIssues, makeUsageDeniedIssue({
          denied: error.data,
          severity: EIssueSeverity.ERROR,
        })],
        traceIds: [],
      };
    }
    else {
      if (!callSignal?.signal.aborted) throw error;
      if (error !== callSignal.signal.reason) {
        console.error("Internal error 5376412760051: AIGateway: the run was aborted but the output check failed with another error", error);
      }
      // The answer was streamed and is now withdrawn: stored like a blocked one, without its text
      return settleAbortedRun({
        ...settleArgs,
        callSignal,
        producedMessages: withoutFinalAnswer(producedMessages),
        answerStreamed: true,
      });
    }
  }
  if (checked.ok && profile.reviewAnswers) {
    // The stop landed in the output check's last write: an aborted run never pauses, the streamed answer is withdrawn
    if (callSignal?.signal.aborted) {
      return settleAbortedRun({
        ...settleArgs,
        callSignal,
        producedMessages: withoutFinalAnswer(producedMessages),
        answerStreamed: true,
      });
    }
    return settleReviewPause({
      deps,
      userContext,
      threadId,
      profile,
      request,
      toolNames,
      outcome,
      result,
      checked,
      toolMessages: withoutFinalAnswer(producedMessages),
      remembered,
      previousRun,
      onEvent,
    });
  }
  await appendTurns({
    deps,
    tenantId,
    threadId,
    turns: deps.turnBuilder.buildAssistantTurns({
      result: {
        ...result,
        usage: outcome.usage,
      },
      runMessages: checked.ok ? producedMessages : withoutFinalAnswer(producedMessages),
    }),
  });
  if (previousRun) {
    await deps.runStore.setStatus({
      tenantId,
      runId: previousRun.id,
      status: ERunStatus.DONE,
    });
    await deps.threadStore.updateThread({
      tenantId,
      threadId,
      status: EThreadStatus.OPEN,
    });
  }
  await annotateTraces({
    deps,
    tenantId,
    traceIds: outcome.traceIds,
    chunkIds,
    issues: checked.issues,
    templateVersion: rememberedTemplateVersion,
  });
  await annotateJudgeTraces({
    deps,
    tenantId,
    traceIds: checked.traceIds,
    issues: checked.issues,
  });
  if (!checked.ok) {
    emitAnswerWithdrawn({
      onEvent,
      issues: checked.issues,
      stepIndex: Math.max(0, outcome.steps - 1),
    });
  }

  const response: TGatewayResponse<TStructured> = checked.ok
    ? {
      kind: EGatewayResponseKind.ANSWER,
      threadId,
      text: result.text,
      structured: checked.structured,
      citations: chunkIds,
      issues: checked.issues,
      usage: outcome.usage,
      ...outcome.endedByTool && {endedByTool: outcome.endedByTool},
      ...debug && {
        debug: {
          system: joinSystem({blocks: request.system}),
          messages: outcome.messages,
          steps: outcome.steps,
          ...previousRun && {
            run: {
              ...previousRun,
              status: ERunStatus.DONE,
            },
          },
        },
      },
    }
    : makeFailedResponse({
      threadId,
      reason: outputDenied ? USAGE_DENIED_REASON : "The answer did not pass the checks",
      issues: checked.issues,
    });
  return response;
};

/**
 * Stores what an aborted run leaves behind and shapes its FAILED response (D90): the turns of the completed steps, an error result
 * for a tool call the abort cut (a history with an unanswered call is refused by the providers), a resumed run FAILED and its
 * thread open again; ANSWER_WITHDRAWN on the stream when the answer had already been streamed.
 */
const settleAbortedRun = async (
  {
    deps,
    tenantId,
    threadId,
    request,
    outcome,
    producedMessages,
    issues,
    chunkIds,
    templateVersion,
    previousRun,
    callSignal,
    answerStreamed,
    onEvent,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    threadId: string;
    request: IModelRequest;
    outcome: IRunOutcome;
    producedMessages: IMessage[];
    issues: IIssue[];
    chunkIds: string[];
    templateVersion?: number;
    previousRun?: IRun;
    callSignal: ICallSignal;
    answerStreamed: boolean;
    onEvent: TOnCallEventHandler;
  },
): Promise<TGatewayResponse<never>> => {
  const reason = abortReason({callSignal});
  const unresolvedCalls = getUnresolvedToolCalls(outcome.messages);
  const turns = [
    ...producedMessages.length === 0
      ? []
      : deps.turnBuilder.buildAssistantTurns({
        // No final result: the model id and the usage so far are what the turns need
        result: {
          modelId: request.modelId,
          text: "",
          toolCalls: [],
          finishReason: EFinishReason.STOP,
          usage: outcome.usage,
          latencyMs: 0,
          traceId: outcome.traceIds[outcome.traceIds.length - 1] ?? "",
        },
        runMessages: producedMessages,
      }),
    ...unresolvedCalls.length === 0
      ? []
      : [{
        id: randomUUID(),
        role: ETurnRole.TOOL,
        parts: unresolvedCalls.map((call): IToolResultPart => ({
          kind: EPartKind.TOOL_RESULT,
          callId: call.callId,
          toolName: call.toolName,
          output: {error: reason},
          failed: true,
        })),
        createdAt: new Date(),
      }],
  ];
  if (turns.length > 0) {
    await appendTurns({
      deps,
      tenantId,
      threadId,
      turns,
    });
  }
  if (previousRun) {
    await deps.runStore.setStatus({
      tenantId,
      runId: previousRun.id,
      status: ERunStatus.FAILED,
    });
    await deps.threadStore.updateThread({
      tenantId,
      threadId,
      status: EThreadStatus.OPEN,
    });
  }
  const response = makeAbortedResponse({
    threadId,
    callSignal,
  });
  await annotateTraces({
    deps,
    tenantId,
    traceIds: outcome.traceIds,
    chunkIds,
    issues: [...issues, ...response.issues],
    templateVersion,
  });
  if (answerStreamed) {
    emitAnswerWithdrawn({
      onEvent,
      issues: response.issues,
      stepIndex: Math.max(0, outcome.steps - 1),
    });
  }
  return response;
};

/** The produced messages without the text of the final assistant message: a blocked answer leaves the tool turns only. */
const withoutFinalAnswer = (messages: IMessage[]): IMessage[] => {
  const last = messages[messages.length - 1];
  if (!last || last.role !== EMessageRole.ASSISTANT) return messages;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      parts: last.parts.filter(part => part.kind !== EPartKind.TEXT),
    },
  ];
};

/** What a stored run keeps of its first step, so a resumed run is not poorer than a fresh one (D36); `skills` when the call brought any (D124). */
export interface IRunMemory {
  startTurnCount: number;
  chunkIds: string[];
  templateVersion: number;
  skills?: ISkill[];
}

/** A fresh run must bring its turn count and template version: a settlement without them is a gateway bug, not a resume. */
const requireRunMemory = (
  {
    threadId,
    startTurnCount,
    chunkIds,
    templateVersion,
    skills,
  }: {
    threadId: string;
    startTurnCount?: number;
    chunkIds: string[];
    templateVersion?: number;
    skills?: ISkill[];
  },
): IRunMemory => {
  if (startTurnCount === undefined || templateVersion === undefined) {
    throw dynaError({
      code: 5379462948326,
      status: 500,
      message: "AIGateway: a fresh run is settled without its startTurnCount or templateVersion",
      data: {
        threadId,
        startTurnCount,
        templateVersion,
      },
    });
  }
  return {
    startTurnCount,
    chunkIds,
    templateVersion,
    ...skills !== undefined && skills.length > 0 && {skills},
  };
};
