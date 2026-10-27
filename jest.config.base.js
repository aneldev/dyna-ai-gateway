// The jest configuration shared by every package of the workspace. A package's jest.config.js is
// `module.exports = require('../../jest.config.base.js');` and overrides only what is its own.
const path = require('path');

// ESM-only packages that jest (CJS) cannot load as they are; ts-jest transforms them to CJS.
// The AI SDK (used by dyna-ai-gateway/src/internal/llm-client) and its ESM-only dependencies.
const ESM_ONLY_PACKAGES = [
  "ai",
  "@ai-sdk",
  "@workflow",
  "@vercel/oidc",
  "@standard-schema",
  "eventsource-parser",
].join("|");

module.exports = {
  // One setup for all packages: the repo-root .env (provider keys) and the timeout
  setupFilesAfterEnv: [path.join(__dirname, 'jest.setup.ts')],
  automock: false,
  collectCoverage: false,
  testEnvironment: "jest-environment-node",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest.json",
        diagnostics: {
          warnOnly: true,  // Set to true to avoid breaking the test run, but still see the diagnostics
        },
      },
    ],
    // Only the ESM_ONLY_PACKAGES reach this one (see transformIgnorePatterns).
    // ts-jest keeps one config set per jest config, so this entry compiles with the first one's tsconfig.jest.json (its
    // es2020 target is what the BigInt code of @ai-sdk/amazon-bedrock needs); tsconfig.jest-esm.json is not read.
    "^.+\\.m?js$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest-esm.json",
        diagnostics: false,
      },
    ],
  },
  // Everything in node_modules is left as is, except ESM_ONLY_PACKAGES (flat or under pnpm's .pnpm store)
  transformIgnorePatterns: [`/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(${ESM_ONLY_PACKAGES})/)`, "\\.pnp\\.[^\\/]+$"],
  testRegex: "(src)/.*\\.(test|spec)\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "mjs"],
  moduleNameMapper: {
    "\\.(css|less|scss|jpg|png|svg|gif)$": "identity-obj-proxy",
  },
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/@types",
    "!src/**/*.d.ts",
    "!src/index.ts",
    "!src/index.tsx",
    "!src/*/index.ts",
    "!src/*/index.tsx",
    "!src/dev-sandbox/**",
  ],
};
