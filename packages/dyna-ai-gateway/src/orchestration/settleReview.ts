import {dynaError} from "dyna-error";

import {
  IUserContext,
  EIssueSeverity,
} from "../contracts";
import {
  IRun,
  IStoredAnswer,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
  IResumeDecision,
} from "../internal";
import {
  IAIGatewayDeps,
  IFailedResponse,
  TGatewayResponse,
  ANSWER_REJECTED_ISSUE_CODE,
  EGatewayResponseKind,
} from "../types";

import {appendTurns} from "./appendTurns";
import {emitAnswerWithdrawn} from "./emitAnswerWithdrawn";
import {makeFailedResponse} from "./makeFailedResponse";
import {IEditedAnswer} from "./parseEditedAnswer";
import {TOnCallEventHandler} from "./startCall";

/**
 * settleReview -- finishes a run whose answer a human reviewed (D99)
 *
 * # About
 *
 * > The reviewer decided; no model is called.
 *
 * The run left PAUSED with the human's decision on the answer kept on it (`IRun.answer`). APPROVE stores the answer as the
 * assistant turn and returns the ANSWER the run would have returned without the review: the run's usage, citations,
 * warnings and the tool that ended it. EDIT does the same with the reviewer's text (`edited`, already parsed through the
 * run's schema) in place of the model's; the usage, the model id and the trace stay the model's, it wrote the draft.
 * The run is DONE with `pending` and `answer` cleared, the thread is open again. REJECT drops the answer: nothing is
 * stored, the run is CANCELLED, the thread is open again, the response is FAILED with the reviewer's reason and the issue
 * `answer_rejected`, and the stream gets ANSWER_WITHDRAWN (the client rendered the draft while it streamed).
 *
 * # Who needs it
 *
 * `AIGateway.continueRun`, for a run whose pause is a RESULT_REVIEW, after `HumanGate.resume` let the decision through.
 *
 * # What needs
 *
 * `run.answer` must be present: a review pause without it is a 500, the run was stored by something else than the gateway.
 *
 * # Pitfalls
 *
 * Throws leave the run RUNNING: the caller closes it (`closeRun`), as for a resumed step that failed.
 */
export const settleReview = async <TStructured>(
  {
    deps,
    userContext,
    run,
    decision,
    edited,
    debug,
    onEvent,
  }: {
    deps: IAIGatewayDeps;
    userContext: IUserContext;
    /** The run as `HumanGate.resume` returned it: RUNNING, with `answer` still on it. */
    run: IRun;
    decision: IResumeDecision;
    /** The reviewer's text of an EDIT, parsed (`parseEditedAnswer`); omitted for the other decisions. */
    edited?: IEditedAnswer;
    /** Attach the transcript to the answer (IGatewayAskInput.debug). */
    debug: boolean;
    /** The call's stream: ANSWER_WITHDRAWN on a REJECT. */
    onEvent: TOnCallEventHandler;
  },
): Promise<TGatewayResponse<TStructured>> => {
  const {tenantId} = userContext;
  const stored = getStoredAnswer(run);

  if (decision.action === EResumeAction.REJECT) {
    return rejectAnswer({
      deps,
      tenantId,
      run,
      reason: decision.text,
      onEvent,
    });
  }
  if (decision.action !== EResumeAction.APPROVE && decision.action !== EResumeAction.EDIT) {
    throw dynaError({
      code: 5377120443023,
      status: 400,
      message: `AIGateway: the decision [${decision.action}] does not apply to a reviewed answer`,
      data: {
        runId: run.id,
        action: decision.action,
      },
    });
  }

  const answer: IStoredAnswer = edited
    ? {
      ...stored,
      result: {
        ...stored.result,
        text: edited.text,
      },
      ...edited.structured === undefined ? {} : {structured: edited.structured},
    }
    : stored;
  await appendTurns({
    deps,
    tenantId,
    threadId: run.threadId,
    turns: deps.turnBuilder.buildAssistantTurns({result: answer.result}),
  });
  const settled: IRun = {
    ...run,
    status: ERunStatus.DONE,
    pending: undefined,
    answer: undefined,
    updatedAt: new Date(),
  };
  await deps.runStore.save({run: settled});
  await deps.threadStore.updateThread({
    tenantId,
    threadId: run.threadId,
    status: EThreadStatus.OPEN,
  });

  return {
    kind: EGatewayResponseKind.ANSWER,
    threadId: run.threadId,
    text: answer.result.text,
    // The stored value passed the schema when the run paused, or the reviewer's edit was parsed with it (D36)
    structured: answer.structured as TStructured | undefined,
    citations: answer.chunkIds,
    issues: answer.issues,
    usage: answer.result.usage,
    ...answer.endedByTool === undefined ? {} : {endedByTool: answer.endedByTool},
    ...debug && {
      debug: {
        system: run.request.system,
        messages: run.messages,
        steps: run.steps,
        run: settled,
      },
    },
  };
};

/** Drops the reviewed answer: no turn, the run CANCELLED with `pending` and `answer` cleared, the thread open, FAILED with the reason. */
const rejectAnswer = async (
  {
    deps,
    tenantId,
    run,
    reason = "The answer was rejected by the reviewer",
    onEvent,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    run: IRun;
    reason?: string;
    onEvent: TOnCallEventHandler;
  },
): Promise<IFailedResponse> => {
  await deps.runStore.save({
    run: {
      ...run,
      status: ERunStatus.CANCELLED,
      pending: undefined,
      answer: undefined,
      updatedAt: new Date(),
    },
  });
  await deps.threadStore.updateThread({
    tenantId,
    threadId: run.threadId,
    status: EThreadStatus.OPEN,
  });
  const response = makeFailedResponse({
    threadId: run.threadId,
    reason,
    issues: [{
      code: ANSWER_REJECTED_ISSUE_CODE,
      message: reason,
      severity: EIssueSeverity.ERROR,
    }],
  });
  emitAnswerWithdrawn({
    onEvent,
    issues: response.issues,
    stepIndex: Math.max(0, run.steps - 1),
  });
  return response;
};

/** The answer a review pause kept on the run; a run without one was not paused by the gateway. */
const getStoredAnswer = (run: IRun): IStoredAnswer => {
  if (!run.answer) {
    throw dynaError({
      code: 5377120443035,
      status: 500,
      message: `AIGateway: run [${run.id}] is paused for a review but holds no answer`,
      data: {runId: run.id},
    });
  }
  return run.answer;
};
