"use strict";
// The ESLint config shared by every package of the workspace: a package's .eslintrc.js extends this file
// (`extends: ["../../.eslintrc.js"]`) and adds only its own overrides.
module.exports = {
  root: true,
  env: {
    "browser": false,
    "es2021": true,
    "jest/globals": true,
  },
  extends: [
    "react-app",
    "react-app/jest",
    "./.eslintrc.base.js",
  ],
  plugins: [
    "eslint-plugin-react",
  ],
};
