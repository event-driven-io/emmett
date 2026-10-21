import { eventType, staticSchema } from 'inngest';
import { z } from 'zod';

export const invoicePaid = eventType('billing/invoice.paid', {
  schema: z.object({ invoiceId: z.string(), customerId: z.string() }),
});
export const created = invoicePaid.create({ invoiceId: 'inv_123', customerId: 'cus_456' });
export const name: 'billing/invoice.paid' = created.name;
export const typeOnly = eventType('app/user.created', { schema: staticSchema<{ userId: string }>() });
// No exported helper to get the event type from the definition; ReturnType of create is one way
type InvoicePaid = ReturnType<typeof invoicePaid.create>;
export const paid: InvoicePaid['data'] = { invoiceId: '1', customerId: '2' };
