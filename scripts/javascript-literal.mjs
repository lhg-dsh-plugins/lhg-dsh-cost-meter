// JSON escaping preserves quotes/control characters; these extra escapes also
// prevent HTML script termination if generated code is embedded in a page.
export const javascriptLiteral = value => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
