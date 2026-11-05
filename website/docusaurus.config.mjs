const landingPageFirst = async ({defaultSidebarItemsGenerator, ...args}) => {
  const items = await defaultSidebarItemsGenerator(args);
  const isLandingPage = (item) => item.type === "doc" && item.id === "README";
  return [...items.filter(isLandingPage), ...items.filter((item) => !isLandingPage(item))];
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
  presets: [
    ["classic", {
      blog: false,
      docs: {
        path: "../docs",
        routeBasePath: "/",
        sidebarPath: "./sidebars.mjs",
        sidebarItemsGenerator: landingPageFirst,
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
