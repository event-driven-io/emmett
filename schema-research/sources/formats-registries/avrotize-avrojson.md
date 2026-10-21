# "Plain JSON" encoding for Apache Avro

April 2024, by [Clemens Vasters, Microsoft Corp.](mailto:clemensv@microsoft.com)

- [Notational Conventions](#notational-conventions)
- [Interoperability issues of the Avro JSON Encoding with common JSON usage](#interoperability-issues-of-the-avro-json-encoding-with-common-json-usage)
- [The "Plain JSON" encoding](#the-plain-json-encoding)

The Apache Avro project defines a JSON Encoding, which is optimized for encoding
data in JSON, but primarily aimed at exchanging data between implementations of
the Apache Avro specification. The choices made for this encoding severely limit
the interoperability with other JSON serialization frameworks. This document
defines an alternate, additional mode for Avro JSON Encoders, preliminarily
named "Plain JSON", that specifically addresses identified interoperability
blockers.

While this document is a proposal for a set of new features in Apache Avro, the
extensibility of Avro's schema model allows for the implementation of these
features separately from the Avro project. Out of the available and popular
schema languages for data exchange, Avro schema provides the cleanest foundation
for mapping wire representations to programming language types and database
tables, which is why interoperability of Avro with the most popular text
encoding format for structured data, JSON, is very desirable.

With Avro's strength and focus being its binary encoding, supporting JSON is
specifically desireable in interoperability scenarios where either the producer
or the consumer of the encoded data is using a different JSON encoding
framework, or where JSON is crafted or evaluated directly by the application.

As most JSON document instances can be structurally described by Avro Schema,
the interoperability case is for JSON data, described by Avro Schema, to be
accepted by an Apache Avro messaging application, and for that data then to be
forwarded onwards using Avro binary encoding. Reversely, it needs to be possible
for an application to transform an Avro binary encoded data structure into JSON
data that is understood by parties that expect to handle JSON. The kinds
applications requiring such transformation capabilities are stream processing
frameworks, API gateways and (reverse) proxies, and integration brokers.

The intent of this proposal is for the Avro "JsonEncoder" implementations to
have a new mode parameter, accepting an enumeration choice out of the options
"Avro Json" (AVRO_JSON, AvroJson, etc), which is Avro's default JSON encoding,
and "Plain JSON" (PLAIN_JSON, PlainJson, etc). The rules for the "Plain JSON"
mode are described herein.

The "Plain JSON" mode is a selector for enabling set of features that are
described below. Implementations MAY also choose for these features to be
individually selectable for the "Avro JSON" mode, for instance letting the user
use the "Avro JSON" mode primarily, but opting into the binary data handling or
date-time handling features described here. However, the "Plain JSON" mode that
combines these features MUST be implemented to ensure interoperability.

## Notational Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119.


## Interoperability issues of the Avro JSON Encoding with common JSON usage

There are several distinct issues in the Avro JSON Encoding that cause conflicts
with common usage of JSON and many serialization frameworks. It needs to be
emphasized that none of these issues are conformance issues with the JSON
specification (RFC8259), but rather stem from the JSON specification's inherent
limitations. JSON does not define binary data, date or time types. JSON also has
no concept of a type-hint for data structures (i.e. objects), which would allow
serialization frameworks to establish an unambiguous mapping between a data type
in a programming language or schema and the encoded type in JSON.

There are, however, commonly used conventions to address these shortcomings of
the core JSON specification:

- Binary data: Binary data is commonly encoded using the base64 encoding and
  stored in string-typed values.
- Date and time data: Date and time data is commonly encoded using the RFC3339
  profile of ISO8601 and stored in string-typed values.
- Type hints: In its native type system, JSON value types are distinguished by
  notation where 'null' values, strings, numbers, booleans, arrays, and objects
  are identifiable through the syntax. While JSON has no further data type
  concepts, several serialization frameworks and even some standards leaning on
  JSON (e.g. OpenAPI) introduce the notion of a "discriminator" property, which
  is inside the encoded object and unambiguously identifies the type such
  that the decoding stage can instantiate and populate the correct type
  in cases where multiple candidate types exist.

On each of these items, the Avro JSON encoding's choices are in direct conflict
with predominant practice:

- Binary data: Binary data is encoded in strings using Unicode escape sequences
  (example: "\u00DE\u00AD\u00BE\u00EF"), which leads to a 500% overhead compared
  to the encoded bytes vs. a 33% overhead when using Base64.
- Date and time data: Avro handles date and time as logical types, extending
  either long or int, using the UNIX epoch as the baseline. Durations are
  expressed using a bespoke data structure. As there are no handling rules for
  logical types in the JSON encoding, the encoded results are therefore epoch
  numbers without annotations like time zone offsets.
- Type-hints: Whenever types can be ambiguous in Avro, which is the case with
  type unions, the Avro JSON encoding prescribes encoding the value wrapped
  inside an object with a single property where the property's name is the type
  name, e.g. `"myprop": {"string": "value"}`. 'null' values are encoded as
  'null', e.g. `"myprop": null`. For primitive types, this is in conflict with
  JSON's native type model that already makes the distinction syntactically. For
  object types (Avro records), the wrapper is in conflict with standing practice
  where the discriminator is inlined.

In addition, there are three general limitations of Avro's type and schema model
that result in potential interoperability blockers:

- Avro represents decimal numeric types as a logical type annotating `fixed` or
  `byte`, which results in an encoded byte sequence in the JSON encoding that
  cannot be interpreted without the Avro schema and is therefore undecipherable
  for regular JSON consumers.
- `name` fields in Avro are limited to a character set that can be easily mapped
  to mostly any programming language and database, but JSON object keys are not.
- JSON documents may have top-level arrays and maps, while Avro schemas only
  allow `record` and `enum` as independent types and therefore at the top-level
  of a schema.

As a consequence of this, the current implementations of the Avro JSON Encoding
do not interoperate well with "plain JSON" as input and often do not yield
useful plain JSON as output. There is a "happy path" on which the Avro JSON
Encoding does line up with common usage, but it's easy to stray off from it.

## The Plain JSON encoding

The Plain JSON encoding mode of Apache Avro consists of a combination of 7
distinct features that are defined in this section. The design is grounded in
the relevant IETF RFCs and provides the broadest interoperability with common
usage of JSON, while yet preserving type integrity and precision in all cases
where the Avro Schema is known to the decoding party.  

The features are designed to be orthogonal and can be implemented separately.

- ["Plain JSON" encoding for Apache Avro](#plain-json-encoding-for-apache-avro)
  - [Notational Conventions](#notational-conventions)
  - [Interoperability issues of the Avro JSON Encoding with common JSON usage](#interoperability-issues-of-the-avro-json-encoding-with-common-json-usage)
  - [The Plain JSON encoding](#the-plain-json-encoding)
    - [Feature 1: Alternate names](#feature-1-alternate-names)
      - [`altnames` map](#altnames-map)
      - [`altsymbols` map](#altsymbols-map)
    - [Feature 2: Avro `binary` and `fixed` type data encoding](#feature-2-avro-binary-and-fixed-type-data-encoding)
    - [Feature 3: Avro `decimal` logical type and `long` type data encodings](#feature-3-avro-decimal-logical-type-and-long-type-data-encodings)
    - [Feature 4: Avro time, date, and duration logical types](#feature-4-avro-time-date-and-duration-logical-types)
    - [Feature 5: Handling unions with primitive type values and enum values](#feature-5-handling-unions-with-primitive-type-values-and-enum-values)
    - [Feature 6: Handling unions of record values and of maps](#feature-6-handling-unions-of-record-values-and-of-maps)
      - [Type structure matching](#type-structure-matching)
      - [Discriminator property](#discriminator-property)
    - [Feature 7: Document root records](#feature-7-document-root-records)

Features 2, 3, 4, and 5 are trivial on all platforms and frameworks that handle
JSON. Features 1 and 7 are hints for the JSON encoder and decoder to be able to
handle JSON data that is not conforming to Avro's naming and structure
constraints. Feature 6 provides a mechanism to handle unions of record types
that is aligned with common JSON encodation frameworks and JSON Schema's "oneOf"
type composition.

### Feature 1: Alternate names

JSON objects allow for keys with arbitrary unicode strings, with the only
restriction being uniqueness of keys within an object. Uniqueness is a "SHOULD"
rule in [RFC8259, Section 4](https://www.rfc-editor.org/rfc/rfc8259#section-4),
which is interpreted as REQUIRED for this specification since it is common
practice.

The character set permitted for Avro names is constrained by the regular
expression `[A-Za-z_][A-Za-z0-9_]*`, which poses an interoperability problem
with JSON, especially in scenarios where internationalization is a concern.
While English is the dominant language in most developer scenarios, metadata
might be defined by end-users and in their own language. It's also fairly common
for JSON object keys to contain word-separator characters other than '_' and
keys may quite well start with a number.

As the Avro project will presumably want to avoid introducing schema attributes
that are JSON-specific and will want to use new schema constructs for additional
needs as they arise, the alternate names feature introduces a map of alternate
names of which the plain JSON feature reserves a key:

#### `altnames` map

Wherever Avro Schema requires a `name` field, an `altnames` map MAY be defined
alongside the `name` field, which provides a map of alternate names. Those names
may be local-language identifiers, display names, or names that contain
characters disallowed in Avro. The map key identifies the context in which the
alternate name is used.

This specification reserves the `json` key in the `altnames` map.

> A display-name feature might reserve `display:{IANA-subtag}` as keys. This
> assumed convention is used in the following example just for illustration of the
> `altnames` feature.

Assume the following JSON input document with German-language keys that
represents a row in commercial order document:

```JSON
{
  "Artikelschlüssel": "1234",
  "Stückzahl": 42,
  "Größe": "Extragroß"
}
```

Without the alternate names feature, the Avro schema would not be able to match
the keys in the JSON document since `ü` and `ß` are not allowed. With the
alternate names feature, the schema can be defined as follows:

```JSON
{
  "type": "record",
  "namespace": "com.example",
  "name": "Article",
  "fields": [
    {
      "name": "articleKey",
      "type": "string",
      "altnames": {
        "json": "Artikelschlüssel",
        "display:de": "Artikelschlüssel",
        "display:en": "Article Key"
      }
    },
    {
      "name": "quantity",
      "type": "int",
      "altnames": {
        "json": "Stückzahl",
        "display:de": "Stückzahl",
        "display:en": "Quantity"
      }
    },
    {
      "name": "size",
      "type": "sizeEnum",
      "altnames": {
        "json": "Größe",
        "display:de": "Größe",
        "display:en": "Size"
      }
    }
  ]
}
```

When the JSON decoder (de-)encodes a named item, the encoder MUST use the
value from the `altnames` entry with the `json` key as the name for the
corresponding JSON element, when present.

#### `altsymbols` map

The `altsymbols` map is a similar feature to `altnames`, but it is used for
alternate names of enum symbols. The `altsymbols` map provides alternate names
for symbols. As with `altnames`, the `altsymbols` map key identifies the context
in which the alternate name is used. The values of the `altsymbols` map are maps
where the keys are symbols as defined in the `symbols` field and the values are
the corresponding alternate names.

Any symbol key present in the `altsymbols` map MUST exist in the `symbols`
field. Symbols in the `symbols` field MAY be omitted from the `altsymbols` map.

```JSON
{
  "type": "enum",
  "name": "sizeEnum",
  "symbols": ["S", "M", "L", "XL"],
  "altsymbols": {
    "json": {
      "S": "Klein",
      "M": "Mittel",
      "L": "Groß",
      "XL": "Extragroß"
    },
    "display:en": {
      "S": "Small",
      "M": "Medium",
      "L": "Large",
      "XL": "Extra Large"
    }
  }
}
```

When the JSON decoder (de-)encodes an enum symbol, the encoder MUST use the
value from the `altsymbols` entry with the `json` key as the string representing
the enum value, when present.

### Feature 2: Avro `binary` and `fixed` type data encoding

When encoding data typed with the Avro `binary` or `fixed` types, the byte
sequence is encoded into and from Base64 encoded string values, conforming with
IETF RFC4648, Section 4.

### Feature 3: Avro `decimal` logical type and `long` type data encodings

When encoding data typed with the Avro logical `decimal` type or a `long` type,
the numeric value is encoded into a JSON `string` value using the JSON number
syntax defined in RFC8259, Section 6.

RFC8259, Section 6 explicitly allows implementations to back the JSON number
type with an IEEE754 double precision floating point type, even though the JSON
syntax does not limit precision. 

For `decimal` that means that JSON number values are not guaranteed to be able
to represent the range of Avro decimal values. Worse, IEEE 754 cannot represent
decimal values exactly (0.1 for instance), which causes precision issues in
monetary calculations.

Integer values that are outside the range of IEEE754 double precision floating
point values are not guaranteed to be representable. The range of representable
integers is -2^53 to 2^53. The required range for an Avro `long` type is -2^63
to 2^63-1.

When using a JSON library to implement the encoding, decimal values MUST NOT be
converted through an IEEE floating point type (e.g. double or float in most
programming languages) but must use the native decimal data type.

### Feature 4: Avro time, date, and duration logical types

When encoding data typed with one of Avro's logical data types for dates and
times, the data is encoded into and from a JSON `string` value, which is an
expression as defined in IETF RFC3339.

Specifically, the logical types are mapped to certain grammar elements defined 
in RFC3339 as defined in the following table:

| logicalType              | RFC3339 grammar element                                       |
| ------------------------ | ------------------------------------------------------------- |
| `date`                   | RFC3339 5.6. “full-date”                                      |
| `time-millis`            | RFC3339 5.6. “date-time”                                      |
| `time-micros`            | RFC3339 5.6. “partial-time”                                   |
| `timestamp-millis`       | RFC3339 5.6 “date-time”                                       |
| `timestamp-micros`       | RFC3339 5.6 “date-time”                                       |
| `local-timestamp-millis` | RFC3339 5.6 “date-time”, ignoring offset (note RFC 3339 4.4)  |
| `local-timestamp-micros` | RFC3339 5.6 “date-time” , ignoring offset (note RFC 3339 4.4) |
| `duration`               | RFC3339 Appendix A “duration”                                 |

### Feature 5: Handling unions with primitive type values and enum values

Unions of primitive types and of enum values are handled through JSON values'
(RFC8259, Section 3) ability to reflect variable types.

Given a type union of `[string, null]` and a string value "test", a encoded
field named "example" is encoded as `"example": null` or `"example": "test"`.
For null-valued fields, the JSON encoder MAY omit the field entirely. During
decoding, missing fields are set to null. If a default value is defined for the
field, decoding MUST set the field value to the default value.

For a type union of `[string,int]` and string values "2" and the int value 2, a
encoded field named "example" is encoded as `"example": "2"`
or `"example":2`.

For a type union of `[null, myEnum]` with myEnum being an enum type having
symbols "test1" and "test2", a encoded field named "example" is encoded as
`"example": null` or `"example": "test1"` or `"example": "test2"`.

Instances of unions of primitive types with arrays and records or maps can also
be distinguished through the JSON grammar and type model. Unions of multiple
records are discussed in Feature 6 below.

For completeness, these are the updated type mappings of Avro types to JSON
types for the plain JSON encoding.

| Avro type    | JSON type | Notes                                                                               |
| ------------ | --------- | ----------------------------------------------------------------------------------- |
| null         | null      | The field MAY be omitted                                                            |
| boolean      | boolean   |                                                                                     |
| int          | integer   |                                                                                     |
| float,double | number    |                                                                                     |
| bytes        | string    | Base64 string, see [Feature 2](#feature-2-avro-binary-and-fixed-type-data-encoding) |
| string       | string    |                                                                                     |
| record       | object    |                                                                                     |
| enum         | string    |                                                                                     |
| array        | array     |                                                                                     |
| map          | object    |                                                                                     |
| fixed        | string    | Base64 string, see [Feature 2](#feature-2-avro-binary-and-fixed-type-data-encoding) |
| date/time    | string    | See [Feature 4](#feature-4-avro-time-date-and-duration-logical-types)               |
| UUID         | string    |                                                                                     |
| decimal, long| string    | See [Feature 3](#feature-3-avro-decimal-logical-type-data-encoding)                 |

### Feature 6: Handling unions of record values and of maps

As discussed in the overview, JSON does not have an inherent concept of a
type-hint that allows distinguishing object data types. Indeed, it has no
concept of constraining and further specifying the `object` type, at all.

The JSON Schema project has defined a schema language specifically for JSON data
and provides a type concept for `object`. In JSON interoperability scenarios,
JSON Schema, or frameworks that infer their type concepts from JSON Schema, will
often play a role on the producer or consumer side due to its popularity.

JSON Schema is primarily a schema model that serves to validate JSON documents.
Its "oneOf" type composition construct is equivalent to Avro's union concept in
function. Out of a choice of multiple type options, exactly one option MUST
match the JSON element that is being validated, otherwise the validation fails.
Any implementation of a JSON Schema validator must therefore be able to test the
given JSON element against all available options and then determine the matching
type option. Any implementation of a schema driven decoder can use the
same strategy to select which type to instantiate and populate.

JSON Schema does not define a type-hint for this purpose, but makes it the
schema designer's task to create type definitions that are structurally distinct
such that the "oneOf" test always yields one of the types when given JSON
element instances. Schema designers then occasionally resort to introducing
their own type-hints by either defining a discriminator property with a
single-value `enum` or with a `const` value, where the discriminator property
name is the same across the type options, but the values of the `enum` or
`const` are different. We will lean on this practice in the following.

#### Type structure matching

Consider the following Avro schema with a type union of two record types:

```JSON
{
  "type": "record",
  "name": "ContactList",
  "fields": [
    {
      "name": "contacts",
      "type": "array",
      "items": [
        {
          "type": "record",
          "name": "CustomerRecord",
          "fields": [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "int"}
            {"name": "customerId", "type": "string"}
          ]
        },
        {
          "type": "record",
          "name": "EmployeeRecord",
          "fields": [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "int"},
            {"name": "employeeId", "type": "string"}
          ]
        }
      ]
    }
  ]
}
```

Now consider the following JSON document:

```JSON
{
  "contacts": [
    {"name": "Alice", "age": 42, "customerId": "1234"},
    {"name": "Bob", "age": 43, "employeeId": "5678"}
  ]
}
```

We can clearly distinguish the two record types by the presence of the
respectively required `customerId` or `employeeId` field.

When decoding a type union, the JSON decoder MUST test the JSON element against
all available type options. A JSON element matches if it can be correctly and
completely decoded given the type-union candidate schema, including all
applicable nested or referenced definitions. If more than one of the options
matches, decoding MUST fail. The JSON decoder MUST select the type option that
matches the JSON element and instantiate and populate the corresponding type.

For performance reasons, it is highly desirable to avoid having to test a JSON
element against all possible type options in a union and instead have a single
property that can be tested first and short-circuits the type matching process.
We discuss that next.

#### Discriminator property

When we assume the Avro schema to be slightly different, we might end up with an
ambiguity that is not as easy to resolve. Let the `employeeId` and `customerId`	fields
be optional in the schema above, both typed as `["string", "null"]`.

When we now consider the following JSON document, we can't decide on the type
and will fail decoding:

```JSON
{
  "contacts": [
    {"name": "Alice", "age": 42},
    {"name": "Bob", "age": 43}
  ]
}
```

To resolve this ambiguity, we can introduce a discriminator property that
clearly identifies the type of the record. 

Instead of introducing a schema attribute that is specific to JSON, we instead
introduce a new Avro schema attribute `const` that defines a constant value for
the field it is defined on.

The value of the `const` field must match the field type. The value of the field
MUST always match the `const` value. During decoding, decoding MUST fail if the
field value is not equal to the `const` value. This rule ensures the function of
`const` as a discriminator. The `const` field is only allowed on fields of
primitive types and enum types.

Consider this Avro schema:

```JSON
{
  "type": "record",
  "name": "ContactList",
  "fields": [
    {
      "name": "contacts",
      "type": "array",
      "items": [
        {
          "type": "record",
          "name": "CustomerRecord",
          "fields": [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "int"},
            {"name": "customerId", "type": ["string", "null"]},
            {"name": "type", "type": "string", "const": "customer"}
          ]
        },
        {
          "type": "record",
          "name": "EmployeeRecord",
          "fields": [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "int"},
            {"name": "employeeId", "type": ["string", "null"]},
            {"name": "type", "type": "string", "const": "employee"}
          ]
        }
      ]
    }
  ]
}
```

The JSON document MUST now include the discriminator:

```JSON
{
  "contacts": [
    {"name": "Alice", "age": 42, "type": "customer"},
    {"name": "Bob", "age": 43,  "type": "employee"}
  ]
}
```

The `const` field MAY otherwise be used for any other purpose. The binary
decoder MAY skip encoding and decoding a field with a `const` attribute and
instead always return the constant value for the field similar to how the
`default` field is handled. The `const` value overrides the `default` value.
During encoding, the binary encoder SHOULD check that the field value matches
the `const` value and MAY fail encoding if it does not.

### Feature 7: Document root records

Avro schemas are defined as a single record or enum type at the top level or as
a top-level type union. JSON documents, however, may have top-level arrays and
maps. Without changing the fundamental Avro schema model, the plain JSON
encoding mode uses an annotation on `array` and `map` types defined inside
`record` types to allow for top-level arrays and maps in the JSON document.

The annotation is a boolean flag named `root` that is set to `true` on one
record field's array or map type. The `root` flag is only defined for `array`
and `map` types. If the `root` flag is present and has the value `true`, the
enclosing `record` type MUST have exactly this one field.

Given a JSON document with a top-level array like this:

```JSON
[
  {"name": "Alice", "age": 42},
  {"name": "Bob", "age": 43}
]
```

The Avro schema would be defined as follows:

```JSON
{
  "type": "record",
  "name": "PersonDocument",
  "fields": [
    {
      "name": "persons",
      "type": {
        "type": "array",
        "root": true,
        "items": {
          "type": "record",
          "name": "PersonRecord",
          "fields": [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "int"}
          ]          
        }
      }
    }
  ]
}
```

When the JSON decoder encounters a top-level array or map, it MUST match the
array or map to the field with the `root` flag set to `true`. When the `root`
flag is present on a field, the JSON encoder MUST yield the encoding of the
field as the encoding of the entire record. The JSON encoder MUST fail if the
`root` flag is set to `true` and if there is more than one field in the record.

When such a record type is used as a field type inside another record, it
consequently is always represented equivalent to a `map` or `array` type in the
JSON document.

In [type structure matching](#type-structure-matching) scenarios, a set `root`
on a `map` type causes the record type to be a candidate for the type matching
of JSON `object` values. The `root` flag on an `array` type causes the record
type to be a candidate for the type matching of JSON `array` values.

The Avro binary encoding is not functionally affected by this feature, but the
structural constraint imposed by the `root` flag MAY be enforced by the encoder.