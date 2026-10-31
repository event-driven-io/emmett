// Does the output-side rule (a Date field is not `type: string` on the output side) hold for ArkType?
import { type } from 'arktype';

const attempt = (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

const schema = type({ asString: 'string.date.iso', asDate: 'string.date.iso.parse' });
const std = schema['~standard'] as unknown as { jsonSchema?: { input: (o: object) => unknown; output: (o: object) => unknown } };

attempt('has ~standard.jsonSchema', () => typeof std.jsonSchema);
attempt('input', () => std.jsonSchema!.input({ target: 'draft-2020-12' }));
attempt('output', () => std.jsonSchema!.output({ target: 'draft-2020-12' }));
attempt('toJsonSchema() with fallback', () => schema.toJsonSchema({ fallback: { default: (ctx: { base: object }) => ctx.base } }));

try {
  std.jsonSchema!.output({ target: 'draft-2020-12' });
} catch (error) {
  console.log('output error:', JSON.stringify((error as Error).message).slice(0, 400));
}
attempt('output, with ArkType fallback via libraryOptions', () =>
  (std.jsonSchema as unknown as { output: (o: object) => unknown }).output({ target: 'draft-2020-12', libraryOptions: { fallback: { default: (ctx: { base: object }) => ctx.base } } }),
);
const withFormat = type({ asDate: type('string.date.iso.parse').configure({ format: 'date-time' }) });
attempt('configure({ format }) on input', () => (withFormat['~standard'] as unknown as typeof std).jsonSchema!.input({ target: 'draft-2020-12' }));
