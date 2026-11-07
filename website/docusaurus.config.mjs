import apiSidebar from "./api-sidebar.mjs";

const arrangeSidebar = async ({defaultSidebarItemsGenerator, ...args}) => {
  const items = await defaultSidebarItemsGenerator(args);
  const isLandingPage = (item) => item.type === "doc" && item.id === "README";
  const arranged = [...items.filter(isLandingPage), ...items.filter((item) => !isLandingPage(item))];
  return arranged.map((item) => (item.link?.id?.startsWith("api/")
    ? {type: "category", label: "API", items: apiSidebar}
    : item));
};

const config = {
  title: "dyna-ai-gateway",
  url: "https://aneldev.github.io",
  baseUrl: "/dyna-ai-gateway/",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    format: "detect",
    hooks: {onBrokenMarkdownLinks: "throw"},
  },
  plugins: [
    ["docusaurus-plugin-typedoc", {
      entryPoints: [
        "../packages/dyna-ai-gateway/src",
        "../packages/dyna-ai-gateway/src/entries/vercel-ui",
      ],
      entryPointStrategy: "resolve",
      tsconfig: "../packages/dyna-ai-gateway/tsconfig.json",
      out: "../docs/40-api",
      skipErrorChecking: true,
      readme: "none",
      plugin: ["./typedoc/shift-headings.mjs"],
    }],
  ],
  presets: [
    ["classic", {
      blog: false,
      docs: {
        path: "../docs",
        routeBasePath: "/",
        sidebarPath: "./sidebars.mjs",
        sidebarItemsGenerator: arrangeSidebar,
        exclude: [
          "internal/**",
          "plans/**",
          "implementation/**",
          "87-backlog.md",
          "90-workspace.md",
          "docs-structure.txt",
        ],
      },
    }],
  ],
};

export default config;
