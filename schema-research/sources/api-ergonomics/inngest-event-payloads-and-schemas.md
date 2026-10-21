# Event payloads and schemas

> Define stable event names and payloads so senders and consumers can evolve independently.

Send an event such as `billing/invoice.paid` with the invoice ID that downstream functions need. Keep its name and payload stable so you can change the sender and consumer independently.

## Example event

```json
{
  "name": "billing/invoice.paid",
  "data": {
    "invoiceId": "inv_123",
    "customerId": "cus_456"
  },
  "v": "2026-12-01.AA"
}
```

## Required fields

- `name` selects matching event triggers
- `data` is a JSON object passed to each run, and describes the event that occurred

## Optional fields

- `id` gives the event a sender-defined deduplication key.
- `ts` records an event timestamp in Unix milliseconds. A future timestamp can schedule when event-triggered functions start.
- `v` identifies a payload version.

Use [Agent Evals](/docs-markdown/agent-evals) for sessions and outcome scores. Keep sensitive values out of event data unless you have chosen a suitable data protection strategy such as using [encryption via middleware](/docs-markdown/durable-execution/guides-and-advanced/middleware).

## Name events for facts

Prefer a domain and a past-tense action such as `account/user.created`. Use one convention across apps. Avoid names that describe which function should run, because more than one function may use the same event.

## Define a TypeScript v4 schema

```typescript {{ title: "TypeScript" }}
import { eventType, Inngest } from "inngest";
import { z } from "zod";

const inngest = new Inngest({ id: "billing-app" });

export const invoicePaid = eventType("billing/invoice.paid", {
  schema: z.object({
    invoiceId: z.string(),
    customerId: z.string(),
  }),
});

await inngest.send(invoicePaid.create({
  invoiceId: "inv_123",
  customerId: "cus_456",
}));
```

```python {{ title: "Python" }}
import inngest
import pydantic

inngest_client = inngest.Inngest(app_id="billing-app")

# The Python SDK has no event type helper. A Pydantic model validates the
# event data at runtime when you build or read it.
class InvoicePaid(pydantic.BaseModel):
    invoiceId: str
    customerId: str

async def send_invoice_paid() -> None:
    await inngest_client.send(
        inngest.Event(
            name="billing/invoice.paid",
            data=InvoicePaid(
                invoiceId="inv_123",
                customerId="cus_456",
            ).model_dump(),
        )
    )

# In a function triggered by the event:
# invoice = InvoicePaid.model_validate(ctx.event.data)
```

```go {{ title: "Go" }}
import (
	"context"

	"github.com/inngest/inngestgo"
)

// InvoicePaid is the typed data for the "billing/invoice.paid" event. Use the
// same struct as the type parameter of inngestgo.Input in functions that the
// event triggers.
type InvoicePaid struct {
	InvoiceID  string `json:"invoiceId"`
	CustomerID string `json:"customerId"`
}

type InvoicePaidEvent = inngestgo.GenericEvent[InvoicePaid]

func SendInvoicePaid(ctx context.Context) error {
	client, err := inngestgo.NewClient(inngestgo.ClientOpts{AppID: "billing-app"})
	if err != nil {
		return err
	}

	_, err = client.Send(ctx, InvoicePaidEvent{
		Name: "billing/invoice.paid",
		Data: InvoicePaid{
			InvoiceID:  "inv_123",
			CustomerID: "cus_456",
		},
	})
	return err
}
```

The event type can also appear in a function's `triggers` array and in `step.waitForEvent()`. A runtime schema validates event data. Use `staticSchema()` when only TypeScript checking is required.

## Change a payload safely

Keep existing fields stable for deployed consumers. Add fields when consumers can ignore them. If you must change the meaning or shape of a field, version the event and plan the sender and consumer rollout together. See [Versioning](/docs-markdown/durable-execution/guides-and-advanced/versioning) for changing code while runs remain active.