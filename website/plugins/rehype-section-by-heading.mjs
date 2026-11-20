/**
 * rehypeSectionByHeading -- nests the content of a docs page in one <section> per heading
 *
 * # About
 *
 * > The page body reads with the same nesting as its table of contents.
 *
 * Markdown renders every heading and paragraph as siblings. This plugin wraps each `h2`–`h6` and the content up to the next
 * heading of the same or a higher level in a `<section class="heading-section heading-section--h<n>">`, the sections of
 * deeper headings inside it. `custom.css` indents a nested section.
 *
 * Runs after the table of contents and the heading ids are built, so neither changes. Module-level nodes of an MDX page
 * (`import`, `export`) stay at the root.
 */
export default function rehypeSectionByHeading() {
  return (tree) => {
    const root = [];
    const open = [];
    for (const node of tree.children) {
      const depth = headingDepth(node);
      if (node.type === "mdxjsEsm") {
        root.push(node);
        continue;
      }
      if (depth) {
        while (open.length && open[open.length - 1].depth >= depth) open.pop();
        const section = {
          type: "element",
          tagName: "section",
          properties: {className: ["heading-section", `heading-section--h${depth}`]},
          children: [node],
        };
        (open.length ? open[open.length - 1].node.children : root).push(section);
        open.push({depth, node: section});
        continue;
      }
      (open.length ? open[open.length - 1].node.children : root).push(node);
    }
    tree.children = root;
  };
}

/** 2–6 for an h2–h6 element, 0 otherwise (the h1 stays outside: it is the page title). */
const headingDepth = (node) => {
  if (node.type !== "element") return 0;
  const match = /^h([2-6])$/.exec(node.tagName);
  return match ? Number(match[1]) : 0;
};
