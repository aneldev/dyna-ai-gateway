import apiSidebar from "./api-sidebar.mjs";

const GITHUB_URL = "https://github.com/aneldev/dyna-ai-gateway";
const NPM_URL = "https://www.npmjs.com/package/dyna-ai-gateway";

const arrangeSidebar = async ({defaultSidebarItemsGenerator, ...args}) => {
  const items = await defaultSidebarItemsGenerator(args);
  return items.map((item) => (item.link?.id?.startsWith("api/")
    ? {type: "category", label: "API", items: apiSidebar}
    : item));
};

const config = {
  title: "dyna AI Gateway",
  tagline: "A server-side TypeScript library that puts a language model inside a business application.",
  favicon: "img/favicon.png",
  url: "https://aneldev.github.io",
  baseUrl: "/dyna-ai-gateway/",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    format: "detect",
    hooks: {onBrokenMarkdownLinks: "throw"},
  },
  plugins: [
    [
      "docusaurus-plugin-typedoc",
      {
        entryPoints: [
          "../packages/dyna-ai-gateway/src",
          "../packages/dyna-ai-gateway/src/entries/vercel-ui",
        ],
        entryPointStrategy: "resolve",
        tsconfig: "../packages/dyna-ai-gateway/tsconfig.json",
        out: "../docs/30-api",
        skipErrorChecking: true,
        readme: "none",
        plugin: ["./typedoc/shift-headings.mjs"],
      },
    ],
  ],
  presets: [
    ["classic", {
      blog: false,
      docs: {
        path: "../docs",
        routeBasePath: "/docs",
        sidebarPath: "./sidebars.mjs",
        sidebarItemsGenerator: arrangeSidebar,
        exclude: [
          "internal/**",
          "plans/**",
          "implementation/**",
          "80-backlog.md",
          "85-workspace.md",
          "docs-structure.txt",
        ],
      },
      theme: {customCss: "./src/css/custom.css"},
    }],
  ],
  themeConfig: {
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      title: "dyna AI Gateway",
      logo: {alt: "dyna AI Gateway logo", src: "img/logo.svg"},
      items: [
        {type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs"},
        {type: "doc", docId: "api/index/classes/AIGateway", position: "left", label: "API"},
        {href: NPM_URL, position: "right", label: "npm"},
        {href: GITHUB_URL, position: "right", label: "GitHub"},
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {label: "Getting started", to: "/docs/getting-started/README"},
            {label: "Architecture", to: "/docs/architecture/decisions"},
            {label: "API", to: "/docs/api/index/classes/AIGateway"},
          ],
        },
        {
          title: "Project",
          items: [
            {label: "GitHub", href: GITHUB_URL},
            {label: "npm", href: NPM_URL},
            {label: "Changelog", href: `${GITHUB_URL}/blob/main/packages/dyna-ai-gateway/CHANGELOG.md`},
          ],
        },
      ],
      copyright: `MIT License. © ${new Date().getFullYear()} Anel Invent`,
    },
  },
};

export default config;
