# JSON Structure to JSON Schema Conversion in Avrotize

This article provides a comprehensive explanation of how Avrotize converts JSON Structure documents into JSON Schema format, detailing the conversion strategies, supported features, and architectural decisions.

- [Overview](#overview)
- [Conversion Strategy](#conversion-strategy)
  - [Type System Mapping](#type-system-mapping)
    - [Primitive Types](#primitive-types)
    - [Numeric Types with Constraints](#numeric-types-with-constraints)
    - [String Types with Formats](#string-types-with-formats)
    - [Arrays and Sets](#arrays-and-sets)
    - [Objects](#objects)
    - [Maps and Additional Properties](#maps-and-additional-properties)
    - [Choice Types](#choice-types)
    - [Temporal Types](#temporal-types)
  - [Validation Constraints](#validation-constraints)
  - [Extension Handling](#extension-handling)
- [Architectural Decisions](#architectural-decisions)
- [Examples](#examples)
- [Limitations and Future Work](#limitations-and-future-work)

## Overview

JSON Structure is a schema language designed to map cleanly to programming language types and database constructs. Since JSON Structure is more constrained and precise than JSON Schema, the conversion from JSON Structure to JSON Schema is straightforward with well-defined mappings.

The conversion from JSON Structure to JSON Schema in Avrotize follows several key principles:

1. **Direct Mapping**: Convert JSON Structure types to their closest JSON Schema equivalents
2. **Constraint Preservation**: Maintain all validation constraints that have direct JSON Schema equivalents
3. **Extension Mapping**: Convert JSON Structure-specific features to JSON Schema extensions where necessary
4. **Standards Compliance**: Produce JSON Schema documents that conform to JSON Schema Draft 2020-12

## Conversion Strategy

### Type System Mapping

#### Primitive Types

JSON Structure's precise primitive types are mapped to JSON Schema types with appropriate constraints:

| JSON Structure Type | JSON Schema Mapping |
|-------------------|---------------------|
| `null` | `{"type": "null"}` |
| `string` | `{"type": "string"}` |
| `boolean` | `{"type": "boolean"}` |
| `bytes` | `{"type": "string", "format": "byte"}` |

#### Numeric Types with Constraints

JSON Structure's precise numeric types are converted to JSON Schema integers and numbers with range constraints:

| JSON Structure Type | JSON Schema Mapping |
|-------------------|---------------------|
| `int8` | `{"type": "integer", "minimum": -128, "maximum": 127}` |
| `int16` | `{"type": "integer", "minimum": -32768, "maximum": 32767}` |
| `int32` | `{"type": "integer", "minimum": -2147483648, "maximum": 2147483647}` |
| `int64` | `{"type": "integer", "minimum": -9223372036854775808, "maximum": 9223372036854775807}` |
| `uint8` | `{"type": "integer", "minimum": 0, "maximum": 255}` |
| `uint16` | `{"type": "integer", "minimum": 0, "maximum": 65535}` |
| `uint32` | `{"type": "integer", "minimum": 0, "maximum": 4294967295}` |
| `uint64` | `{"type": "integer", "minimum": 0, "maximum": 18446744073709551615}` |
| `float` | `{"type": "number", "format": "float"}` |
| `double` | `{"type": "number", "format": "double"}` |
| `decimal` | `{"type": "number"}` with precision/scale as extensions |

#### String Types with Formats

JSON Structure's semantic string types map to JSON Schema string formats:

| JSON Structure Type | JSON Schema Mapping |
|-------------------|---------------------|
| `uuid` | `{"type": "string", "format": "uuid"}` |
| `date` | `{"type": "string", "format": "date"}` |
| `time` | `{"type": "string", "format": "time"}` |
| `datetime` | `{"type": "string", "format": "date-time"}` |
| `duration` | `{"type": "string", "format": "duration"}` |

#### Arrays and Sets

JSON Structure arrays and sets are mapped as follows:

- **Arrays**: Direct mapping to JSON Schema arrays
  ```json
  // JSON Structure
  {"type": "array", "items": {"type": "string"}}
  
  // JSON Schema
  {"type": "array", "items": {"type": "string"}}
  ```

- **Sets**: Mapped to JSON Schema arrays with `uniqueItems: true`
  ```json
  // JSON Structure
  {"type": "set", "items": {"type": "string"}}
  
  // JSON Schema
  {"type": "array", "uniqueItems": true, "items": {"type": "string"}}
  ```

#### Objects

JSON Structure objects map directly to JSON Schema objects with properties preserved:

```json
// JSON Structure
{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "age": {"type": "int32"}
  },
  "required": ["name"]
}

// JSON Schema
{
  "type": "object",
  "properties": {
    "name": {"type": "string"},
    "age": {"type": "integer", "minimum": -2147483648, "maximum": 2147483647}
  },
  "required": ["name"]
}
```

#### Maps and Additional Properties

JSON Structure maps become JSON Schema objects with `additionalProperties`:

```json
// JSON Structure
{"type": "map", "values": {"type": "string"}}

// JSON Schema
{"type": "object", "additionalProperties": {"type": "string"}}
```

#### Choice Types

JSON Structure choice types are converted to JSON Schema `oneOf`:

```json
// JSON Structure
{
  "type": "choice",
  "choices": [
    {"type": "string"},
    {"type": "int32"}
  ]
}

// JSON Schema
{
  "oneOf": [
    {"type": "string"},
    {"type": "integer", "minimum": -2147483648, "maximum": 2147483647}
  ]
}
```

### Validation Constraints

All JSON Structure validation constraints that have JSON Schema equivalents are preserved:

- **String constraints**: `minLength`, `maxLength`, `pattern`, `format`
- **Numeric constraints**: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- **Array constraints**: `minItems`, `maxItems`

### Extension Handling

JSON Structure-specific features that don't have direct JSON Schema equivalents are converted to extensions:

- **Precision/Scale**: `precision` and `scale` become `x-precision` and `x-scale`
- **Units**: `unit` becomes `x-unit`
- **Currency**: `currency` becomes `x-currency`
- **Alternate Names**: `altnames` becomes `x-altnames`

## Architectural Decisions

### Schema Metadata Preservation

The converter preserves important schema metadata:
- `$id` from JSON Structure is maintained in JSON Schema
- `name` from JSON Structure becomes `title` in JSON Schema
- `description` is preserved as-is

### JSON Schema Version

The converter generates JSON Schema Draft 2020-12 compatible schemas by default, using the `$schema` keyword to indicate compliance.

### Extension Strategy

Rather than losing JSON Structure-specific information, the converter uses JSON Schema's extension mechanism (properties starting with `x-`) to preserve semantic information that may be useful for downstream processors.

## Examples

### Complete Product Example

**JSON Structure Input:**
```json
{
  "$schema": "https://json-structure.org/meta/extended/v0/#",
  "$id": "https://example.com/schemas/product",
  "type": "object",
  "name": "Product",
  "properties": {
    "id": {
      "type": "uuid",
      "description": "Unique identifier for the product"
    },
    "name": {
      "type": "string",
      "maxLength": 100
    },
    "price": {
      "type": "decimal",
      "precision": 10,
      "scale": 2,
      "currency": "USD"
    },
    "tags": {
      "type": "set",
      "items": {"type": "string"}
    },
    "attributes": {
      "type": "map",
      "values": {"type": "string"}
    }
  },
  "required": ["id", "name", "price"]
}
```

**JSON Schema Output:**
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/product",
  "title": "Product",
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique identifier for the product"
    },
    "name": {
      "type": "string",
      "maxLength": 100
    },
    "price": {
      "type": "number",
      "x-precision": 10,
      "x-scale": 2,
      "x-currency": "USD"
    },
    "tags": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "type": "string"
      }
    },
    "attributes": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    }
  },
  "required": ["id", "name", "price"]
}
```

## Usage

### Command Line

```bash
# Convert from stdin
echo '{"type": "object", "name": "Test"}' | avrotize s2j

# Convert from file
avrotize s2j input.struct.json --out output.schema.json

# Convert and output to stdout
avrotize s2j input.struct.json
```

### Python API

```python
from avrotize.structuretojsons import convert_structure_to_json_schema_string

# Convert string to string
json_schema = convert_structure_to_json_schema_string(structure_content)

# Convert file to file
from avrotize.structuretojsons import convert_structure_to_json_schema
convert_structure_to_json_schema("input.struct.json", "output.schema.json")
```

## Limitations and Future Work

### Current Limitations

1. **Complex Compositions**: JSON Structure's composition features (if any) would need custom handling
2. **External References**: Currently handles only self-contained schemas
3. **Custom Extensions**: Additional JSON Structure extensions would require converter updates

### Future Enhancements

1. **Reference Resolution**: Support for external schema references
2. **Composition Support**: Enhanced handling of JSON Structure composition patterns
3. **Optimization**: Schema optimization to reduce redundancy in generated schemas
4. **Bidirectional Validation**: Ensuring round-trip conversion preserves semantics

The JSON Structure to JSON Schema converter provides a robust foundation for interoperability between these schema languages, enabling JSON Structure's precise type system to be used in JSON Schema-based toolchains while preserving semantic information through extensions.
