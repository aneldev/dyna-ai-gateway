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
    mermaid: true,
    hooks: {onBrokenMarkdownLinks: "throw"},
  },
  themes: ["@docusaurus/theme-mermaid"],
  // Mermaid's node tooltips need d3-transition loaded first (the file says why)
  clientModules: ["./src/clientModules/d3-transition.js", "./src/clientModules/fonts.js"],
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
    mermaid: {theme: {light: "neutral", dark: "dark"}},
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
      logo: {alt: "dyna AI Gateway logo", src: "img/logo.svg", width: 56, height: 56},
      links: [
        {
          title: "Docs",
          items: [
            {label: "Getting started", icon: "rocket", to: "/docs/getting-started/README"},
            {label: "Architecture", icon: "architecture", to: "/docs/architecture"},
            {label: "API", icon: "api", to: "/docs/api/index/classes/AIGateway"},
          ],
        },
        {
          title: "Learn",
          items: [
            {label: "Learn the gateway", icon: "school", to: "/docs/learn-the-gateway/intro"},
            {label: "Learning paths", icon: "route", to: "/docs/learning-paths"},
            {label: "AI best practices", icon: "sparkles", to: "/docs/ai-best-practices"},
          ],
        },
        {
          title: "Project",
          items: [
            {label: "GitHub", icon: "github", href: GITHUB_URL},
            {label: "npm", icon: "package", href: NPM_URL},
            {label: "Changelog", icon: "history", href: `${GITHUB_URL}/blob/main/packages/dyna-ai-gateway/CHANGELOG.md`},
          ],
        },
      ],
      copyright: `MIT License. © ${new Date().getFullYear()} <a class="footer__company" href="https://anel.co" target="_blank" rel="noopener noreferrer">Anel Invent</a>`,
    },
  },
};

export default config;
