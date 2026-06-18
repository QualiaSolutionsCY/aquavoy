// ESLint 9 flat config for Next.js 16 / React 19 / TypeScript.
// `next lint` was removed in Next 16, so the gate runs the ESLint CLI directly
// (see the "lint" script in package.json). eslint-config-next 16.x ships native
// flat-config arrays, so no @eslint/eslintrc FlatCompat bridge is required.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "supabase/migrations/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Both rules were source-fixed in the audit remediation (effects refactored
    // to the inner-async pattern; in-app <a> converted to next/link), so they
    // are enforced as hard errors going forward.
    //   - react-hooks/set-state-in-effect: no synchronous setState in a useEffect body.
    //   - @next/next/no-html-link-for-pages: use next/link for in-app navigation.
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "@next/next/no-html-link-for-pages": "error",
    },
  },
];

export default eslintConfig;
