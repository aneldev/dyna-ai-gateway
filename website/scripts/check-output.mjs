import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative} from "node:path";

const SITE_DIR = join(import.meta.dirname, "..");
const BUILD_DIR = join(SITE_DIR, "build");
const DOCS_DIR = join(SITE_DIR, "..", "docs");
const API_BUILD_DIR = join(BUILD_DIR, "api");
const EXCLUDED = ["internal", "plans", "implementation", "87-backlog.md", "90-workspace.md", "docs-structure.txt"];
const EXCLUDED_URL_PARTS = ["/internal/", "/plans/", "/implementation/", "/backlog/", "/workspace/", "/docs-structure/"];

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

const problems = [...pagesWithManyH1s(), ...excludedUrls(), ...excludedTitles()];
if (problems.length) {
  console.error(`check-output: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-output: ${filesUnder(API_BUILD_DIR, ".html").length} API pages with one h1, no excluded document`);
