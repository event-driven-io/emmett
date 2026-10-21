# Flows reference

Copy as Markdown[View as Markdown](/docs/development/guides/resources/flows/reference.md)

***

This page lists the fields, paths, and routes supported by flows.

## Paths[​](#paths "Direct link to Paths")

Flows can be created in any `flows` folder:

```
/flows/{Flow Name}/index.mdx
/domains/{Domain Name}/flows/{Flow Name}/index.mdx
/services/{Service Name}/flows/{Flow Name}/index.mdx
```

Versioned flows use:

```
/flows/{Flow Name}/versioned/{version}/index.mdx
```

## Routes[​](#routes "Direct link to Routes")

| Route                                   | Description              |
| --------------------------------------- | ------------------------ |
| `/docs/flows/{flow-id}/{version}`       | Flow documentation page. |
| `/visualiser/flows/{flow-id}/{version}` | Flow diagram.            |

## Required fields[​](#required-fields "Direct link to Required fields")

### `id`[​](#id "Direct link to id")

* Type: `string`

Unique id of the flow. EventCatalog uses this for URLs and resource references.

Example

```
---
id: checkout-flow
---
```

### `name`[​](#name "Direct link to name")

* Type: `string`

Display name of the flow.

Example

```
---
name: Checkout Flow
---
```

### `version`[​](#version "Direct link to version")

* Type: `string`

Version of the flow documentation.

Example

```
---
version: 1.0.0
---
```

## Optional fields[​](#optional-fields "Direct link to Optional fields")

### `summary`[​](#summary "Direct link to summary")

* Type: `string`

Short description of the flow.

Example

```
---
summary: Describes the steps from checkout start to order confirmation.
---
```

### `owners`[​](#owners "Direct link to owners")

* Type: `array`

An array of team or user ids that own the flow.

Example

```
---
owners:
  - checkout-platform
---
```

### `steps`[​](#steps "Direct link to steps")

* Type: `array`

Ordered steps in the flow.

Example

```
---
steps:
  - id: submit-order
    title: Submit order
    message:
      id: SubmitOrder
    next_step: authorize-payment
---
```

### `badges`[​](#badges "Direct link to badges")

* Type: `array`

Badges rendered on the flow page.

Example

```
---
badges:
  - content: Critical path
    backgroundColor: red
    textColor: red
---
```

### `repository`[​](#repository "Direct link to repository")

* Type: `object`

Repository metadata for the flow.

Example

```
---
repository:
  language: TypeScript
  url: https://github.com/acme/checkout
---
```

### `diagrams`[​](#diagrams "Direct link to diagrams")

* Type: `array`

Diagrams associated with the flow.

Example

```
---
diagrams:
  - id: checkout-sequence
    version: 1.0.0
---
```

### `attachments`[​](#attachments "Direct link to attachments")

* Type: `array`

External links or supporting documents attached to the flow.

Example

```
---
attachments:
  - title: Checkout runbook
    url: https://runbooks.example.com/checkout
    type: runbook
---
```

## Step fields[​](#step-fields "Direct link to Step fields")

Each flow step supports:

| Field            | Type                 | Description                           |
| ---------------- | -------------------- | ------------------------------------- |
| `id`             | `string` or `number` | Unique step id.                       |
| `title`          | `string`             | Step title.                           |
| `summary`        | `string`             | Optional step summary.                |
| `message`        | `object`             | Message referenced by this step.      |
| `agent`          | `object`             | Agent referenced by this step.        |
| `service`        | `object`             | Service referenced by this step.      |
| `flow`           | `object`             | Nested flow referenced by this step.  |
| `container`      | `object`             | Data store referenced by this step.   |
| `dataProduct`    | `object`             | Data product referenced by this step. |
| `actor`          | `object`             | Inline actor for this step.           |
| `custom`         | `object`             | Custom node for this step.            |
| `externalSystem` | `object`             | External system for this step.        |
| `next_step`      | `string` or `number` | Next step id.                         |
| `next_steps`     | `array`              | Multiple next step ids.               |

## External services nodes[​](#external-services-nodes "Direct link to External services nodes")

Use `externalSystem` when a flow step points at a third-party system.

```
---
steps:
  - id: payment-provider
    title: Payment provider
    externalSystem:
      name: Stripe
      summary: External payment processor.
    next_step: complete
---
```

## Actor nodes[​](#actor-nodes "Direct link to Actor nodes")

Use `actor` when a flow step represents a person, role, or external participant.

```
---
steps:
  - id: customer
    title: Customer starts checkout
    actor:
      name: Customer
    next_step: submit-order
---
```

## Custom properties[​](#custom-properties "Direct link to Custom properties")

You can add organization-specific metadata to this resource using frontmatter fields prefixed with `x-`. Learn how to define, render, and reference them in [Custom properties on resources](/docs/development/customization/custom-properties.md).
