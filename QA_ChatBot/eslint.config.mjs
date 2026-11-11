import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "data/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
