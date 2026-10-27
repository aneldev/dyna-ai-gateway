"use strict";

const aiSdkMessage = "The AI SDK is sealed inside src/internal/llm-client. Everything else talks to ILLMClient.";
const aiSdkPaths = [
  "ai",
  "ai/test",
  "ai/internal",
].map(name => ({
  name,
  message: aiSdkMessage,
}));
const aiSdkPattern = {
  group: ["@ai-sdk/*"],
  message: aiSdkMessage,
};

module.exports = {
  root: true,
  extends: [
    "../../.eslintrc.js",
  ],
  overrides: [
    // See docs/internal/AI Gateway Roadmap.md, rule 8: the AI SDK only inside src/internal/llm-client
    {
      files: ["src/**/*.ts"],
      excludedFiles: [
        "src/internal/llm-client/**",
        "src/entries/vercel-ui/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: aiSdkPaths,
            patterns: [
              aiSdkPattern,
            ],
          },
        ],
      },
    },
    // The Vercel UI module (D40): the SDK's types from `ai` are allowed, its providers are not, and the gateway is reached
    // through the root barrel only, never through src/internal
    {
      files: ["src/entries/vercel-ui/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              aiSdkPattern,
              {
                group: ["../../internal", "../../internal/*", "../../../internal", "../../../internal/*"],
                message: "The Vercel UI module composes the gateway through the root barrel (\"../..\"), never through src/internal.",
              },
            ],
          },
        ],
      },
    },
  ],
};
