import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, relative} from "node:path";
import {pathToFileURL} from "node:url";

const SITE_DIR = join(import.meta.dirname, "..");
const BUILD_DIR = join(SITE_DIR, "build");
const DOCS_DIR = join(SITE_DIR, "..", "docs");
const API_BUILD_DIR = join(BUILD_DIR, "docs", "api");
const EXCLUDED = [
  "internal",
  "plans",
  "implementation",
  "80-backlog.md",
  "85-workspace.md",
  "docs-structure.txt",
];
const EXCLUDED_URL_PARTS = [
  "/internal/",
  "/plans/",
  "/implementation/",
  "/backlog/",
  "/workspace/",
  "/docs-structure/",
];

const filesUnder = (dir, extension) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
};

const textOf = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/​/g, "").trim();

const h1sOfHtml = (html) => [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => textOf(match[1]));

const h1OfMarkdown = (markdown) => markdown.replace(/```[\s\S]*?```/g, "").match(/^# (.+)$/m)?.[1].trim();

const pagesWithManyH1s = () => filesUnder(API_BUILD_DIR, ".html")
  .filter((page) => h1sOfHtml(readFileSync(page, "utf8")).length !== 1)
  .map((page) => `not exactly one h1: ${relative(BUILD_DIR, page)}`);

const excludedUrls = () => filesUnder(BUILD_DIR, ".html")
  .map((page) => `/${relative(BUILD_DIR, page)}`)
  .filter((url) => EXCLUDED_URL_PARTS.some((part) => url.includes(part)))
  .map((url) => `excluded document in the output: ${url}`);

const excludedTitles = () => {
  const titles = EXCLUDED.flatMap((name) => {
    const path = join(DOCS_DIR, name);
    if (!existsSync(path)) return [];
    const files = statSync(path).isDirectory() ? filesUnder(path, ".md") : [path];
    return files.map((file) => ({file, title: h1OfMarkdown(readFileSync(file, "utf8"))})).filter(({title}) => title);
  });
  const published = new Map(filesUnder(BUILD_DIR, ".html")
    .flatMap((page) => h1sOfHtml(readFileSync(page, "utf8")).map((title) => [title, page])));
  return titles
    .filter(({title}) => published.has(title))
    .map(({file, title}) => `excluded document in the output: "${title}" (${relative(DOCS_DIR, file)}) in ${relative(BUILD_DIR, published.get(title))}`);
};

// The Mermaid the site renders with: the dependency of @docusaurus/theme-mermaid, not a copy of our own.
const loadMermaid = async () => {
  const mermaidPath = createRequire(createRequire(import.meta.url).resolve("@docusaurus/theme-mermaid")).resolve("mermaid");
  const purifyPath = packageModuleOf(createRequire(mermaidPath).resolve("dompurify"), "dompurify");
  // DOMPurify needs a browser DOM; parsing never sanitizes, so its hooks are stubbed
  const {default: purify} = await import(pathToFileURL(purifyPath).href);
  Object.assign(purify, {addHook: () => {}, removeHook: () => {}, removeAllHooks: () => {}, sanitize: (text) => text});
  return (await import(pathToFileURL(mermaidPath).href)).default;
};

// The ESM entry (package.json `module`) of the package that holds `file`.
const packageModuleOf = (file, name) => {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (pkg.name === name) return join(dir, pkg.module);
  }
  throw new Error(`check-output: no package.json of ${name} above ${file}`);
};

const publishedMarkdown = () => readdirSync(DOCS_DIR)
  .filter((name) => !EXCLUDED.includes(name))
  .flatMap((name) => {
    const path = join(DOCS_DIR, name);
    if (statSync(path).isDirectory()) return [...filesUnder(path, ".md"), ...filesUnder(path, ".mdx")];
    return /\.mdx?$/.test(name) ? [path] : [];
  });

const mermaidBlocksOf = (file) => {
  const markdown = readFileSync(file, "utf8");
  return [...markdown.matchAll(/^```mermaid[^\n]*\n([\s\S]*?)^```/gm)]
    .map((match) => ({file, line: markdown.slice(0, match.index).split("\n").length, code: match[1]}));
};

const mermaidBlocks = publishedMarkdown().flatMap(mermaidBlocksOf);

const brokenDiagrams = async () => {
  const mermaid = await loadMermaid();
  const results = await Promise.all(mermaidBlocks.map(({file, line, code}) => mermaid.parse(code)
    .then(() => null)
    .catch((error) => `mermaid diagram does not parse: ${relative(DOCS_DIR, file)}:${line}: ${String(error.message).split("\n").slice(0, 2).join(" ")}`)));
  return results.filter(Boolean);
};

const problems = [...pagesWithManyH1s(), ...excludedUrls(), ...excludedTitles(), ...await brokenDiagrams()];
if (problems.length) {
  console.error(`check-output: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-output: ${filesUnder(API_BUILD_DIR, ".html").length} API pages with one h1, no excluded document, ${mermaidBlocks.length} Mermaid diagrams parse`);
