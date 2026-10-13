// Preloaded with `node --require` to simulate a platform where the TypeScript 7 native compiler is unavailable
const Module = require('module')

const resolveFilename = Module._resolveFilename

Module._resolveFilename = function (request, ...args) {
  if (request === 'typescript/unstable/sync') {
    throw new Error('Simulated failure: unable to resolve @typescript/typescript-test-platform')
  }
  return resolveFilename.call(this, request, ...args)
}
