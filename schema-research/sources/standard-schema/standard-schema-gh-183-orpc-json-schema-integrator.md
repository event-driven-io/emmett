# #183: Add oRPC to Standard JSON Schema integrators
Source: https://github.com/standard-schema/standard-schema/pull/183 (state: open, created 2026-09-03T09:04:28Z, by dinwwwh)

Adds oRPC to the list of tools that accept Standard JSON Schema, and updates the existing oRPC entry in the Standard Schema integrators table to point at the new orpc.dev domain.

## Changes

- `json-schema.md`: added oRPC to the integrators table, linking to its [Standard JSON Schema docs](https://orpc.dev/docs/integrations/standard-schema#standard-json-schema). oRPC's OpenAPI generator and smart coercion fall back to Standard JSON Schema conversion when no dedicated converter matches.
- `schema.md`: oRPC entry now links to https://orpc.dev and its [Standard Schema docs](https://orpc.dev/docs/integrations/standard-schema) instead of the old orpc.unnoq.com site.