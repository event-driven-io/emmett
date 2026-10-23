// What each library does with invalid input: throw, or return a result? Research check for qa.md Q16.
import { z } from 'zod';
import * as v from 'valibot';
import { type } from 'arktype';
import { Schema } from 'effect';
import Type from 'typebox';
import Value from 'typebox/value';
import vine from '@vinejs/vine';

const bad = { shoppingCartId: 1 };

const run = async (label: string, fn: () => unknown) => {
  try {
    const result = await fn();
    const shape =
      result && typeof result === 'object'
        ? Object.keys(result).slice(0, 4).join(',') || result.constructor?.name
        : String(result);
    console.log(`${label.padEnd(42)} returns  ${result?.constructor?.name ?? typeof result} {${shape}}`);
  } catch (error) {
    console.log(`${label.padEnd(42)} throws   ${(error as Error).constructor.name}`);
  }
};

const zod = z.object({ shoppingCartId: z.string() });
await run('zod parse', () => zod.parse(bad));
await run('zod safeParse', () => zod.safeParse(bad));

const valibot = v.object({ shoppingCartId: v.string() });
await run('valibot parse', () => v.parse(valibot, bad));
await run('valibot safeParse', () => v.safeParse(valibot, bad));

const ark = type({ shoppingCartId: 'string' });
await run('arktype call', () => ark(bad));
await run('arktype assert', () => ark.assert(bad));

const effect = Schema.Struct({ shoppingCartId: Schema.String });
await run('effect decodeUnknownSync', () => Schema.decodeUnknownSync(effect)(bad));
await run('effect decodeUnknownResult', () => Schema.decodeUnknownResult(effect)(bad));

const typebox = Type.Object({ shoppingCartId: Type.String() });
await run('typebox Value.Parse', () => Value.Parse(typebox, bad));
await run('typebox Value.Check', () => Value.Check(typebox, bad));

const vineSchema = vine.create(vine.object({ shoppingCartId: vine.string() }));
await run('vine validate', () => vineSchema.validate(bad));
await run('vine tryValidate', () => vineSchema.tryValidate(bad));

await run('standard schema ~standard.validate (zod)', () => zod['~standard'].validate(bad));
