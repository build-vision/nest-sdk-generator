// typescript-eslint needs TypeScript's JavaScript API, which TypeScript 7 (this package's runtime dependency) doesn't
// have. Preloaded with `node --require` when linting, to resolve "typescript" to the typescript-6 dev dependency.
const Module = require('module')

const resolveFilename = Module._resolveFilename

Module._resolveFilename = function (request, ...args) {
  if (request === 'typescript' || request.startsWith('typescript/')) {
    request = request.replace(/^typescript/, 'typescript-6')
  }
  return resolveFilename.call(this, request, ...args)
}
