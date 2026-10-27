"use strict";
// Base definition of ELint rules that is compatible with
// - dyna-ts-module-boilerplate
// - dyna-ts-react-module-boilerplate &
// - CRA
module.exports = {
  root: true,
  env: {
    browser: false,
    es2021: true,
    "jest/globals": true,
  },
  settings: {
    react: {version: "detect"},
  },
  ignorePatterns: [
    "under-construction/",
  ],
  parser: "@typescript-eslint/parser",
  plugins: [
    "etc",
    "jest",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:jest/recommended",
  ],
  overrides: [
    {
      files: [
        "*.ts",
        "*.tsx",
      ],
      rules: {
        "no-debugger": [
          "warn",
        ],

        "no-console": [
          "warn",
          {
            allow: [
              "log",
              "info",
              "warn",
              "error",
              "time",
              "timeEnd",
              // But not "debug"
            ],
          },
        ],

        "space-infix-ops": [
          "warn",
          {
            "int32Hint": false,
          },
        ],

        "eol-last": [
          "warn",
          "always",
        ],
        "@typescript-eslint/member-delimiter-style": [
          "warn",
          {
            multiline: {
              delimiter: "semi",
              requireLast: true,
            },
            singleline: {
              delimiter: "semi",
              requireLast: false,
            }
          }
        ],
        "@typescript-eslint/no-empty-interface": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/prefer-namespace-keyword": "warn",
        "@typescript-eslint/naming-convention": [
          "warn",
          {
            selector: "interface",
            format: [],
            custom: {
              regex: "^I[A-Z0-9]",
              match: true,
            }
          },
          {
            selector: "enum",
            format: [
              "PascalCase",
              "UPPER_CASE",
            ],
            custom: {
              regex: "^E[A-Z]",
              match: true,
            }
          }
        ],
        "@typescript-eslint/semi": [
          "warn",
          "always"
        ],
        "@typescript-eslint/no-inferrable-types": "off",
        // Non-null assertions (`x!`) are forbidden — they encode a developer
        // "guarantee" that rots as code moves. Use explicit guards or `?.`.
        // See CLAUDE.md > Coding Standards > General Style.
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/type-annotation-spacing": "warn",
        "brace-style": [
          "warn",
          "stroustrup"
        ],
        "no-extra-boolean-cast": [
          "warn"
        ],
        "comma-dangle": [
          "warn",
          "always-multiline"
        ],
        "eqeqeq": [
          // https://eslint.org/docs/rules/eqeqeq
          "warn",
          "smart"
        ],
        "id-blacklist": [
          "warn",
          "any",
          "Number",
          "String",
          "string",
          "Boolean",
          "Undefined",
          "undefined"
        ],
        "id-match": "warn",
        indent: [
          1,
          2,
          {
            ImportDeclaration: 1,
            SwitchCase: 1
          }
        ],
        // Enforce setters to have getters because reading a setter-only property inside a class
        // silently returns 'undefined' at runtime (instead of throwing an error), leading to logic bugs.
        "accessor-pairs": [
          "error",
          {
            "setWithoutGet": true,
            "enforceForClassMembers": true
          },
        ],
        "no-eval": "warn",
        "no-mixed-operators": "warn",
        "no-trailing-spaces": "warn",
        "no-underscore-dangle": "off",
        "no-unsafe-finally": "warn",
        "no-var": "warn",
        '@typescript-eslint/no-unused-vars': [
          'warn', // or "error"
          {
            varsIgnorePattern: '^_',
            argsIgnorePattern: '^_',
          },
        ],
        semi: "warn",
        curly: [
          "warn",
          "multi-line"
        ],
        "object-curly-newline": [
          "warn",
          {
            ImportDeclaration: {
              minProperties: 2,
              consistent: true,
              multiline: true
            },
            ObjectExpression: {
              multiline: true,
              minProperties: 2
            },
            ObjectPattern: {
              multiline: true,
              minProperties: 2
            },
            ExportDeclaration: {
              multiline: true,
              minProperties: 1
            }
          }
        ],
        "object-curly-spacing": [
          "warn",
          "never"
        ],
        "object-property-newline": [
          "warn",
          {
            allowAllPropertiesOnSameLine: false,
            allowMultiplePropertiesPerLine: false,
          }
        ],
        "keyword-spacing": [
          "warn",
          {
            before: true,
            after: true,
          }
        ],
        "space-before-blocks": [
          "warn",
          "always"
        ],
        "array-bracket-spacing": [
          "warn",
          "never"
        ],
        "computed-property-spacing": [
          "warn",
          "never"
        ],
        "spaced-comment": [
          "warn",
          "always",
          {
            markers: [
              "/",
              "#region",
              "#endregion",
            ]
          }
        ],
        "switch-colon-spacing": [
          "warn",
          {
            after: true,
            before: false
          }
        ],
        "newline-per-chained-call": "warn",
        "react/react-in-jsx-scope": "off",
        "react/no-children-prop": "off",
        "react/no-unescaped-entities": "off",
        "react/prop-types": "off",
        "react-hooks/exhaustive-deps": "off",
        "react/jsx-pascal-case": [
          "warn",
          {}
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
            message: 'Using dangerouslySetInnerHTML is not allowed! Use the HTMLContent instead!'
          }
        ],
        "react/jsx-first-prop-new-line": [
          "warn",
          "multiline-multiprop"
        ],
        "react/jsx-max-props-per-line": [
          "warn",
          {
            maximum: 3
          }
        ],
        "react/jsx-indent-props": [
          "warn",
          2,
        ],
        "react/jsx-closing-bracket-location": "warn",
        "react/self-closing-comp": "warn",
        "etc/no-commented-out-code": "warn",
        // A jsdoc-style title line (`methodName -- what one call does`) starts with the symbol's name, which is lowerCamelCase
        "capitalized-comments": [
          "warn",
          "always",
          {ignorePattern: "[a-z$_][\\w$]* -- "},
        ],

        // Import ordering, grouping, blank lines, duplicate-merging and
        // one-member-per-line are OWNED BY THE AI via the sort-imports Skill
        // (.claude/skills/sort-imports/SKILL.md) — NOT by ESLint, and NOT auto-fixable.
        //
        // `eslint-plugin-import` (`import/order`, `import/no-duplicates`) cannot express
        // the Skill's model — depth-tier proximity (§1.4), interface-first inside a
        // merged import (§4), one-member-per-line (§5), design/icons-last (§1.5). A
        // partial `import/order` config actively fought the Skill's fine proximity
        // sorting, and `import/no-duplicates --fix` collapsed merged imports onto a
        // single line (`{a, b, c}`), so all of those rules were removed. SKILL.md is
        // the single source of truth for import layout.
      }
    },
    {
      "files": [
        "**/*.stories.*",
      ],
      "rules": {
        "import/no-anonymous-default-export": "off"
      }
    }
  ]
};
