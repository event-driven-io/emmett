import vine from '@vinejs/vine';
import { t } from 'stnl';
import * as stnl from 'stnl/to-standard-json-schema';
import { inspect } from './harness.ts';

const ShoppingCartConfirmed = vine.create({
  cartId: vine.string().uuid().meta({ description: 'Cart id' }),
  confirmedAt: vine.date({ formats: ['iso8601'] }),
  totalAmount: vine.number().min(0),
  itemsCount: vine.number().withoutDecimals(),
  status: vine.enum(['Confirmed', 'Cancelled']),
  note: vine.string().optional(),
  discountCode: vine.string().nullable(),
  items: vine.array(vine.object({ productId: vine.string(), quantity: vine.number().withoutDecimals() })),
  tags: vine.record(vine.string()),
});

await inspect('vinejs vine.create(...)', ShoppingCartConfirmed);

const StnlCart = t.dict(
  { cartId: t.string, itemsCount: t.int, status: t.discrete(['Confirmed', 'Cancelled']), discountCode: t.nullable(t.string) },
  { note: t.string },
);
await inspect('stnl toStandardJSONSchema.v1(...)', stnl.v1(StnlCart), { cartId: 'a', itemsCount: 1, status: 'Confirmed', discountCode: null });
