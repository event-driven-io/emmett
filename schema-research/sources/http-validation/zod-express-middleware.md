version = '1.4.0'
time.modified = '2022-05-25T15:41:44.155Z'
readme = '# zod-express-middleware\r\n' +
  'Middleware for [express](https://www.npmjs.com/package/express) that uses [zod](https://www.npmjs.com/package/zod) to make requests type-safe.\r\n' +
  '\r\n' +
  '<a href="https://www.npmjs.com/package/zod-express-middleware" rel="nofollow"><img alt="npm" src="https://img.shields.io/npm/v/zod-express-middleware"></a>\r\n' +
  '<a href="https://www.npmjs.com/package/zod-express-middleware" rel="nofollow"><img alt="npm" src="https://img.shields.io/npm/dw/zod-express-middleware"></a>\r\n' +
  '<a href="https://github.com/Aquila169/zod-express-middleware/actions/workflows/node.js.yml" rel="nofollow"><img alt="npm" src="https://github.com/Aquila169/zod-express-middleware/actions/workflows/node.js.yml/badge.svg"></a>\r\n' +
  '<a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/npm/l/zod-express-middleware" alt="License"></a>\r\n' +
  '\r\n' +
  '## Installation\r\n' +
  '\r\n' +
  'This package relies on [zod](https://www.npmjs.com/package/zod), [express](https://www.npmjs.com/package/express) and [@types/express](https://www.npmjs.com/package/@types/express). These have been added as peer dependencies so they can be upgraded independently of this package.\r\n' +
  '\r\n' +
  '[zod-express-middleware](https://www.npmjs.com/package/zod-express-middleware) can be installed using:\r\n' +
  '\r\n' +
  '`npm install zod-express-middleware`\r\n' +
  '\r\n' +
  '## Usage\r\n' +
  'This package provides the `validateRequest` function, which can be used to validate the `.body`, `.query` and `.params` properties of an Express `Request`. Separate functions for each of these are also provided (`validateRequestBody`, `validateRequestQuery` and `validateRequestParams`). \r\n' +
  '\r\n' +
  '**Basic example:**\r\n' +
  '```typescript\r\n' +
  "import { validateRequest } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  '// app is an express app\r\n' +
  'app.get("/", validateRequest({\r\n' +
  '    body: z.object({\r\n' +
  '      bodyKey: z.number(),\r\n' +
  '    }),\r\n' +
  '  }), (req, res) => {\r\n' +
  '    // req.body is now strictly-typed and confirms to the zod schema above.\r\n' +
  '    // req.body has type { bodyKey: number };\r\n' +
  '    return res.json({message: "Validation for body passed"});  \r\n' +
  '  }\r\n' +
  ');\r\n' +
  '```\r\n' +
  '\r\n' +
  'A full example of using `validateRequest` in a tiny Express app:\r\n' +
  '\r\n' +
  '**Full example:**\r\n' +
  '```typescript\r\n' +
  "import express from 'express';\r\n" +
  "import { validateRequest } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  '// Create an express app\r\n' +
  'const app = express();\r\n' +
  '\r\n' +
  '// Define an endpoint using express, zod and zod-express-middleware\r\n' +
  'app.get("/:urlParameter/", validateRequest({\r\n' +
  '    params: z.object({\r\n' +
  '      urlParameter: z.string(),\r\n' +
  '    }),\r\n' +
  '    body: z.object({\r\n' +
  '      bodyKey: z.number(),\r\n' +
  '    }),\r\n' +
  '    query: z.object({\r\n' +
  '      queryKey: z.string().length(64),\r\n' +
  '    }),\r\n' +
  '  }), (req, res) => {\r\n' +
  "    // req.params, req.body and req.query are now strictly-typed and confirm to the zod schema's above.\r\n" +
  '    // req.params has type { urlParameter: string };\r\n' +
  '    // req.body has type { bodyKey: number };\r\n' +
  '    // req.query has type { queryKey: string };\r\n' +
  '    return res.json({message: "Validation for params, body and query passed"});  \r\n' +
  '  }\r\n' +
  ');\r\n' +
  '\r\n' +
  '// Start the express app on port 8080\r\n' +
  'const PORT = 8080;\r\n' +
  'app.listen(PORT, () => {\r\n' +
  '  console.log(`Server running `);\r\n' +
  '});\r\n' +
  '```\r\n' +
  "The `validate*` functions do not modify the query, params or body of the Request object, they only check whether they are valid according to the provided schema's. If you want to use the result of the schema validation (for example, if you want to strip unknown keys), you can use the `process*` equivalents (ie. `processRequest` or `processRequestBody`). These functions also accept a `ZodEffects` object, which means you can use zod's built-in `.transform` method:\r\n" +
  '\r\n' +
  '**Zod transformation example:**\r\n' +
  '```typescript\r\n' +
  "import { processRequest } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  'export const zodEffects = z\r\n' +
  '  .object({ jsonString: z.string() })\r\n' +
  '  .refine(\r\n' +
  '    incomingData => {\r\n' +
  '      try {\r\n' +
  '        return JSON.parse(incomingData.jsonString);\r\n' +
  '      } catch (error) {\r\n' +
  '        return false;\r\n' +
  '      }\r\n' +
  '    },\r\n' +
  '    {\r\n' +
  "      message: '.jsonString should be a valid JSON string.',\r\n" +
  '    },\r\n' +
  '  )\r\n' +
  '  .transform(incomingData => {\r\n' +
  '    return z.object( { bodyKey: z.number() } ).parse(JSON.parse(incomingData.afhandelingsData));\r\n' +
  '  });\r\n' +
  '\r\n' +
  '// app is an express app\r\n' +
  'app.get("/", processRequest({\r\n' +
  '    body: zodEffects\r\n' +
  '  }), (req, res) => {\r\n' +
  '    // req.body is now strictly-typed and confirms to the zod schema above ( in the .transform method ).\r\n' +
  '    // req.body has type { bodyKey: number };\r\n' +
  '    return res.json({message: "Validation for body passed"});  \r\n' +
  '  }\r\n' +
  ');\r\n' +
  '```\r\n' +
  '\r\n' +
  '### validateRequest\r\n' +
  '\r\n' +
  'This functions accepts an object containing three optional properties:\r\n' +
  '```typescript\r\n' +
  'schemas: {\r\n' +
  '  params? : ZodSchema,\r\n' +
  '  query? : ZodSchema,\r\n' +
  '  body? : ZodSchema\r\n' +
  '}\r\n' +
  '```\r\n' +
  ' \r\n' +
  'Each is a `ZodSchema`, from the zod library. The `validateRequest` function checks whether each of these is present and if so, it will use it validate the corresponding property on the Express `Request` object. \r\n' +
  '\r\n' +
  'If validation passes, `next` will be called and your request body, query and params properties will be type-safe within the endpoint. \r\n' +
  '\r\n' +
  'If validation fails, a [HTTP 400](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400) response with a list of validation errors will be send to the caller. The `next` function will not be called and the request will stop being processed further.\r\n' +
  '\r\n' +
  '### validateRequestBody, validateRequestQuery and validateRequestParams\r\n' +
  '\r\n' +
  'These three functions work exactly the same as `validateRequest`, except they only validate a single property within the Express `Request`.\r\n' +
  'The other, non-validated properties will have type `any`, as if they were not modified at all. Only an example is provided for `validateRequestBody`, but `validateRequestQuery` and `validateRequestParams` work in the same manner.\r\n' +
  '\r\n' +
  '**Example:**\r\n' +
  '```typescript\r\n' +
  "import { validateRequestBody } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  '// app is an express app\r\n' +
  'app.get("/", validateRequestBody(\r\n' +
  '    z.object({\r\n' +
  '      bodyKey: z.number(),\r\n' +
  '    })\r\n' +
  '  ), (req, res) => {\r\n' +
  '    // req.body is now strictly-typed and confirms to the zod schema above.\r\n' +
  '    // req.body: { bodyKey: number };\r\n' +
  '    return res.json({ message: "Validation for body passed" });\r\n' +
  '  }\r\n' +
  ');\r\n' +
  '```\r\n' +
  '### processRequest\r\n' +
  '\r\n' +
  'This functions accepts an object containing three optional properties:\r\n' +
  '```typescript\r\n' +
  'schemas: {\r\n' +
  '  params? : ZodSchema,\r\n' +
  '  query? : ZodSchema,\r\n' +
  '  body? : ZodSchema\r\n' +
  '}\r\n' +
  '```\r\n' +
  ' \r\n' +
  'Each is a `ZodSchema` or a `ZodEffects` object, from the zod library. The `processRequest` function checks whether each of these is present and if so, it will use it process the corresponding property on the Express `Request` object. \r\n' +
  '\r\n' +
  'If validation passes, `next` will be called and your request body, query and params properties will be type-safe within the endpoint. The body, query and params object will contain the result of the (succesful) parsing by zod. \r\n' +
  '\r\n' +
  'If validation fails, a [HTTP 400](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400) response with a list of validation errors will be send to the caller. The `next` function will not be called and the request will stop being processed further.\r\n' +
  '\r\n' +
  '### processRequestBody, processRequestQuery and processRequestParams\r\n' +
  '\r\n' +
  'These three functions work exactly the same as `processRequest`, except they only process a single property within the Express `Request`.\r\n' +
  'The other, non-processed properties will have type `any`, as if they were not modified at all. Only an example is provided for `processRequestBody`, but `processRequestQuery` and `processRequestParams` work in the same manner.\r\n' +
  '\r\n' +
  '**Example:**\r\n' +
  '```typescript\r\n' +
  "import { processRequestBody } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  '// app is an express app\r\n' +
  'app.get("/", processRequestBody(\r\n' +
  '    z.object({\r\n' +
  '      bodyKey: z.number(),\r\n' +
  '    })\r\n' +
  '  ), (req, res) => {\r\n' +
  '    // req.body is now strictly-typed and confirms to the zod schema above.\r\n' +
  '    // req.body: { bodyKey: number };\r\n' +
  '    return res.json({ message: "Validation for body passed" });\r\n' +
  '  }\r\n' +
  ');\r\n' +
  '```\r\n' +
  '\r\n' +
  '### sendError and sendErrors\r\n' +
  "These two functions can be used to send errors using an Express `Response` to the caller of an endpoint in the same format as the `validateRequest` functions. The function accepts two parameters: an `ErrorListItem` and an Express `Response`. The `ErrorListItem` has type `{ type: 'Body' | 'Query' | 'Params', errors: ZodError }`.\r\n" +
  '\r\n' +
  'The example below uses `sendError` to emulate the functionality of `validateRequestBody`.\r\n' +
  'The `sendErrors` function does the same but accepts an array of `ErrorListItem` objects.\r\n' +
  '\r\n' +
  '**Example:**\r\n' +
  '```typescript\r\n' +
  "import { sendError } from 'zod-express-middleware';\r\n" +
  "import { z } from 'zod';\r\n" +
  '\r\n' +
  '// app is an express app\r\n' +
  'app.get("/", (req, res) => {\r\n' +
  '    const zodSchema = z.object({bodyKey: z.number()});\r\n' +
  '    const result = zodSchema.safeParse(req.body);\r\n' +
  '    if(!result.success) {\r\n' +
  "      return sendError({type: 'Body', errors: result.error}, res);\r\n" +
  '    }\r\n' +
  '    return res.json({ message: "Validation passed" });\r\n' +
  '  }\r\n' +
  ');\r\n' +
  '```\r\n' +
  '\r\n' +
  '### TypedRequest\r\n' +
  'Besides exporting the above middleware functions, zod-express-middleware also provided several typings for usage with Express requests. Typescript is able to automatically infer the types of your request body, query and params if your endpoint definition is placed in the same file as the validation middleware, as shown above. However, if the code for your endpoint is in a separate file, typings will not be automatically available. This is where the `TypedRequest`, `TypedRequestBody` etc. types come in: the `typeof` a `ZodSchema` can be passed into the `TypedRequest`, providing your function with typings. An example:\r\n' +
  '\r\n' +
  '```typescript\r\n' +
  "import { Response } from 'express';\r\n" +
  "import { TypedRequestBody } from 'zod-express-middleware';\r\n" +
  '\r\n' +
  '// bodySchema is a ZodSchema, imported from another file.\r\n' +
  "import { bodySchema } from '../validation/requestSchemas';\r\n" +
  '\r\n' +
  '// This is the endpoint code: it is no'... 379 more characters
