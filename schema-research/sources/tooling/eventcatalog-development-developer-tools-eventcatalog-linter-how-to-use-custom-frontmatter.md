# Allow custom frontmatter fields

Copy as Markdown[View as Markdown](/docs/development/developer-tools/eventcatalog-linter/how-to/use-custom-frontmatter.md)

***

Use this guide when you need extra fields in frontmatter — a cost centre, a data classification, a Jira key — and the linter reports them as unknown.

## Why the linter complains[​](#why-the-linter-complains "Direct link to Why the linter complains")

EventCatalog validates frontmatter against a schema and rejects top-level keys it doesn't know at build time. The linter's [`schema/unknown-field`](/docs/development/developer-tools/eventcatalog-linter/reference/rules.md#schemaunknown-field) rule mirrors that, so a typo like `owner:` is caught before the build, and so is any custom field:

```
services/order-service/index.mdx
  8:1 ✖ error Unknown property "costCenter". Custom properties must start with "x-". [costCenter] (schema/unknown-field)
```

## Option 1: use the `x-` prefix (recommended)[​](#option-1-use-the-x--prefix-recommended "Direct link to option-1-use-the-x--prefix-recommended")

EventCatalog reserves the `x-` prefix for custom properties. Both EventCatalog and the linter accept any key that starts with it, at any level of the frontmatter:

services/order-service/index.mdx

```
---
id: order-service
name: Order Service
version: 1.0.0
x-cost-center: CC-1234
x-jira-project: ORD
sends:
  - id: OrderCreated
    x-internal: true
---
```

Custom properties are rendered in the catalog and available to your own components — see [Custom properties on resources](/docs/development/customization/custom-properties.md).

## Option 2: allow specific keys[​](#option-2-allow-specific-keys "Direct link to Option 2: allow specific keys")

If you can't rename a field yet, tell the rule to ignore it. `allow` takes exact key names or `prefix*` patterns and applies to both the top-level and nested rules:

.eventcatalogrc.js

```
module.exports = {
  rules: {
    'schema/unknown-field': ['error', { allow: ['costCenter', 'legacy*'] }],
  },
};
```

warning

Allowed keys are still unknown to EventCatalog. Top-level ones will fail `eventcatalog build`; nested ones are silently ignored. Treat `allow` as a stepping stone to the `x-` prefix, not a destination.

## Turn off the suggestions[​](#turn-off-the-suggestions "Direct link to Turn off the suggestions")

The rule adds "Did you mean …?" hints and tells you when a key belongs to a different resource type. To keep only the bare message:

.eventcatalogrc.js

```
module.exports = {
  rules: {
    'schema/unknown-field': ['error', { suggestions: false }],
  },
};
```

## Relax nested-field checks[​](#relax-nested-field-checks "Direct link to Relax nested-field checks")

Unknown keys inside nested objects (`sends[0].too`) are reported by a separate rule, [`schema/unknown-nested-field`](/docs/development/developer-tools/eventcatalog-linter/reference/rules.md#schemaunknown-nested-field), which defaults to `warn` because EventCatalog ignores them rather than failing. Adjust it independently:

.eventcatalogrc.js

```
module.exports = {
  rules: {
    'schema/unknown-nested-field': 'off',
  },
};
```

## Related[​](#related "Direct link to Related")

* [Custom properties on resources](/docs/development/customization/custom-properties.md)
* [Rules reference: schema rules](/docs/development/developer-tools/eventcatalog-linter/reference/rules.md#schema-validation)
