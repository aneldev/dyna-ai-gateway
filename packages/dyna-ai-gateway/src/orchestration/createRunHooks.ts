import {
  IToolDef,
  IUserContext,
  TToolCallPolicyResult,
} from "../contracts";
import {
  ILLMClientHooks,
  IResolvedTools,
  ELLMClientEventKind,
} from "../internal";
import {IAIGatewayDeps} from "../types";

import {TOnCallEventHandler} from "./startCall";

/** The decisions of a run, wired to the children: ToolRegistry executes, ToolPolicy decides the verdict on a call, which tool ends the run and the tools of a step. */
export const createRunHooks = (
  {
    deps,
    userContext,
    threadId,
    runId,
    resolved,
    holdText = false,
    onEvent,
  }: {
    deps: IAIGatewayDeps;
    userContext: IUserContext;
    threadId: string;
    /** The stored run, on a resume; a fresh run has none yet. Named in the failure reports. */
    runId?: string;
    resolved: IResolvedTools;
    /** True on a profile that reviews its answers (D99): the model's text is not streamed, nobody reads it before the reviewer. */
    holdText?: boolean;
    /** The call's stream (D38). */
    onEvent: TOnCallEventHandler;
  },
): ILLMClientHooks => {
  return {
    // The step's tools, not the run's: a tool `requires` hides for this step cannot be called by name (D72).
    // The refusal names what must run first (D88)
    executeTool: async ({
      call,
      tools,
      stepIndex,
      abortSignal,
    }): Promise<unknown> => {
      const callContext = {
        callId: call.callId,
        stepIndex,
        ...runId === undefined ? {} : {runId},
      };
      try {
        deps.toolPolicy.assertOfferedInStep({
          name: call.toolName,
          resolved,
          tools,
        });
      }
      catch (error) {
        // Refused before the registry: reported through the same channel as every other failed call
        deps.toolRegistry.reportFailure({
          name: call.toolName,
          input: call.input,
          userContext,
          threadId,
          callContext,
          error,
          startedAt: Date.now(),
        });
        throw error;
      }
      return deps.toolRegistry.execute({
        name: call.toolName,
        input: call.input,
        userContext,
        threadId,
        tools,
        abortSignal,
        callContext,
      });
    },
    decideToolCall: ({call}): Promise<TToolCallPolicyResult> => deps.toolPolicy.decide({
      name: call.toolName,
      input: call.input,
      userContext,
      resolved,
    }),
    endsRun: ({
      call,
      output,
    }): Promise<boolean> => deps.toolPolicy.endsRun({
      name: call.toolName,
      input: call.input,
      output,
      userContext,
      resolved,
    }),
    prepareStep: ({
      stepIndex,
      executed,
    }): IToolDef[] => deps.toolPolicy.narrowForStep({
      resolved,
      executed,
      stepIndex,
    }).tools,
    onEvent: holdText
      ? (args): void => {
        if (args.event.kind !== ELLMClientEventKind.TEXT_DELTA) onEvent(args);
      }
      : onEvent,
  };
};
