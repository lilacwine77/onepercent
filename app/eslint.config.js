import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-preview/**",
      "**/coverage/**",
      "**/.vitest/**",
      "target/**",
      ".anchor/**",
      "test-ledger/**",
      "packages/sdk/src/idl/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    ignores: [
      "apps/web/src/experience/**",
      "apps/web/src/xray/XrayView.tsx",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/\\S/]",
          message: "Render user-facing text through @onepercent/copy.",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|title|alt|placeholder)$/] > Literal[value=/\\S/]",
          message: "Accessible text must come from @onepercent/copy.",
        },
        {
          selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[raw=/^['"]/][value=/\\S/]`,
          message: "Rendered string literals must come from @onepercent/copy.",
        },
        {
          selector:
            ":matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral",
          message: "Rendered text templates must come from @onepercent/copy.",
        },
        {
          selector: `JSXAttribute[name.name=/^(aria-label|title|alt|placeholder)$/] > JSXExpressionContainer > :matches(Literal[raw=/^['"]/][value=/\\S/], TemplateLiteral)`,
          message:
            "Accessible text expressions must come from @onepercent/copy.",
        },
      ],
    },
  },
);
