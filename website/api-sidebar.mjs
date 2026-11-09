const CLASS_ID = "api/index/classes/AIGateway";
const CLASS_HREF = "/docs/api/index/classes/AIGateway";

const interfaceDoc = (name) => ({type: "doc", id: `api/index/interfaces/${name}`, label: name});
const member = (name) => ({type: "link", href: `${CLASS_HREF}#${name.toLowerCase()}`, label: `${name}()`});
const chapter = (label, members) => ({type: "category", label, items: members.map(member)});

const apiSidebar = [
  {
    type: "category",
    label: "AIGateway",
    link: {type: "doc", id: CLASS_ID},
    items: [
      chapter(
        "Basics: ask and run",
        [
          "ask",
          "run",
          "resume",
          "getPausedRun",
          "listPausedRuns",
          "listThreads",
          "getTurns",
          "renameThread",
        ],
      ),
      chapter(
        "Files in chat",
        [
          "uploadFile",
          "getFileUrl",
          "deleteFile",
        ],
      ),
      chapter(
        "Data protection tools",
        [
          "deleteUserData",
          "anonymizeUserData",
          "removeFilesByUser",
          "getUserFacts",
          "upsertUserFact",
          "removeUserFact",
          "clearUserFacts",
        ],
      ),
      chapter(
        "Maintenance methods",
        [
          "delete",
          "getThreadMemory",
          "resetThreadMemory",
          "expirePausedRuns",
        ],
      ),
      chapter(
        "Production tools",
        [
          "cancelRun",
          "recoverStuckRuns",
          "shutdown",
          "whenIdle",
        ],
      ),
      {
        type: "doc",
        id: "api/entries/vercel-ui/classes/AIGatewayVercelUi",
        label: "AIGatewayVercelUi",
      },
    ],
  },
  {
    type: "category",
    label: "Adapters",
    items: [
      "IModelRegistryRepository",
      "IAIProfileRepository",
      "IThreadRepository",
      "IUsageAdapter",
      "IRunRepository",
      "IPromptTemplateRepository",
      "IBlobAdapter",
      "IUserMemoryRepository",
      "IVectorIndexAdapter",
      "ITraceRepository",
    ].map(interfaceDoc),
  },
  {
    type: "category",
    label: "Advanced: replace classes",
    items: [
      "ILLMClient",
      "IContextAssembler",
      "ITurnBuilder",
      "IModelRegistry",
      "IAIProfileStore",
      "IPromptTemplateStore",
      "IThreadStore",
      "IFileStore",
      "IRunStore",
      "IHumanGate",
      "IToolRegistry",
      "IToolPolicy",
      "ISkillRegistry",
      "IWorkingMemory",
      "IUserMemoryStore",
      "IMdChunker",
      "IEmbedder",
      "IVectorStore",
      "IQueryRewriter",
      "IKbRetriever",
      "IKbIngestor",
      "IUsageGuard",
      "IGuardrails",
      "ITrace",
    ].map(interfaceDoc),
  },
];

export default apiSidebar;
