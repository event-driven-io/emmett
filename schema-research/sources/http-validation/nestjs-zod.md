version = '5.5.0'
time.modified = '2026-07-25T01:54:51.681Z'
readme = '<p align="center">\n' +
  '  <img src="logo.svg" width="500px" align="center" alt="NestJS + Zod logo" style="max-width: 100%;" />\n' +
  '  <h1 align="center">nestjs-zod</h1>\n' +
  '  <p align="center">\n' +
  '    ✨ A seamless validation solution for your NestJS application ✨\n' +
  '      <br/>\n' +
  '      by <a href="https://x.com/benlorantfy">@benlorantfy</a>\n' +
  '  </p>\n' +
  '</p>\n' +
  '<br/>\n' +
  '<p align="center">\n' +
  '  <a href="https://github.com/BenLorantfy/nestjs-zod/actions?query=branch%3Amain">\n' +
  '    <img src="https://github.com/BenLorantfy/nestjs-zod/actions/workflows/test-and-build.yml/badge.svg?event=push&branch=main" alt="nestjs-zod CI Status" />\n' +
  '  </a>\n' +
  '  <a href="https://opensource.org/licenses/MIT" rel="nofollow">\n' +
  '    <img src="https://img.shields.io/github/license/BenLorantfy/nestjs-zod" alt="License">\n' +
  '  </a>\n' +
  '  <a href="https://www.npmjs.com/package/nestjs-zod" rel="nofollow">\n' +
  '    <img src="https://img.shields.io/npm/dw/nestjs-zod.svg" alt="npm">\n' +
  '  </a>\n' +
  '  <a href="https://www.npmjs.com/package/nestjs-zod" rel="nofollow">\n' +
  '    <img src="https://img.shields.io/github/stars/BenLorantfy/nestjs-zod" alt="stars">\n' +
  '  </a>\n' +
  '  <a href="https://x.com/benlorantfy">\n' +
  '    <img alt="X (formerly Twitter) Follow" src="https://img.shields.io/twitter/follow/benlorantfy">\n' +
  '  </a>\n' +
  '</p>\n' +
  '\n' +
  '## Core Library Features\n' +
  '\n' +
  '<p>\n' +
  '✨ Create nestjs DTOs from zod schemas\n' +
  '</p>\n' +
  '<p>\n' +
  '✨ Validate / parse request body, query params, and url params using zod\n' +
  '</p>\n' +
  '<p>\n' +
  '✨ Serialize response bodies using zod\n' +
  '</p>\n' +
  '<p>\n' +
  '✨ Automatically generate OpenAPI documentation using zod\n' +
  '</p>\n' +
  '<p>\n' +
  '✨ Supports zod codecs\n' +
  '</p>\n' +
  '\n' +
  '\n' +
  '<h3 align="center">Sponsored by: <a href="https://apisandbox.dev/">apisandbox.dev</a></h3>\n' +
  '\n' +
  '<a href="https://apisandbox.dev/">\n' +
  `  <img alt="apisandbox.dev.  It's google docs for api design.  real-time collaboration.  shareable design links.  and more!.  Try It!" src="./img/sponsor-p1.png" />\n` +
  '</a>\n' +
  '<a href="https://github.com/sponsors/BenLorantfy">\n' +
  '  <img alt="Psst! Sponsor nestjs-zod on GitHub Sponsors and get a free apisandbox.dev subscription!" src="./img/sponsor-p2.png" />\n' +
  '</a>\n' +
  '\n' +
  '\n' +
  '## Getting Started\n' +
  '\n' +
  '### Automatic Setup\n' +
  '`nestjs-zod` can be automatically setup by running the following command:\n' +
  '```bash\n' +
  'npx nestjs-zod-cli /path/to/nestjs/project\n' +
  '```\n' +
  'This command runs a codemod that adds the validation pipe, serialization interceptor, http exception filter, and swagger cleanup function\n' +
  '\n' +
  'Alternatively, you can follow the manual setup steps below\n' +
  '\n' +
  '### Manual Setup\n' +
  '\n' +
  '1. Install the package:\n' +
  '    ```bash\n' +
  '    npm install nestjs-zod # Note: zod ^3.25.0 || ^4.0.0 is also required\n' +
  '    ```\n' +
  '2. Add `ZodValidationPipe` to the `AppModule`\n' +
  '    <details>\n' +
  '      <summary>\n' +
  '        Show me how\n' +
  '      </summary>\n' +
  '\n' +
  '    `ZodValidationPipe` is required in order to validate the request body, query, and params\n' +
  '\n' +
  '    ```diff\n' +
  "    + import { APP_PIPE } from '@nestjs/core';\n" +
  "    + import { ZodValidationPipe } from 'nestjs-zod';\n" +
  '\n' +
  '    @Module({\n' +
  '      imports: [],\n' +
  '      controllers: [AppController],\n' +
  '      providers: [\n' +
  '    +    {\n' +
  '    +      provide: APP_PIPE,\n' +
  '    +      useClass: ZodValidationPipe,\n' +
  '    +    },\n' +
  '      ]\n' +
  '    })\n' +
  '    export class AppModule {}\n' +
  '    ```\n' +
  '    </details>\n' +
  '\n' +
  '3. Add `ZodSerializerInterceptor` to the `AppModule`\n' +
  '    <details>\n' +
  '      <summary>\n' +
  '        Show me how\n' +
  '      </summary>\n' +
  '\n' +
  '    `ZodSerializerInterceptor` is required in order to validate the response bodies\n' +
  '\n' +
  '    ```diff\n' +
  "    - import { APP_PIPE } from '@nestjs/core';\n" +
  "    + import { APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';\n" +
  "    - import { ZodValidationPipe } from 'nestjs-zod';\n" +
  "    + import { ZodValidationPipe, ZodSerializerInterceptor } from 'nestjs-zod';\n" +
  '\n' +
  '    @Module({\n' +
  '      imports: [],\n' +
  '      controllers: [AppController],\n' +
  '      providers: [\n' +
  '        {\n' +
  '          provide: APP_PIPE,\n' +
  '          useClass: ZodValidationPipe,\n' +
  '        },\n' +
  '    +    {\n' +
  '    +      provide: APP_INTERCEPTOR,\n' +
  '    +      useClass: ZodSerializerInterceptor,\n' +
  '    +    },\n' +
  '      ]\n' +
  '    })\n' +
  '    export class AppModule {}\n' +
  '    ```\n' +
  '    </details>\n' +
  '\n' +
  '4. [OPTIONAL] Add an `HttpExceptionFilter` \n' +
  '    <details>\n' +
  '      <summary>\n' +
  '        Show me how\n' +
  '      </summary>\n' +
  '\n' +
  '    An `HttpExceptionFilter` is required in order to add custom handling for zod errors\n' +
  '\n' +
  '    ```diff\n' +
  "    - import { APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';\n" +
  "    + import { APP_PIPE, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';\n" +
  "    import { ZodValidationPipe, ZodSerializerInterceptor } from 'nestjs-zod';\n" +
  "    + import { HttpExceptionFilter } from './http-exception.filter';\n" +
  '\n' +
  '    @Module({\n' +
  '      imports: [],\n' +
  '      controllers: [AppController],\n' +
  '      providers: [\n' +
  '        {\n' +
  '          provide: APP_PIPE,\n' +
  '          useClass: ZodValidationPipe,\n' +
  '        },\n' +
  '        {\n' +
  '          provide: APP_INTERCEPTOR,\n' +
  '          useClass: ZodSerializerInterceptor,\n' +
  '        },\n' +
  '        {\n' +
  '          provide: APP_FILTER,\n' +
  '          useClass: HttpExceptionFilter,\n' +
  '        }\n' +
  '      ]\n' +
  '    })\n' +
  '    export class AppModule {}\n' +
  '\n' +
  '    + // http-exception.filter\n' +
  '    + @Catch(HttpException)\n' +
  '    + export class HttpExceptionFilter extends BaseExceptionFilter {\n' +
  '    +     private readonly logger = new Logger(HttpExceptionFilter.name);\n' +
  '    + \n' +
  '    +     catch(exception: HttpException, host: ArgumentsHost) {\n' +
  '    +         if (exception instanceof ZodSerializationException) {\n' +
  '    +             const zodError = exception.getZodError();\n' +
  '    +             if (zodError instanceof ZodError) {\n' +
  '    +                 this.logger.error(`ZodSerializationException: ${zodError.message}`);\n' +
  '    +             }\n' +
  '    +         }\n' +
  '    + \n' +
  '    +         super.catch(exception, host);\n' +
  '    +     }\n' +
  '    + }\n' +
  '    ```\n' +
  '    </details>\n' +
  '\n' +
  '\n' +
  '5. [OPTIONAL] Add `cleanupOpenApiDoc`\n' +
  '\n' +
  '    > **Important**: This step is important if using `@nestjs/swagger`\n' +
  '\n' +
  '    <details>\n' +
  '      <summary>\n' +
  '        Show me how\n' +
  '      </summary>\n' +
  '\n' +
  '    `cleanupOpenApiDoc` is required if using `@nestjs/swagger` to properly post-process the OpenAPI doc\n' +
  '\n' +
  '    ```diff\n' +
  "    - SwaggerModule.setup('api', app, openApiDoc);\n" +
  "    + SwaggerModule.setup('api', app, cleanupOpenApiDoc(openApiDoc));\n" +
  '    ```\n' +
  '\n' +
  '    </details>\n' +
  '\n' +
  'Check out the [example app](.../example/) for a full example of how to integrate `nestjs-zod` in your nestjs application\n' +
  '\n' +
  '## Documentation\n' +
  '\n' +
  '- [Request Validation](#request-validation)\n' +
  '  - [`createZodDto` (Create a DTO from a Zod schema)](#createzoddto-create-a-dto-from-a-zod-schema)\n' +
  '  - [`ZodValidationPipe` (Get nestjs to validate using zod)](#zodvalidationpipe-get-nestjs-to-validate-using-zod)\n' +
  '  - [`createZodValidationPipe` (Creating custom validation pipe)](#createzodvalidationpipe-creating-custom-validation-pipe)\n' +
  '  - [`ZodValidationException`](#zodvalidationexception)\n' +
  '  - [`ZodSchemaDeclarationException`](#zodschemaDeclarationexception)\n' +
  '- [Response Validation](#response-validation)  \n' +
  '  - [`ZodSerializerDto` (Set zod DTO to serialize responses with)](#zodserializerdto-set-zod-dto-to-serialize-responses-with)\n' +
  '  - [`ZodSerializerInterceptor` (Get nestjs to serialize responses with zod)](#zodserializerinterceptor-get-nestjs-to-serialize-responses-with-zod)\n' +
  '  - [`createZodSerializerInterceptor` (Creating custom serializer interceptor)](#createzodserializerinterceptor-creating-custom-serializer-interceptor)\n' +
  '  - [`ZodResponse` (Sync run-time, compile-time, and docs-time schemas)](#zodresponse-sync-run-time-compile-time-and-docs-time-schemas)\n' +
  '  - [`ZodSerializationException`](#zodserializationexception)\n' +
  '- [OpenAPI (Swagger) support](#openapi-swagger-support)\n' +
  '  - [`cleanupOpenApiDoc` (Ensure proper OpenAPI output)](#cleanupopenapidoc-ensure-proper-openapi-output)\n' +
  '  - [Output schemas](#output-schemas)\n' +
  '  - [Codecs](#codecs)\n' +
  '  - [Reusable schemas](#reusable-schemas)\n' +
  '  - [`zodV3ToOpenAPI` (⚠️ DEPRECATED)](#zodv3toopenapi-deprecated)\n' +
  '- [`validate` (⚠️ DEPRECATED)](#validate-deprecated)\n' +
  '- [`ZodGuard` (⚠️ DEPRECATED)](#zodguard-deprecated)\n' +
  '  - [`createZodGuard` (Creating custom guard)](#createzodguard-creating-custom-guard)\n' +
  '- [`@nest-zod/z` (⚠️ DEPRECATED)](#nest-zodz-deprecated)\n' +
  '  - [ZodDateString](#zoddatestring)\n' +
  '  - [ZodPassword](#zodpassword)\n' +
  '\n' +
  '### Request Validation\n' +
  '#### `createZodDto` (Create a DTO from a Zod schema)\n' +
  '```ts\n' +
  'function createZodDto<TSchema extends UnknownSchema, TCodec extends boolean = false>(schema: TSchema, options?: { codec: TCodec }): ZodDto<TSchema, TCodec>;\n' +
  '```\n' +
  'Creates a nestjs DTO from a zod schema.  These zod DTOs can be used in place of `class-validator` / `class-transformer` DTOs. Zod DTOs are responsible for three things:\n' +
  '\n' +
  '1. Providing a schema for `ZodValidationPipe` to validate incoming client data against\n' +
  '2. Providing a compile-time typescript type from the Zod schema\n' +
  '3. Providing an OpenAPI schema when using `nestjs/swagger`\n' +
  '\n' +
  '> [!NOTE]\n' +
  '> For this feature to work, please ensure [`ZodValidationPipe`](#zodvalidationpipe-get-nestjs-to-validate-using-zod) is setup correctly\n' +
  '\n' +
  '##### Parameters\n' +
  '- `schema` - A zod schema.  You can "bring your own zod", including zod v3 schemas, v4 schemas, zod mini schemas, etc.  The only requirement is that the schema has a method called `parse`\n' +
  '- `options`\n' +
  '  - `options.codec` - If set to `true`, then when serializing responses `nestjs-zod` will use `encode` instead of `parse`.  See more information about codecs in the [zod documentation](https://zod.dev/codecs)\n' +
  '\n' +
  '##### Examples\n' +
  '###### Creating a zod DTO\n' +
  '```ts\n' +
  "import { createZodDto } from 'nestjs-zod'\n" +
  "import { z } from 'zod'\n" +
  '\n' +
  'const CredentialsSchema = z.object({\n' +
  '  username: z.string(),\n' +
  '  password: z.string(),\n' +
  '})\n' +
  '\n' +
  '// class is required for using DTO as a type\n' +
  'class CredentialsDto extends createZodDto(CredentialsSchema) {}\n' +
  '```\n' +
  '###### Using a zod DTO\n' +
  '```ts\n' +
  "@Controller('auth')\n" +
  'class AuthController {\n' +
  '  async signIn(@Body() credentials: CredentialsDto) {}\n' +
  '}\n' +
  '```\n' +
  '\n' +
  '#### `ZodValidationPipe` (Get nestjs to validate using zod)\n' +
  '\n' +
  '`ZodValidationPipe` is needed to ensure zod DTOs actually validate incoming request data when using `@Body()`, `@Params()`, or `@Query()` parameter decorators\n' +
  '\n' +
  'When the data is invalid it throws a [ZodValidationException](#zodvalidationexception).\n' +
  '\n' +
  '##### Example\n' +
  '###### Globally (recommended)\n' +
  '\n' +
  '```ts\n' +
  "import { ZodValidationPipe } from 'nestjs-zod'\n" +
  "import { APP_PIPE } from '@"... 25908 more characters
