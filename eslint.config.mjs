import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "out/**", "node_modules/**", "lib/generated/**"] },
  ...next,
];

export default config;
