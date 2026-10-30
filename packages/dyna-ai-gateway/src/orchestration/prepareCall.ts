import {dynaError} from "dyna-error";

import {
  IChunk,
  IIssue,
  ISkill,
} from "../contracts";
import {
  IAIProfile,
  IAssembledContext,
  IResolvedTools,
  IThread,
  EThreadStatus,
} from "../internal";
import {
  IAIGatewayConfig,
  IAIGatewayDeps,
  IFailedResponse,
  IGatewayRunInput,
} from "../types";

import {annotateJudgeTraces} from "./annotateJudgeTraces";
import {appendTurns} from "./appendTurns";
import {getBuiltInToolNames} from "./getBuiltInToolNames";
import {loadInlineFiles} from "./loadInlineFiles";
import {makeAbortedResponse} from "./makeAbortedResponse";
import {ICallSignal} from "./makeCallSignal";
import {makeFailedResponse} from "./makeFailedResponse";

/** What steps 1–6 produce for ask() and run(). */
export interface IPreparedCall {
  profile: IAIProfile;
  /** The thread as it was before this call added its user turn: its turnCount is the count before the call. */
  thread: IThread;
  /** The tools of the call and which of them need approval; empty for ask(). */
  resolved: IResolvedTools;
  /** The skills of the call (D124): the profile's, then the call's, validated; what a run remembers. */
  skills: ISkill[];
  context: IAssembledContext;
  /** What the call reports before the model ran: the input rules' WARNINGs, then the assembler's (files dropped, turns trimmed). */
  issues: IIssue[];
  /** The knowledge-base chunks in the request (the hits the Assembler kept), in the order of context.chunkIds. */
  chunks: IChunk[];
}

export const isFailedResponse = (prepared: IPreparedCall | IFailedResponse): prepared is IFailedResponse =>
  "kind" in prepared;

/**
 * Steps 1–6, shared by ask() and run(): profile and model (and the skills of the call, D124), input check, thread and the user turn,
 * the knowledge-base search inside the caller's kbFilters, the tools (with `load_skill` when a run has skills), the request
 * (the ContextAssembler asks the working memory for the thread's window; a run lists the skills, an ask inlines them).
 * Returns FAILED for a rejected prompt (nothing is created then) and for a call seen aborted between the steps: before the thread
 * nothing is stored, after it the user turn is (`makeAbortedResponse`); an abort inside the input check is thrown as the signal's
 * reason, as the rules do. A model call the usage adapter refuses (the query rewrite, the search's embedding) is thrown too.
 */
export const prepareCall = async <TStructured>(
  {
    deps,
    config,
    input,
    withTools,
    callSignal,
  }: {
    deps: IAIGatewayDeps;
    config: IAIGatewayConfig;
    /** Run()'s input, the superset; ask()'s fits it too (D104). */
    input: IGatewayRunInput<TStructured>;
    /** Run(): resolve the tools for the model. ask(): none. */
    withTools: boolean;
    /**
     * The call's signal, built by the gateway from the input.
     * For the input rules and their judge calls; checked between the steps.
     */
    callSignal?: ICallSignal;
  },
): Promise<IPreparedCall | IFailedResponse> => {
  const {
    userContext,
    threadId,
    profileId,
    prompt,
    instructions,
    context: callContext,
    files = [],
    outputSchema,
    outputFormat,
    temperature,
    activeTools,
    additionalTools,
    skills: callSkills,
  } = input;
  const abortSignal = callSignal?.signal;
  const {
    tenantId,
    userId,
  } = userContext;

  // 1. Profile and model
  const profile = await deps.aiProfileStore.getProfile({
    tenantId,
    profileId,
  });
  // A review needs a run to pause (D99): an ask() on a reviewing profile is refused before anything is stored, never answered unreviewed
  if (!withTools && profile.reviewAnswers) {
    throw dynaError({
      code: 5377120443011,
      status: 400,
      message: `AIGateway: profile [${profile.id}] reviews its answers (reviewAnswers), which ask() cannot pause for; use run() on this profile`,
      userMessage: "This AI profile needs a human to review its answers, which this kind of call cannot do; please use another AI profile",
      data: {profileId: profile.id},
    });
  }
  const model = await deps.modelRegistry.getModel({modelId: profile.modelId});
  // A dev error, refused before anything is stored or paid for (D82)
  if (temperature !== undefined && !model.caps.temperature) {
    throw dynaError({
      code: 5376006538702,
      status: 400,
      message: `AIGateway: model [${model.id}] of profile [${profile.id}] does not accept a temperature (caps.temperature is false); omit it for this profile`,
      data: {
        modelId: model.id,
        profileId: profile.id,
        temperature,
      },
    });
  }

  // The skills of the call, before the input check and before anything is stored: a duplicate name costs no judge call and creates nothing (D124)
  const skills = deps.skillRegistry.resolve({
    profile,
    skills: callSkills,
  });

  // The bytes of the question's files, before anything is stored: a pointer that cannot be loaded creates nothing.
  // Before the input check: the rules' judge sends them to the model.
  const inlineFiles = await loadInlineFiles({
    deps,
    tenantId,
    userId,
    files,
  });

  // 2. Input check
  const inputCheck = await deps.guardrails.checkInput({
    prompt,
    files,
    inlineFiles,
    userContext,
    profile,
    threadId,
    abortSignal,
  });
  // The judge entries of the check carry its issues, so a rejected prompt is readable in the trace (D73)
  await annotateJudgeTraces({
    deps,
    tenantId,
    traceIds: inputCheck.traceIds,
    issues: inputCheck.issues,
  });
  if (!inputCheck.ok) {
    return makeFailedResponse({
      threadId,
      reason: "The prompt was rejected",
      issues: inputCheck.issues,
    });
  }

  // The tools, before anything is stored: an activeTools name the profile does not allow is a 400 that creates nothing.
  // A run with skills gets `load_skill`, a built-in of this call only: built from the call's skills, not registered (D124)
  const loadSkillTool =
    withTools && skills.length > 0
      ? [deps.skillRegistry.makeLoadSkillTool({skills})]
      : [];
  const resolved: IResolvedTools = withTools
    ? deps.toolPolicy.resolve({
      allTools: [...deps.toolRegistry.list(), ...loadSkillTool],
      additionalTools,
      profile,
      userContext,
      caps: model.caps,
      activeTools,
      builtInTools: [
        ...getBuiltInToolNames({config}),
        ...loadSkillTool.map(tool => tool.name),
      ],
    })
    : {
      tools: [],
      approvals: new Set(),
    };

  // A call stopped during the input check creates nothing: its thread and turn would be a conversation nobody waits for
  if (callSignal?.signal.aborted) {
    return makeAbortedResponse({
      threadId,
      callSignal,
    });
  }

  // 3. Thread and the user turn. The thread is the caller's: ask() and run() checked it before the lease (D32)
  // Read again under the lease, for its status
  const thread = threadId
    ? await deps.threadStore.getThread({
      tenantId,
      threadId,
    })
    : await deps.threadStore.createThread({
      tenantId,
      userId,
    });
  if (thread.status === EThreadStatus.AWAITING_HUMAN) {
    throw dynaError({
      code: 5372584062306,
      status: 409,
      message: `AIGateway: thread [${thread.id}] waits for a human decision on a paused run; resume or cancel it first`,
      data: {threadId: thread.id},
    });
  }
  await appendTurns({
    deps,
    tenantId,
    threadId: thread.id,
    turns: [
      deps.turnBuilder.buildUserTurn({
        prompt: inputCheck.prompt,
        files,
      }),
    ],
  });

  // 4. What the call needs: the user's facts, and the thread's memory for the query rewriter
  const userFacts = await deps.userMemoryStore.getFacts({
    tenantId,
    userId,
  });
  const memoryState = await deps.workingMemory.getState({
    tenantId,
    threadId: thread.id,
  });

  // 5. Knowledge base (the tools were resolved after the input check)
  // The search does not take the signal: a call stopped since the turn was stored does not pay for a search it cannot use
  if (callSignal?.signal.aborted) {
    return makeAbortedResponse({
      threadId: thread.id,
      callSignal,
    });
  }
  const retrieval = await deps.kbRetriever.retrieve({
    tenantId,
    prompt: inputCheck.prompt,
    facts: memoryState.facts,
    summary: memoryState.summary,
    cheapModelId: profile.cheapModelId ?? config.defaultCheapModelId,
    meta: {
      tenantId,
      userId,
      profileId: profile.id,
      threadId: thread.id,
    },
    filters: input.kbFilters,
  });
  // 6. The request
  const context = await deps.contextAssembler.build({
    input: {
      profile,
      model,
      userContext,
      userFacts,
      threadId: thread.id,
      inlineFiles,
      retrieval,
      tools: resolved.tools,
      skills,
      instructions,
      context: callContext,
      outputSchema,
      outputFormat,
      temperature,
    },
  });
  return {
    profile,
    thread,
    resolved,
    skills,
    context,
    issues: [...inputCheck.issues, ...context.issues],
    chunks: context.chunkIds.flatMap(chunkId => retrieval.hits.filter(hit => hit.chunk.id === chunkId).map(hit => hit.chunk)),
  };
};
