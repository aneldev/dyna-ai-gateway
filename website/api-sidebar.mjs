// The API navigation: a hand-picked tree (`apiSidebar`) and, after it, "All types", holding every other generated page.
//
// The problem "All types" fixes: Docusaurus shows the doc sidebar only on a page that is an item of a sidebar. TypeDoc
// writes a page for every exported symbol and module (about 270), the hand-picked tree lists about 40, so a page reached by a link
// (e.g. `ILoadSkillResult` from a property type) rendered with no sidebar at all.
//
// The fix: every API page the hand-picked tree does not list goes into "All types", grouped by kind. Docusaurus expands
// the category of the open page and highlights its entry, so the reader always sees where they are.

const API_ID_PREFIX = "api/";
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

// TypeDoc's output folder of each kind (the second-last segment of a doc id) → the "All types" category, in this order.
// A page in no such folder (a module's `index.md`) goes to "Modules".
const KIND_LABELS = {
  classes: "Classes",
  interfaces: "Interfaces",
  "type-aliases": "Type aliases",
  functions: "Functions",
  variables: "Variables",
  enumerations: "Enumerations",
};
const MODULES_LABEL = "Modules";

/**
 * buildApiSidebar -- the items of the "API" sidebar category: the hand-picked tree, then "All types"
 *
 * # About
 *
 * > Every API page is in the sidebar, so every API page shows it.
 *
 * Appends to `apiSidebar` a collapsed "All types" category with each generated API page the tree does not list, grouped
 * by kind and sorted by name. The file's top comment says why.
 *
 * The page ids come from the docs Docusaurus loaded, not from reading `docs/30-api/`: the folder is gitignored and
 * written by the TypeDoc plugin during the build, after this config is imported, so on a clean checkout it is empty then.
 *
 * # Who needs it
 *
 * `arrangeSidebar` in `docusaurus.config.mjs`, which puts the result in place of the generated "API" category.
 *
 * # What needs
 *
 * `docs`: the `docs` argument of Docusaurus's `sidebarItemsGenerator`, every doc of the version.
 *
 * # Pitfalls
 *
 * A symbol added to `apiSidebar` leaves "All types" by itself; listing it in both is never needed.
 */
export const buildApiSidebar = (docs) => {
  const listed = listedDocIds(apiSidebar);
  const unlisted = docs.filter((doc) => doc.id.startsWith(API_ID_PREFIX) && !listed.has(doc.id));
  return [...apiSidebar, allTypesCategory(unlisted)];
};

/** Doc ids the tree already shows, as an item or as a category's link; walks nested categories. */
const listedDocIds = (items, ids = new Set()) => {
  items.forEach((item) => {
    if (item.type === "doc") ids.add(item.id);
    if (item.link?.type === "doc") ids.add(item.link.id);
    if (item.items) listedDocIds(item.items, ids);
  });
  return ids;
};

/**
 * The collapsed "All types" category: one sub-category per kind, empty kinds left out, entries sorted by label.
 * Kinds in `KIND_LABELS` order, "Modules" last.
 */
const allTypesCategory = (docs) => {
  const groups = new Map([...Object.values(KIND_LABELS), MODULES_LABEL].map((label) => [label, []]));
  docs.forEach((doc) => {
    const segments = doc.id.split("/");
    const kindLabel = KIND_LABELS[segments[segments.length - 2]];
    const label = kindLabel ? segments[segments.length - 1] : doc.title;
    groups.get(kindLabel ?? MODULES_LABEL).push({type: "doc", id: doc.id, label});
  });
  const categories = [...groups]
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      type: "category",
      label,
      items: items.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  return {type: "category", label: "All types", collapsed: true, items: categories};
};
