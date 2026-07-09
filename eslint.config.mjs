import next from "eslint-config-next";

const eslintConfig = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**"],
  },
  {
    // The UI was ported verbatim from the original Vite SPA. These rules from
    // Next 16's newer react-hooks plugin flag intentional pre-existing patterns
    // (fetch-on-mount setState, the context-provided onOpenAdd ref, apostrophes
    // in copy) that are correct at runtime.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react/no-unescaped-entities": "off",
    },
  },
];

export default eslintConfig;
