import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

/**
 * ESLint flat config.
 *
 * Base is the (non-type-checked) `recommended` set — type-checked rules
 * (`no-unsafe-*`, `require-await`, `restrict-template-expressions`) fight the
 * OpenCode SDK's effectively-`any` Part/Config unions more than they help
 * here, and they'd require every TS file (including config files) to live in a
 * tsconfig. We add `no-unused-vars` + `no-explicit-any` on top.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "data"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Plugin-runtime interop: a few SDK shapes are genuinely untyped to us.
    // Each surviving `any` carries an inline disable-comment with a reason.
    files: ["src/index.ts", "src/internals.ts", "src/index.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.test.ts", "test/**/*.ts", "test-setup.ts", "vitest.config.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  prettier,
)
