module.exports = {
  extends: "./functions/.eslintrc.js",
  rules: {
    "linebreak-style": ["error", "windows"],
    "quotes": ["error", "double"],
    "indent": ["error", 2],
    "object-curly-spacing": ["error", "always"],
    "max-len": ["error", { "code": 120 }],
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "comma-dangle": ["error", "always-multiline"]
  },
};