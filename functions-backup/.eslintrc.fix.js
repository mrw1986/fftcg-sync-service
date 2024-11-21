module.exports = {
  extends: "./.eslintrc.js",
  rules: {
    "max-len": ["error", {"code": 120}],
    "valid-jsdoc": 0,
    "require-jsdoc": 0,
    "@typescript-eslint/no-explicit-any": 0,
    "@typescript-eslint/explicit-function-return-type": 0,
    "@typescript-eslint/explicit-module-boundary-types": 0,
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
    }],
    // Add these additional rules to be extra sure
    "jsdoc/require-jsdoc": 0,
    "jsdoc/valid-jsdoc": 0,
    "jsdoc/require-param-type": 0,
    "jsdoc/require-returns": 0,
  },
};
