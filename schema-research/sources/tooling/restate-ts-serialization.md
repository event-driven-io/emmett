> ## Documentation Index
> Fetch the complete documentation index at: https://docs.restate.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Serialization

> Customize serialization for SDK actions.

Restate sends data over the network for storing state, journaling actions, awakeables, etc.
Therefore, Restate needs to serialize and deserialize the journal entries.

## Default serialization

By default, Typescript SDK uses the built-in [JSON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON) support to perform (de)serialization.

## Standard Schema & Zod

You can use any [Standard schema](http://standardschema.dev/) compliant library for your handler input/output schemas, such as [Zod](https://zod.dev/):

```typescript {"CODE_LOAD::ts/src/develop/serialization_standard_schema.ts#standard_schema"}  theme={null}
import * as restate from "@restatedev/restate-sdk";
import { z } from "zod";

const Greeting = z.object({
  name: z.string(),
});

const GreetingResponse = z.object({
  result: z.string(),
});

const greeter = restate.service({
  name: "Greeter",
  handlers: {
    greet: restate.handlers.handler(
      {
        input: restate.serde.schema(Greeting),
        output: restate.serde.schema(GreetingResponse),
      },
      async (ctx: restate.Context, { name }) => {
        return { result: `You said hi to ${name}!` };
      }
    ),
  },
});
```

<Accordion title="For Zod < 4.2">
  If you're using Zod versions earlier than 4.2, you should use the ad-hoc Zod integration instead: [`@restatedev/restate-sdk-zod`](https://www.npmjs.com/package/@restatedev/restate-sdk-zod).

  Then do the following:

  ```typescript {"CODE_LOAD::ts/src/develop/serialization.ts#zod"}  theme={null}
  import * as restate from "@restatedev/restate-sdk";
  import { z } from "zod";
  import { serde } from "@restatedev/restate-sdk-zod";

  const Greeting = z.object({
    name: z.string(),
  });

  const GreetingResponse = z.object({
    result: z.string(),
  });

  const greeter = restate.service({
    name: "Greeter",
    handlers: {
      greet: restate.handlers.handler(
        { input: serde.zod(Greeting), output: serde.zod(GreetingResponse) },
        async (ctx: restate.Context, { name }) => {
          return { result: `You said hi to ${name}!` };
        }
      ),
    },
  });
  ```
</Accordion>

## Custom serialization

It is possible to implement customized serialization using the `Serde` interface.

For example, to implement custom serializers for the handler input and output:

```typescript {"CODE_LOAD::ts/src/develop/serialization.ts#service_definition"}  theme={null}
const myService = restate.service({
  name: "MyService",
  handlers: {
    myHandler: restate.handlers.handler(
      {
        // Set the input serde here
        input: restate.serde.binary,
        // Set the output serde here
        output: restate.serde.binary,
      },
      async (ctx: Context, data: Uint8Array): Promise<Uint8Array> => {
        // Process the request
        return data;
      }
    ),
  },
});
```

When sending a request to a handler configured with custom serde(s) you always need to manually specify them, because the client does not automatically infer what serde(s) should be used.
To customize the serde to use on requests:

```typescript {"CODE_LOAD::ts/src/develop/serialization.ts#client"}  theme={null}
ctx.serviceClient(myService).myHandler(
  input,
  restate.rpc.opts({
    input: restate.serde.binary,
    output: restate.serde.binary,
  })
);
```

To customize the serde for other actions on the context:

```typescript {"CODE_LOAD::ts/src/develop/serialization.ts#actions"}  theme={null}
ctx.get("my-binary-data", restate.serde.binary);
ctx.set("my-binary-data", new Uint8Array(), restate.serde.binary);

ctx.awakeable(restate.serde.binary);

await ctx.run("my-side-effect", () => new Uint8Array(), {
  serde: restate.serde.binary,
});
```


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.