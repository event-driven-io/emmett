import { type } from 'arktype';
import { Schema } from 'effect';
import * as z from 'zod';
import * as v from 'valibot';

export const arkTitle = type('string').configure({ title: 'Cart id', examples: ['a'], deprecated: true });
// @ts-expect-error custom keys need ArkEnv.meta() augmentation
export const arkCustom = type('string').configure({ 'x-emmett-kind': 'Event' });
export const effectDeprecated = Schema.String.annotate({ deprecated: true });
export const effectCustom = Schema.String.annotate({ 'x-emmett-kind': 'Event' });
export const zodCustom = z.string().meta({ 'x-emmett-kind': 'Event', deprecated: true });
export const valibotCustom = v.pipe(v.string(), v.metadata({ 'x-emmett-kind': 'Event' }));
