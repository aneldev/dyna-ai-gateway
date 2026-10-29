import {InMemoryPromptTemplateRepository} from "../../../../adapters/in-memory";
import {
  ITurn,
  EPartKind,
  ETurnRole,
} from "../../../../contracts";

import {FakeWorkingMemory} from "../../../../tests/internal/fakes/FakeWorkingMemory";

import {EModelProvider} from "../../../model-registry";
import {
  PromptTemplateStore,
  EPromptTemplateKey,
} from "../../../prompt-template-store";
import {TurnBuilder} from "../../../turn-builder";

import {ContextAssembler} from "../../ContextAssembler";
import {
  IContextAssemblerConfig,
  IContextInput,
} from "../../types";

/** A user turn whose id and text are `text`. */
export const makeTurn = (text: string): ITurn => ({
  id: `turn-${text}`,
  role: ETurnRole.USER,
  parts: [
    {
      kind: EPartKind.TEXT,
      text,
    },
  ],
  createdAt: new Date(1_000),
});

export const makeInput = (overrides: Partial<IContextInput> = {}, contextTokens = 128_000): IContextInput => ({
  profile: {
    id: "careful",
    tenantId: "tenant-a",
    name: "Careful",
    modelId: "model-a",
    allowedTools: [],
    approvals: [],
    promptAddendum: "Always mention the invoice number.",
    limits: {
      maxStepsPerRun: 5,
      maxOutputTokens: 500,
    },
  },
  model: {
    id: "model-a",
    provider: EModelProvider.OPENAI,
    providerModelId: "model-a-2026",
    label: "Model A",
    caps: {
      tools: true,
      images: false,
      pdf: false,
      structuredOutput: true,
      reasoning: false,
      temperature: true,
      embeddings: false,
      contextTokens,
      maxOutputTokens: 300,
      costInPerMTokUsd: 1,
      costOutPerMTokUsd: 2,
    },
    enabled: true,
    deprecatedAt: null,
  },
  userContext: {
    tenantId: "tenant-a",
    userId: "user-a",
    permissions: [],
    locale: "de-AT",
    timezone: "Europe/Vienna",
    // 23:30 UTC on Sep 30 is already Oct 1 in Vienna
    now: new Date("2026-09-30T23:30:00Z"),
  },
  userFacts: [],
  threadId: "thread-1",
  inlineFiles: [],
  retrieval: {
    query: "hello",
    hits: [],
    noMatch: true,
    searched: false,
  },
  tools: [],
  ...overrides,
});

/** A memory whose window is `turns` (default: one "hello" turn) and whose notes are `notes`. */
export const makeMemory = (turns: ITurn[] = [makeTurn("hello")], notes = ""): FakeWorkingMemory => new FakeWorkingMemory({
  messages: new TurnBuilder().toMessages({turns}),
  notes,
});

export const assemblerConfigBase: IContextAssemblerConfig = {
  promptCaching: true,
  sharePromptCacheAcrossTenants: false,
};

/** An assembler on the base config, the seed templates and a scripted memory; `config` overrides the switches of the test. */
export const makeAssembler = (
  config: Partial<IContextAssemblerConfig> = {},
  workingMemory: FakeWorkingMemory = makeMemory(),
  promptTemplateStore: PromptTemplateStore = new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
): ContextAssembler =>
  new ContextAssembler({
    ...assemblerConfigBase,
    ...config,
  }, {
    promptTemplateStore,
    turnBuilder: new TurnBuilder(),
    workingMemory,
  });

/** A template store whose active CHAT_MAIN is `body` (version 1 over the seed). */
export const makeTemplateStore = async (body: string): Promise<PromptTemplateStore> => {
  const promptTemplateStore = new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()});
  const template = await promptTemplateStore.addVersion({
    key: EPromptTemplateKey.CHAT_MAIN,
    body,
  });
  await promptTemplateStore.activate({
    key: EPromptTemplateKey.CHAT_MAIN,
    version: template.version,
  });
  return promptTemplateStore;
};
