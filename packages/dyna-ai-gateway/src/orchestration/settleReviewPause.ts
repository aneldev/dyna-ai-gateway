import {randomUUID} from "node:crypto";
import {dynaError} from "dyna-error";

import {IUserContext} from "../contracts";
import {
  IAIProfile,
  IMessage,
  IModelRequest,
  IModelResult,
  IRun,
  IRunOutcome,
  EFinishReason,
  ELLMClientEventKind,
  ERunStatus,
  EThreadStatus,
  makeResultReviewDraft,
  withoutInlineBytes,
  withoutOutputSchema,
} from "../internal";
import {
  IAIGatewayDeps,
  IPausedResponse,
  EGatewayResponseKind,
} from "../types";

import {ICheckedOutput} from "./checkOutput";
import {IRunMemory} from "./settleRun";
import {TOnCallEventHandler} from "./startCall";

import {annotateJudgeTraces} from "./annotateJudgeTraces";
import {annotateTraces} from "./annotateTraces";
import {appendTurns} from "./appendTurns";
import {withoutReviewedAnswer} from "./withoutReviewedAnswer";

/**
 * settleReviewPause -- stores a finished run whose answer waits for a human (D99)
 *
 * # About
 *
 * > The answer passed the checks; the profile says a human reads it before the user does.
 *
 * The tool turns of the run are appended (the tools did run), the final answer is not: it is kept on the run (`IRun.answer`,
 * what the settlement had in hand) and shown to the reviewer in the envelope. The run is stored PAUSED through HumanGate,
 * the thread waits for a human, the traces are annotated as for a delivered answer, and the stream gets `RUN_PAUSED`
 * without a tool call. The decision (`AIGateway.resume`) finishes the run without a model step.
 *
 * # Who needs it
 *
 * `settleRun`, in its DONE branch, when `profile.reviewAnswers` is set and the output checks passed.
 */
export const settleReviewPause = async <TStructured>(
  {
    deps,
    userContext,
    threadId,
    profile,
    request,
    toolNames,
    outcome,
    result,
    checked,
    toolMessages,
    remembered,
    previousRun,
    onEvent,
  }: {
    deps: IAIGatewayDeps;
    userContext: IUserContext;
    threadId: string;
    profile: IAIProfile;
    request: IModelRequest;
    toolNames: string[];
    outcome: IRunOutcome;
    /** The final step of the run, as the LLMClient returned it. */
    result: IModelResult;
    /** The passed output check: the parsed answer, the warnings and the judge traces. */
    checked: ICheckedOutput<TStructured>;
    /** The messages the run produced without the text of the final answer: the tool turns to store now. */
    toolMessages: IMessage[];
    /** What the run keeps of its first step (D36): stored on it, cited by the answer, annotated on the traces. */
    remembered: IRunMemory;
    /** The run being resumed; omitted for a fresh run. */
    previousRun?: IRun;
    onEvent: TOnCallEventHandler;
  },
): Promise<IPausedResponse> => {
  const {tenantId} = userContext;
  const {
    messages: _sentMessages,
    ...requestWithoutMessages
  } = request;
  const {
    chunkIds,
    templateVersion,
  } = remembered;
  const now = new Date();
  const [envelope] = await deps.humanGate.pause({
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
      // No copy of an uploaded file in the run
      messages: withoutInlineBytes(outcome.messages),
      ...remembered,
      answer: {
        result: {
          ...result,
          usage: outcome.usage,
        },
        ...checked.structured === undefined ? {} : {structured: checked.structured},
        chunkIds,
        issues: checked.issues,
        ...outcome.endedByTool === undefined ? {} : {endedByTool: outcome.endedByTool},
      },
      steps: (previousRun?.steps ?? 0) + outcome.steps,
      createdAt: previousRun?.createdAt ?? now,
      updatedAt: now,
    },
    envelopes: [makeResultReviewDraft({
      text: result.text,
      structured: checked.structured,
      citations: chunkIds,
      issues: checked.issues,
    })],
  });
  if (!envelope) {
    throw dynaError({
      code: 5376634521067,
      status: 500,
      message: "AIGateway: the review pause stored no envelope",
      data: {threadId},
    });
  }
  const toolTurns = deps.turnBuilder.buildAssistantTurns({
    // The answer is not stored yet: the model id and the usage so far are what the tool turns need
    result: {
      modelId: request.modelId,
      text: "",
      toolCalls: [],
      finishReason: EFinishReason.STOP,
      usage: outcome.usage,
      latencyMs: 0,
      traceId: outcome.traceIds[outcome.traceIds.length - 1] ?? "",
    },
    runMessages: toolMessages,
  });
  if (toolTurns.length > 0) {
    await appendTurns({
      deps,
      tenantId,
      threadId,
      turns: toolTurns,
    });
  }
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
    issues: checked.issues,
    templateVersion,
  });
  await annotateJudgeTraces({
    deps,
    tenantId,
    traceIds: checked.traceIds,
    issues: checked.issues,
  });
  onEvent({
    event: {
      kind: ELLMClientEventKind.RUN_PAUSED,
      stepIndex: Math.max(0, outcome.steps - 1),
    },
  });
  return {
    kind: EGatewayResponseKind.PAUSED,
    threadId,
    pauseId: envelope.pauseId,
    // The draft is the reviewer's: the asker's response names the pause, not its answer (getPausedRun reads it)
    envelopes: [withoutReviewedAnswer(envelope)],
  };
};
