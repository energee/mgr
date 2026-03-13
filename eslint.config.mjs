import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Hook Form's watch() is incompatible with React Compiler — suppress globally
      "react-hooks/incompatible-library": "off",
      // Allow unused vars prefixed with _ (common for destructuring to omit fields)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Upgrade from recommended to strict
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/html-has-lang": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-access-key": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/no-distracting-elements": "error",
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        { handlers: ["onClick", "onKeyDown", "onKeyPress", "onKeyUp"] },
      ],
      "jsx-a11y/no-noninteractive-tabindex": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-static-element-interactions": [
        "error",
        {
          handlers: [
            "onClick",
            "onKeyDown",
            "onKeyPress",
            "onKeyUp",
            "onMouseDown",
            "onMouseUp",
          ],
        },
      ],
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
  // Vendored UI components (diceui kanban/sortable/data-table, shadcn timeline/file-upload/alert)
  // These are third-party code with patterns incompatible with React Compiler
  // and intentional a11y overrides. Relax specific rules rather than inline-disabling.
  {
    files: [
      "src/components/ui/kanban.tsx",
      "src/components/ui/sortable.tsx",
      "src/components/ui/timeline.tsx",
      "src/components/ui/file-upload.tsx",
      "src/components/ui/alert.tsx",
      "src/components/data-table/data-table-filter-list.tsx",
      "src/components/data-table/data-table-sort-list.tsx",
      "src/components/ai-elements/prompt-input.tsx",
    ],
    rules: {
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "jsx-a11y/role-supports-aria-props": "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
