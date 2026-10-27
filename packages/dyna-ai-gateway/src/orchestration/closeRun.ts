import {randomUUID} from "node:crypto";

import {
  IToolResultPart,
  EPartKind,
  ETurnRole,
} from "../contracts";
import {
  IRun,
  EPauseKind,
  ERunStatus,
  EThreadStatus,
  getUnresolvedToolCalls,
  makeRejectionOutput,
} from "../internal";
import {IAIGatewayDeps} from "../types";

import {appendTurns} from "./appendTurns";

/**
 * closeRun -- ends a run that will not continue
 *
 * # About
 *
 * > The thread is left as a provider accepts it: no tool call without a result.
 *
 * Every tool call the run stored in the thread that has no result gets one (a history with an unanswered tool call is
 * refused by the providers), the run takes `status`, the thread is open again. A rejected call reads like one the human
 * rejected: the pause's `rejectionText` (D87) or the default, plus the reason; a failed one carries `{error: reason}`.
 *
 * The unanswered calls are read from the thread, not from the run's messages: a settlement that broke after it stored its
 * turns is closed without a second result on a call already answered. Only the turns this run could have stored are read:
 * one per message of the run's conversation (`run.messages`, a bound on what the run stored before this call) plus the turns
 * the thread gained since `turnCountBefore` when the caller read it. Every call before the run is answered (the lease and
 * this function keep that invariant), so nothing older needs reading.
 *
 * # Who needs it
 *
 * `AIGateway.cancelRun`, `AIGateway.expirePausedRuns` (CANCELLED, rejected) and `AIGateway.continueRun` (FAILED, when the
 * resumed step or its settlement threw).
 *
 * # Pitfalls
 *
 * Reads the thread first: a thread that is gone is a 404 before the run's status changes. The caller decides what a failure
 * here means for the run.
 */
export const closeRun = async (
  {
    deps,
    tenantId,
    run,
    status,
    rejected,
    reason,
    turnCountBefore,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    run: IRun;
    status: ERunStatus;
    /** True: the human said no. False: the run broke; the tool result carries an error instead. */
    rejected: boolean;
    reason: string;
    /**
     * The thread's `turnCount` as the caller read it before the step that broke: the turns stored since are read too.
     * Omitted when the run stored nothing since `run.messages` (a cancel, an expiry, a step that never started).
     */
    turnCountBefore?: number;
  },
): Promise<void> => {
  const thread = await deps.threadStore.getThread({
    tenantId,
    threadId: run.threadId,
  });
  const storedSinceBefore = turnCountBefore === undefined ? 0 : Math.max(0, thread.turnCount - turnCountBefore);
  const storedTurns = await deps.threadStore.getLastTurns({
    tenantId,
    threadId: run.threadId,
    limit: run.messages.length + storedSinceBefore,
  });
  const unresolvedCalls = getUnresolvedToolCalls(storedTurns);
  // The policy's text for a rejection travels with each call's envelope (D87)
  const rejectionTexts = new Map<string, string>(
    (run.pending ?? []).flatMap(envelope => envelope.kind === EPauseKind.TOOL_APPROVAL && envelope.rejectionText !== undefined ? [[envelope.callId, envelope.rejectionText]] : []),
  );
  if (unresolvedCalls.length > 0) {
    await appendTurns({
      deps,
      tenantId,
      threadId: run.threadId,
      turns: [
        {
          id: randomUUID(),
          role: ETurnRole.TOOL,
          parts: unresolvedCalls.map((call): IToolResultPart => ({
            kind: EPartKind.TOOL_RESULT,
            callId: call.callId,
            toolName: call.toolName,
            output:
              rejected
                ? makeRejectionOutput({
                  rejectionText: rejectionTexts.get(call.callId),
                  reason,
                })
                : {error: reason},
            ...rejected ? {rejected: true} : {failed: true},
          })),
          createdAt: new Date(),
        },
      ],
    });
  }
  const stored = await deps.runStore.load({
    tenantId,
    runId: run.id,
  });
  if (stored.status !== status) {
    await deps.runStore.setStatus({
      tenantId,
      runId: run.id,
      status,
    });
  }
  await deps.threadStore.updateThread({
    tenantId,
    threadId: run.threadId,
    status: EThreadStatus.OPEN,
  });
};
