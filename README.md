# @buildvision/nest-sdk-generator

[![npm](https://img.shields.io/npm/v/@buildvision/nest-sdk-generator)](https://www.npmjs.com/package/@buildvision/nest-sdk-generator)
[![Test](https://github.com/build-vision/nest-sdk-generator/actions/workflows/test.yml/badge.svg)](https://github.com/build-vision/nest-sdk-generator/actions/workflows/test.yml)

Generate a fully-typed [RTK Query](https://redux-toolkit.js.org/rtk-query/overview) API client from your NestJS controllers.

The generator reads your API's source code with the TypeScript compiler: no running server, no OpenAPI spec, no decorators to add. Every route becomes an RTK Query endpoint whose arguments and result are typed from the controller itself, including return types TypeScript infers from your services.

```ts
// API: users.controller.ts
@Controller('users')
export class UsersController {
  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.usersService.findOne(id) // Promise<User | null>
  }

  @Patch(':id')
  renameUser(@Param('id') id: string, @Body('name') name: string) { ... }
}
```

```tsx
// Client: a React component
const { data: user } = API.Users.getUser.useQuery({ id }) // user: User | null | undefined
const [renameUser] = API.Users.renameUser.useMutation()

renameUser({ id, name: 'Jane' }) // PATCH /users/:id with body { name }
renameUser({ id }) // Type error: `name` is missing
```

**Contents**

- [Requirements](#requirements)
- [Getting started](#getting-started)
- [How controllers become endpoints](#how-controllers-become-endpoints)
- [Generated files](#generated-files)
- [Configuration](#configuration)
- [The request function](#the-request-function)
- [Adding caching (tags)](#adding-caching-tags)
- [Command line](#command-line)
- [Analysis engines](#analysis-engines)
- [Recommended workflow](#recommended-workflow)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Plain SDK mode (`--generate`)](#plain-sdk-mode---generate)
- [Upgrading from 2.x](#upgrading-from-2x)
- [Development](#development)
- [Credits and license](#credits-and-license)

## Requirements

- **A NestJS API written in TypeScript** with a `tsconfig.json`
- **A client that can see the API's source code** (typically a monorepo): generated files import your DTOs and entities directly from the API's source with `import type`, so the client's TypeScript project must be able to type-check those files (see [Client TypeScript setup](#client-typescript-setup))
- **Redux Toolkit 2.x** with React (`@reduxjs/toolkit/query/react`) in the client
- **Node.js 20.19+ or 22.12+** to run the generator (older versions fall back to a slower [engine](#analysis-engines))

## Getting started

The examples assume a monorepo with the API in `api/` and a React app in `web/`.

### 1. Install

```sh
cd web
npm install --save-dev @buildvision/nest-sdk-generator
```

### 2. Create a configuration file

`web/api-gen.config.json` (paths are relative to this file):

```json
{
  "apiInputPath": "../api",
  "sdkOutputPath": "./src/api/endpoints",
  "sdkInterfacePath": "./src/api/BaseRequest.ts",
  "generateTimestamps": false,
  "controllerOutput": {
    "fileName": { "removeSuffix": ".controller", "addSuffix": ".endpoints" },
    "exportName": { "removeSuffix": "Controller", "addSuffix": "Endpoints" },
    "endpointGroupName": { "removeSuffix": "Controller" }
  }
}
```

All options are described in [Configuration](#configuration).

### 3. Write the request function

Every endpoint calls a single function you own, which performs the HTTP request: this is where the base URL, authentication and error handling live. Create the file `sdkInterfacePath` points to (see [The request function](#the-request-function) for a complete example):

```ts
// web/src/api/BaseRequest.ts
import type { BaseQueryFn } from '@reduxjs/toolkit/query'

export type BaseRequestArgs = {
  body: unknown
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query: Record<string, any>
  route: string
}

export type BaseRequestFn = BaseQueryFn<BaseRequestArgs, unknown, { status: number; message: string }>

export const BaseRequest: BaseRequestFn = async ({ body, method, query, route }) => {
  // ...perform the request, return { data } or { error }
}
```

If the file doesn't exist, the generator creates a starter implementation for you (see [`generateDefaultSdkInterface`](#configuration)).

### 4. Generate the client

```sh
npx nest-sdk-generator api-gen.config.json --generate-rtk
```

### 5. Create the RTK Query API

```ts
// web/src/api/index.ts
import { configureStore } from '@reduxjs/toolkit'
import { createApi } from '@reduxjs/toolkit/query/react'

import { BaseRequest } from './BaseRequest'
import endpoints from './endpoints'

export const rtkApi = createApi({
  reducerPath: 'api',
  baseQuery: BaseRequest,
  endpoints: endpoints.buildRTKEndpoints,
})

// Endpoints grouped by controller: API.Users.getUser, API.Comments.addComment...
export const API = endpoints.groupRTKEndpoints(rtkApi)

export const store = configureStore({
  reducer: { [rtkApi.reducerPath]: rtkApi.reducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(rtkApi.middleware),
})
```

Wrap your app in react-redux's `<Provider store={store}>` as usual.

### 6. Use the endpoints

```tsx
import { API } from './api'

export function Comments({ articleId }: { articleId: string }) {
  const { data: comments, isLoading } = API.Comments.listComments.useQuery({ articleId })
  const [addComment, { isLoading: isSaving }] = API.Comments.addComment.useMutation()

  if (isLoading) return <p>Loading...</p>

  return (
    <>
      <ul>
        {comments?.map((comment) => (
          <li key={comment.id}>{comment.text}</li>
        ))}
      </ul>
      <button disabled={isSaving} onClick={() => addComment({ articleId, text: 'Nice!' })}>
        Comment
      </button>
    </>
  )
}
```

Each grouped endpoint is a regular RTK Query endpoint, so everything RTK Query offers works: `useQuery`, `useLazyQuery`, `useMutation`, `initiate`, `select`, `rtkApi.util`...

### Client TypeScript setup

Generated files contain `import type` statements pointing at your API's source files, and your client's compiler type-checks those files **with the client's compiler options**. In practice the client's `tsconfig.json` needs:

- `"experimentalDecorators": true`, as Nest's parameter decorators (`@Param()`, `@Body()`...) are only valid with legacy decorators
- The API's options that affect type-checking of DTOs and entities, most commonly `"strictPropertyInitialization": false`
- The API's path aliases (`paths`), if its files import each other through aliases like `@api/*`
- Access to the packages the API's types depend on (e.g. `class-validator`, your ORM): they are resolved from the API's directory, so they are found as long as the API's dependencies are installed

No API code ends up in your client bundle: only types are imported.

## How controllers become endpoints

**Controllers.** Every `*.controller.ts` file of the API's TypeScript project (as defined by its tsconfig) is analyzed. The first class of the file must have a `@Controller()` decorator called with no argument or a string literal (`@Controller('users')`); other files are skipped. Each controller belongs to the module declared in the nearest `*.module.ts` file, in the controller's directory or a parent directory.

**Routes.** Methods with exactly one of `@Get()`, `@Post()`, `@Put()`, `@Patch()` or `@Delete()`, called with no argument or a string literal, become endpoints. The route is the controller's prefix followed by the method's path: `@Controller('users')` + `@Get(':id/avatar')` becomes `/users/:id/avatar`. Methods without one of these decorators are ignored.

**Arguments.** The endpoint takes a single object merging all of the route's inputs:

| Controller argument | Endpoint argument | Sent as |
| --- | --- | --- |
| `@Param('id') id: string` | `{ id: string }` | Interpolated into the route |
| `@Query('page') page: number` | `{ page: number }` | Query string (GET only) |
| `@Query() query: ListQuery` | `ListQuery` | Query string (GET only) |
| `@Body('name') name: string` | `{ name: string }` | JSON body (non-GET only) |
| `@Body() dto: CreateUserDto` | `CreateUserDto` | JSON body (non-GET only) |
| `@Req()`, `@Headers()`, custom decorators... | - | Ignored |

For example, `update(@Param('id') id: string, @Body() dto: UpdateUserDto)` produces an endpoint taking `{ id: string } & UpdateUserDto`. Routes without inputs take `void`.

**Results.** The result type is the method's return type with `Promise<>` unwrapped, exactly as TypeScript sees it, whether declared or inferred. A method returning `this.usersService.findOne(id)` gets the service's return type.

**RTK Query.** `GET` routes become queries (`builder.query`), every other method becomes a mutation (`builder.mutation`). The endpoint's name is the controller method's name, so **method names must be unique across all controllers**: RTK Query keeps all endpoints of an API in a single namespace.

**Validation.** Generation fails with an explicit error when a route can't be represented reliably, for instance a `GET` route with a `@Body()`, a non-`GET` route with a `@Query()`, a route parameter missing from the URL, a parameter used twice, or a wildcard route.

## Generated files

With the configuration above, the output directory contains:

```
endpoints/
├── index.ts               # Combines all controllers
├── baseRequest.ts         # Re-exports the types of your request function
├── users.endpoints.ts     # One file per controller
└── comments.endpoints.ts
```

Each controller file exports a class with:

- `queries` and `mutations`: functions turning an endpoint's arguments into a request for your request function (`{ body, method, query, route }`)
- `buildRTKEndpoints(builder)`: the controller's RTK Query endpoint definitions
- `groupRTKEndpoints(api)`: picks the controller's endpoints from a created API

`index.ts` default-exports every controller class plus:

- `buildRTKEndpoints`: all endpoint definitions, to pass to `createApi({ endpoints })`
- `groupRTKEndpoints(api)`: the created API's endpoints grouped by controller (`API.Users.getUser`)

It also exports the `GeneratedAPIType` type, the type of the created API.

Every endpoint is documented with its HTTP method, route and source controller method, so hovering an endpoint in your editor shows where it comes from:

```ts
/**
 * GET /articles/:articleId/comments <=> CommentsController.listComments
 *
 * file:///./../../../api/src/articles/comments/comments.controller.ts (cmd + click)
 */
listComments: builder.query<Comment[], { articleId: string }>({
  query: this.queries.listComments,
}),
```

Generated files are overwritten on every run: don't edit them.

## Configuration

The configuration file is a JSON file. Relative paths are resolved from the configuration file's directory.

### Paths (required)

| Option | Description |
| --- | --- |
| `apiInputPath` | Directory of the NestJS API, containing its `tsconfig.json` |
| `sdkOutputPath` | Directory to generate the client in. It is **deleted and recreated** on each run (see `overwriteOldOutputDir`), so don't point it at a directory containing other files. Its parent directory must exist. |
| `sdkInterfacePath` | Your [request function](#the-request-function)'s module. It must export the `BaseRequestArgs` and `BaseRequestFn` types; the generated `baseRequest.ts` re-exports them. |

### Naming

By default, generated names follow your controllers: `users.controller.ts` produces `users.controller.ts` exporting `UsersController`, grouped as `API.UsersController`. `controllerOutput` adjusts these names, each with an optional `removeSuffix` (removed from the end of the name, if present) and `addSuffix` (appended):

| Option | Applies to | Example: `UsersController` in `users.controller.ts` |
| --- | --- | --- |
| `controllerOutput.fileName` | The generated file's name, from the controller's file name without extension | `{ "removeSuffix": ".controller", "addSuffix": ".endpoints" }` gives `users.endpoints.ts` |
| `controllerOutput.exportName` | The generated class's name | `{ "removeSuffix": "Controller", "addSuffix": "Endpoints" }` gives `UsersEndpoints` |
| `controllerOutput.endpointGroupName` | The key in `groupRTKEndpoints(api)` | `{ "removeSuffix": "Controller" }` gives `API.Users` |

`removeSuffix` is interpreted as a regular expression: escape special characters if you need an exact match (in `.controller`, the `.` matches any character, which is harmless in practice).

### Output

| Option | Default | Description |
| --- | --- | --- |
| `prettify` | `true` | Format generated files with Prettier |
| `prettierConfig` | - | Path to a Prettier configuration file (JSON). By default, the nearest `.prettierrc` file above `sdkOutputPath` is used, if any; only JSON `.prettierrc` files are supported. |
| `generateTimestamps` | `true` | Add the generation date to each file. Set to `false` to get identical output when nothing changed (recommended). |
| `overwriteOldOutputDir` | `true` | Replace `sdkOutputPath` if it exists. When `false`, generation fails if it exists. |
| `generateDefaultSdkInterface` | `true` | Create a starter request function at `sdkInterfacePath` if the file doesn't exist. An existing file is never overwritten. |

### Analysis

| Option | Default | Description |
| --- | --- | --- |
| `tsconfigFile` | `tsconfig.json` | Name of the API's tsconfig file, in `apiInputPath` (a file name, not a path) |
| `engine` | `tsgo` | [Analysis engine](#analysis-engines): `tsgo`, `typescript` or `ts-morph` |
| `typescriptPath` | - | TypeScript package used by the `typescript` engine. By default, the `typescript` package installed for the API (resolved from `apiInputPath`) is used. |
| `magicTypes` | `[]` | Replacements for types that can't be extracted, for the [plain SDK mode](#plain-sdk-mode---generate) |

### Debugging

| Option | Default | Description |
| --- | --- | --- |
| `verbose` | `false` | Log every analyzed controller, method, argument and type |
| `jsonOutput` | - | Write the analysis result (modules, controllers, routes and types) to this JSON file |
| `jsonPrettyOutput` | `false` | Indent the JSON output |
| `noColor` | `false` | Currently ineffective: set the `FORCE_COLOR=0` environment variable to disable colors |

## The request function

The generated endpoints don't perform requests themselves: each one turns its arguments into a `BaseRequestArgs` object and hands it to RTK Query's base query, which is your request function. You decide how requests are made: base URL, headers, authentication, serialization, error format, retries, logging...

```ts
// web/src/api/BaseRequest.ts
import type { BaseQueryFn } from '@reduxjs/toolkit/query'

/** What each generated endpoint asks the request function to do */
export type BaseRequestArgs = {
  body: unknown
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query: Record<string, any>
  route: string // e.g. "/users/42", with route parameters already interpolated
}

export type RequestError = { status: number; message: string }

export type BaseRequestFn = BaseQueryFn<BaseRequestArgs, unknown, RequestError>

// Include your API's global prefix and version, if any (e.g. app.setGlobalPrefix('api'))
const BASE_URL = 'https://api.example.com'

export const BaseRequest: BaseRequestFn = async ({ body, method, query, route }) => {
  const url = new URL(BASE_URL + route)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    url.searchParams.append(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value))
  }

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' /* , Authorization: `Bearer ${token}` */ },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })

  const text = await response.text()

  if (!response.ok) {
    return { error: { status: response.status, message: text } }
  }

  return { data: text ? JSON.parse(text) : undefined }
}
```

The function receives RTK Query's usual extra arguments (`api`, with `getState`, `dispatch` and `signal`, and `extraOptions`), so you can read a token from the store or support request cancellation. To handle errors globally (e.g. show a toast), wrap the function and pass the wrapper to `createApi`.

The `error` returned by the hooks is either the error type you declare in `BaseRequestFn`, or RTK Query's `SerializedError` (for unexpected exceptions).

**Starter implementation.** When `sdkInterfacePath` doesn't exist, the generator writes a more complete starter (query serialization, a `RequestError` class with HTTP metadata, user-facing messages from Nest's error responses) that you can adapt. It assumes the API is served from `/api` on the current host.

## Adding caching (tags)

Generated endpoints don't declare cache tags. Add them with RTK Query's [`enhanceEndpoints`](https://redux-toolkit.js.org/rtk-query/api/created-api/code-splitting#enhanceendpoints), which keeps everything typed:

```ts
export const rtkApi = createApi({
  reducerPath: 'api',
  baseQuery: BaseRequest,
  endpoints: endpoints.buildRTKEndpoints,
}).enhanceEndpoints({
  addTagTypes: ['Comment'],
  endpoints: {
    listComments: { providesTags: ['Comment'] },
    addComment: { invalidatesTags: ['Comment'] },
    removeComment: { invalidatesTags: ['Comment'] },
  },
})

export const API = endpoints.groupRTKEndpoints(rtkApi)
```

The same applies to other per-endpoint options like `keepUnusedDataFor` or `transformResponse`.

## Command line

```sh
nest-sdk-generator <config file> [--generate-rtk | --generate] [--engine <tsgo|typescript|ts-morph>]
```

| Argument | Description |
| --- | --- |
| `<config file>` | Path to the configuration file (required) |
| `--generate-rtk` | Generate the RTK Query client |
| `--generate` | Generate the [plain SDK](#plain-sdk-mode---generate) |
| `--engine <name>`, `--engine=<name>` | Analysis engine, overriding the configuration file |

Without `--generate-rtk` or `--generate`, the API is only analyzed: useful to validate it, or to produce a `jsonOutput`. The process exits with a non-zero code on errors (`1` for analysis and generation errors, `2` to `4` when the configuration file is missing or invalid).

## Analysis engines

Most of the generation time is spent by the TypeScript compiler analyzing the API. Three engines are available:

| Engine | Compiler | Notes |
| --- | --- | --- |
| `tsgo` (default) | TypeScript 7's native compiler, bundled | Fastest |
| `typescript` | Your API's own TypeScript compiler (6.x), in-process | Same output as `tsgo`*. Used automatically if `tsgo` can't start. |
| `ts-morph` | TypeScript 4.8, bundled with ts-morph | Same output as version 2.x of this package |

On an API with 66 controllers, 687 routes and ~2,500 source files (plus large dependencies like `googleapis`), generating the RTK Query client takes:

| Engine | Duration |
| --- | --- |
| `tsgo` | 2.4s |
| `typescript` | 8.8s |
| `ts-morph` | 17.7s |

The `tsgo` engine requires Node.js 20.19+ or 22.12+, and Node.js itself rather than Bun's runtime: `bun x` and `npx` run the generator with Node.js, but `bun --bun` doesn't. When `tsgo` can't be started (unsupported runtime or platform), the generator falls back to the `typescript` engine and says so. The `typescript` engine needs a TypeScript 6 (or older) package with the JavaScript compiler API: the API's own, or the one set with `typescriptPath`.

Newer TypeScript versions infer some types more precisely than TypeScript 4.8 (e.g. `(User | undefined)[]` becomes `User[]` after a `.filter()` with a type guard), order union members deterministically, and omit default type arguments. The `tsgo` and `typescript` engines may therefore generate slightly different, more precise types than the `ts-morph` engine.

\* TypeScript 6 and 7 print a few rare types differently (e.g. classes declared inside generic functions, used as base classes). This doesn't affect the RTK Query client, but can change the types extracted for the plain SDK mode and `jsonOutput`.

## Recommended workflow

- **Don't commit the generated client.** Add `sdkOutputPath` to your `.gitignore` and generate it before anything that needs it:

  ```json
  {
    "scripts": {
      "build:api": "nest-sdk-generator api-gen.config.json --generate-rtk",
      "dev": "npm run build:api && next dev",
      "build": "npm run build:api && next build",
      "typecheck": "npm run build:api && tsc --noEmit",
      "test": "npm run build:api && vitest run"
    }
  }
  ```

- **Regenerate while developing.** The generator doesn't watch files; pair it with a file watcher, e.g. `nodemon --watch ../api/src -e ts --exec "npm run build:api"`.
- **Set `generateTimestamps: false`** so unchanged APIs produce identical files, and tools watching the output don't rebuild for nothing.
- **Type-check the client in CI.** As the client is generated from the API, a breaking API change surfaces as a type error in the client code that uses it.

## Limitations

- **Static analysis only.** Routes are discovered from the decorators listed in [How controllers become endpoints](#how-controllers-become-endpoints): routes registered dynamically, `@All()`, `@Head()`, `@Options()`, `@Controller()` options objects, versioning and global prefixes aren't taken into account (put global prefixes in your request function's base URL).
- **No wildcard routes** (`*`, `+`, `?` in paths), and route parameter names may only contain letters, digits and `_`.
- **Generic `@Param()` objects aren't supported**: use one `@Param('name')` per route parameter.
- **Optional keyed parameters are required keys.** `@Query('page') page?: number` produces `{ page: number | undefined }`: pass `page: undefined` explicitly, or use a `@Query()` DTO with optional properties.
- **Controller paths without a prefix.** With `@Controller()` (no prefix), the method's path is used as is: write `@Get('/articles')` rather than `@Get('articles')` to get a route starting with `/`.
- **One module file per directory.** A controller's module is found by looking for a `*.module.ts` file in its directory, then its parents.
- **Unique names.** Controller class names, and method names across controllers, must be unique.
- **Types must be declared at the top level of a file.** Types used by routes are also extracted during analysis (for the plain SDK mode and `jsonOutput`), and types declared inside namespaces can't be, which fails the generation.
- **The API isn't type-checked.** Generation doesn't report compilation errors in the API; types the compiler can't resolve become `any`.

## Troubleshooting

| Error | Cause and fix |
| --- | --- |
| `Duplicate method name found: X in A and B` | Two controllers have a method named `X`, which would produce two RTK Query endpoints with the same name. Rename one of them. |
| `GET request should not have @Body params` / `POST request should not have @Query params` | Move the inputs to `@Query()` (GET) or `@Body()` (other methods). |
| `Route param X does not appear in route URL` | A `@Param('X')` has no matching `:X` in the route, or a generic `@Param()` object is used. |
| `No module file was found for controller at path ...` | Add a `*.module.ts` file in the controller's directory or a parent directory. |
| `Type X was not found in file ...` | `X` is not declared at the top level of that file (e.g. it is in a namespace). |
| Type errors in API files when type-checking the client | Align the client's compiler options with the API's (see [Client TypeScript setup](#client-typescript-setup)). |
| Generation is slow | Check that the `tsgo` engine is used (`"verbose": true` logs the engine), and that you aren't running the generator with `bun --bun`. |

For anything else, `"verbose": true` logs every step of the analysis, and `jsonOutput` shows what the analyzer understood of your API.

## Plain SDK mode (`--generate`)

`--generate` produces a framework-agnostic SDK instead of RTK Query endpoints: one file per controller with `queries` and `mutations` objects whose methods call a `request(method, uri, body, query)` function exported by `sdkInterfacePath`. In this mode, the types used by the routes are copied into an `_types` directory (types from outside the API's directory go to `_types/_externalN/...`), so the client doesn't need access to the API's source.

Types that can't be copied, like ORM types with circular references or many dependencies, can be replaced with placeholders using `magicTypes`:

```json
{
  "magicTypes": [
    {
      "nodeModuleFilePath": "@mikro-orm/core/entity/Collection.d.ts",
      "typeName": "Collection",
      "placeholderContent": "export type Collection<T, _> = Array<T>;"
    }
  ]
}
```

When a type named `typeName` is imported from `node_modules/<nodeModuleFilePath>`, `placeholderContent` is used instead. Mikro-ORM's `Collection` is replaced by default.

This mode is maintained for compatibility: the RTK Query client is the primary use case of this package. Known issue: classes with an index signature (`[key: string]: ...`) produce type files Prettier rejects.

## Upgrading from 2.x

Version 3.0 adds the [analysis engines](#analysis-engines); configurations and generated file structures are unchanged.

- Generation is much faster, but the default `tsgo` engine requires Node.js 20.19+ / 22.12+.
- Some generated types may change, as newer TypeScript versions infer types more precisely. If this breaks your build, fix the client code (the new types reflect what your API's compiler sees), or temporarily use `--engine=ts-morph` to get exactly the 2.x output.
- `jsonOutput` works again (it crashed in 2.x).

## Development

```sh
npm install
npm run build            # Build the generator into build/
npm run build:baseline   # Build version 2.3.1 into .parity/baseline, used as a reference by the tests
npm test                 # Run the tests
npm run lint
```

The tests generate clients for the fixture API in `test/fixtures` (and ~30 error cases) and compare the results of:

- the 2.3.1 baseline and the `ts-morph` engine, which must produce exactly the same output
- the analyzer behind the `tsgo` and `typescript` engines, running on ts-morph's TypeScript 4.8 program, which must also produce exactly the same output (this shows it is equivalent to the original analyzer)
- the `tsgo` and `typescript` engines, which must produce exactly the same output

To also run them on a real project, set `PARITY_REAL_API_CONFIG` to the path of its generator configuration file; generated files are written to a temporary directory.

## Credits and license

This package is maintained by [BuildVision](https://buildvision.io). It started as a fork of [nest-sdk-generator](https://github.com/lonestone/nest-sdk-generator) by [Lonestone](https://lonestone.io/), which generated plain SDKs; this fork adds the RTK Query client and the analysis engines.

Published under the [MIT License](LICENSE.md).
