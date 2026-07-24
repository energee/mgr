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
      // All console usage must go through the centralized logger
      // (src/lib/logger.ts for server, src/lib/client-logger.ts for client)
      "no-console": "error",
      // AGENTS.md hard constraint 3: `type` aliases, never `interface`.
      // Exception: declaration merging inside `declare module` blocks
      // (e.g. src/types/data-table.ts) — suppress inline there.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },
  // Harness conventions promoted from prose to executable checks.
  // See docs/agents/{ui-rules,query-keys,patterns}.md for rationale.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/components/universal/entity-detail",
              message:
                "EntityDetail is deprecated and removed. Use EntityDetailUnified from @/components/universal.",
            },
            {
              name: "@/components/universal/entity-form",
              message:
                "EntityForm is deprecated and removed. Use EntityDetailUnified from @/components/universal.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // DEC-008: { value: "", label: "..." } in option arrays.
          // Scoped to objects that ALSO have a `label` sibling — the Select option shape.
          selector:
            "ObjectExpression:has(Property[key.name='label']) > Property[key.name='value'] > Literal[value='']",
          message:
            "DEC-008: empty string is reserved by Radix Select for 'no selection'. Use the '_none' sentinel for None, or omit the option entirely (entity-list.tsx adds 'All' automatically).",
        },
        {
          // Centralized query keys: flag inline ArrayExpression as queryKey.
          selector:
            "CallExpression[callee.name=/^use(Query|InfiniteQuery|SuspenseQuery|MutationState)$/] ObjectExpression > Property[key.name='queryKey'] > ArrayExpression",
          message:
            "Use centralized query key factories from @/lib/query-keys instead of inline arrays. See docs/agents/query-keys.md.",
        },
        {
          // Destructured error copies passed to log.error degrade to a bare
          // Sentry captureMessage with no stack/context — client-logger.ts
          // only routes `instanceof Error` to captureException. Four shipped
          // instances made production failures undiagnosable (#400/#401/#433).
          selector:
            "CallExpression[callee.object.name='log'][callee.property.name='error'] > ObjectExpression:has(Property[key.name='message']):has(Property[key.name='code'])",
          message:
            "Pass the original error object to log.error, not a destructured {message, code, ...} copy — plain objects reach Sentry with no stack trace (see src/lib/client-logger.ts and issues #400/#401).",
        },
      ],
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
  // Scripts and Supabase edge functions use console directly (no logger available)
  {
    files: ["scripts/**", "supabase/**", ".github/scripts/**"],
    rules: {
      "no-console": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".agents/worktrees/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees (parallel development copies of the repo)
    ".claude/worktrees/**",
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
