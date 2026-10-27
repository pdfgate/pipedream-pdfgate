// Mirrors the style + component rules from PipedreamHQ/pipedream's root eslint.config.mjs
// so the components can be checked here before being copied into the monorepo.
// Run with: npm run lint:pipedream
import js from "@eslint/js";
import globals from "globals";
import pipedream from "@pipedream/eslint-plugin-pipedream";

export default [
  {
    ignores: [
      "**/scripts",
      "**/test-event.mjs",
      "**/.github",
      "**/node_modules",
      "**/dist-standalone/**",
      "**/test/**",
      "eslint.config.mjs",
      "eslint.pipedream.config.mjs",
    ],
  },
  js.configs.recommended,
  {
    files: [
      "**/*.mjs",
    ],
    plugins: {
      pipedream,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "arrow-parens": "error",
      "arrow-spacing": "error",
      "array-bracket-newline": [
        "error",
        {
          minItems: 1,
        },
      ],
      "array-element-newline": [
        "error",
        "always",
      ],
      "comma-dangle": [
        "error",
        "always-multiline",
      ],
      "comma-spacing": "error",
      "eol-last": "error",
      "function-call-argument-newline": [
        "error",
        "consistent",
      ],
      "function-paren-newline": [
        "error",
        "consistent",
      ],
      "indent": [
        "error",
        2,
      ],
      "key-spacing": "error",
      "keyword-spacing": "error",
      "max-len": [
        "error",
        {
          code: 100,
          tabWidth: 2,
          ignoreTrailingComments: true,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
      "multiline-ternary": [
        "error",
        "always",
      ],
      "newline-per-chained-call": "error",
      "no-constant-condition": [
        "error",
        {
          checkLoops: false,
        },
      ],
      "no-multiple-empty-lines": [
        "error",
        {
          max: 1,
          maxBOF: 0,
          maxEOF: 1,
        },
      ],
      "no-trailing-spaces": "error",
      "no-unused-vars": "error",
      "object-curly-newline": [
        "error",
        {
          ExportDeclaration: "always",
          ImportDeclaration: {
            minProperties: 2,
            multiline: true,
          },
          ObjectExpression: {
            minProperties: 1,
            multiline: true,
          },
          ObjectPattern: {
            minProperties: 2,
            multiline: true,
          },
        },
      ],
      "object-curly-spacing": [
        "error",
        "always",
      ],
      "object-property-newline": [
        "error",
        {
          allowAllPropertiesOnSameLine: false,
        },
      ],
      "quote-props": [
        "error",
        "consistent",
      ],
      "quotes": "error",
      "semi": "error",
      "space-before-blocks": [
        "error",
        "always",
      ],
      "space-infix-ops": "error",
    },
  },
  {
    files: [
      "actions/**/*.mjs",
      "sources/**/*.mjs",
    ],
    rules: {
      "pipedream/required-properties-key": "error",
      "pipedream/required-properties-name": "error",
      "pipedream/required-properties-version": "error",
      "pipedream/required-properties-description": "error",
      "pipedream/required-properties-type": "error",
      "pipedream/props-label": "warn",
      "pipedream/props-description": "warn",
      "pipedream/source-name": "warn",
      "pipedream/source-description": "warn",
      "pipedream/no-ts-version": "warn",
      "pipedream/action-annotations": "error",
    },
  },
  {
    files: [
      "sources/common/*",
    ],
    rules: {
      "pipedream/required-properties-key": "off",
      "pipedream/required-properties-name": "off",
      "pipedream/required-properties-version": "off",
      "pipedream/required-properties-description": "off",
      "pipedream/required-properties-type": "off",
      "pipedream/source-name": "off",
      "pipedream/source-description": "off",
      "pipedream/action-annotations": "off",
    },
  },
  {
    files: [
      "*.app.mjs",
    ],
    rules: {
      "pipedream/props-label": "warn",
      "pipedream/props-description": "warn",
    },
  },
];
