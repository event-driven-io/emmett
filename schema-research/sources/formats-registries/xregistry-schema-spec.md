# Schema Registry Service - Version 1.0-rc4

<!-- words: formatvalidated compatibilityvalidated -->
<!-- words: formatvalidatedreason compatibilityvalidatedreason -->
<!-- words: jsonstructure jstruct namespace -->

## Abstract

This specification defines a Schema Registry extension to the xRegistry
document format and API [specification][xRegistry Core]. A Schema Registry
allows for the storage, management and discovery of schema documents.

## Table of Contents

- [Abstract](#abstract)
- [Table of Contents](#table-of-contents)
- [1. Overview](#1-overview)
  - [1.1. Schemas](#11-schemas)
  - [1.2. Schema References](#12-schema-references)
  - [1.3. Versioning](#13-versioning)
  - [1.4. Document Store](#14-document-store)
- [2. Notations and Terminology](#2-notations-and-terminology)
  - [2.1. Notational Conventions](#21-notational-conventions)
  - [2.2. Terminology](#22-terminology)
    - [2.2.1. Schema](#221-schema)
  - [2.3. Schema Group](#23-schema-group)
- [3. Schema Registry Model](#3-schema-registry-model)
- [4. Schema Registry](#4-schema-registry)
  - [4.1. Schema Groups](#41-schema-groups)
  - [4.2. Schema Resources](#42-schema-resources)
  - [4.3. Schema Formats](#43-schema-formats)
    - [4.3.1. JSON Schema](#431-json-schema)
    - [4.3.2. XML Schema](#432-xml-schema)
    - [4.3.3. Apache Avro Schema](#433-apache-avro-schema)
    - [4.3.4. Protobuf Schema](#434-protobuf-schema)
    - [4.3.5. JSON Structure Schema](#435-json-structure-schema)

## 1. Overview

A schema registry provides a repository for managing serialization, validation,
and data type definition schemas as they are commonly used in distributed
systems. Common schema formats include JSON Schema, JSON Structure, Apache Avro
Schema, Google Protobuf Schema, and XML Schema. However, this specification does
not mandate, or limit, which schema formats are used.

### 1.1. Schemas

Schema registries are generally used to share such schemas amongst multiple
parties.

When schemas are used to drive the serialization and encoding of data, like in
the cases of Apache Avro or Google Protobuf, the deserialization of structured
data from its encoded form requires the schema to be available to the
deserializer. The compactness of these serialization formats is achieved by
externalizing type information into a schema document. The registry allows for a
publisher of data to publish the schema document and pass a reference to it, and
for a consumer of data to retrieve the schema document and use it to decode the
data.

Formats like XML and JSON do not require a schema to decode the data, but
schemas are still very useful to establish a common understanding of the data
structures that are exchanged, provide a foundation for code generation, allow
for validation of the data, and provide an anchor for documentation and semantic
information, like scientific units for numeric values, that goes beyond simple
labels and data types. Generally, it is a best practice for data structures that
are exchanged in a distributed system to be described by a schema, even if the
data serialization model does not require one.

### 1.2. Schema References

In the [CloudEvents][CloudEvents dataschema] specification, the `dataschema`
attribute holds a URI and is specifically meant to reference a schema document
residing in a registry. For example, a CloudEvent with a `dataschema` attribute
pointing to a schema version in a schema registry might look like this, using
the schema version's [`self`][xRegistry self] URL as the value of the
`dataschema` attribute:

```json
{
    "specversion": "1.0",
    "id": "1234-5678-9012",
    "type": "com.example.event",
    "source": "https://example.com/source",
    "dataschema": "https://example.com/registry/schemagroups/com.example.schemas/schemas/com.example.event/versions/1.0",
    "datacontenttype": "application/vnd.google.protobuf",
    "data_base64": "...base64-encoded-data..."
}
```

Since this URL might be a bit long, the xRegistry core specification allows for
an implementation to provide an alternative, shorter, self-referencing URL that
points to the same schema version, via the [`shortself`][xRegistry shortself]
attribute. The specification is not prescriptive about the format of the shorter
URL, but it might follow common URL-shortening practices. With that, the above
example might look like this:

```json
{
    "specversion": "1.0",
    "id": "1234-5678-9012",
    "type": "com.example.event",
    "source": "https://example.com/source",
    "dataschema": "https://example.com/$267shU79S",
    "datacontenttype": "application/vnd.google.protobuf",
    "data_base64": "...base64-encoded-data..."
}
```

### 1.3. Versioning

When schemas are used in a system, they typically evolve over time. Data
structures are extended or modified, with parts added or deprecated or even
removed. Some of these changes are compatible with existing data, while others
are not.

Serialization generally occurs based on a specific schema version that the data
publisher uses. Multiple versions of publishers might exist in the same system,
using different schema versions, which is a common occurrence in systems that
perform live updates. Once data has been published, data serialized based on
several different versions might exist in a system, in queues, in databases, or
in files.

The schema registry therefore allows managing multiple versions of schemas,
declares their lineage, and states their compatibility policy. The compatibility
policy is used to determine whether a schema change is compatible with prior
versions and whether data that has been serialized based on prior versions can
still be deserialized and/or validated using the new schema. This compatibility
check is important to ensure that changes to schemas do not inadvertently break
the ability to read existing data, and MAY be enforced by implementations of the
schema registry. The [xRegistry Core][xRegistry Core] specification defines the
versioning and compatibility relationship mechanisms.

### 1.4. Document Store

The schema registry is a document store and therefore has the
[`hasdocument`][xRegistry hasdocument] attribute defined in the xRegistry Core
attribute (implicitly) defined as `true` for the `schema` Resource.

This means that the schema registry exposes the schema document through the
Resource's document view, using the stored media type. When no Version is
explicitly selected, the [default version][xRegistry default-version] is
exposed. The applicable protocol binding defines how clients select the
document and metadata views and how those views are retrieved.

This enables the ability to provide external parties with a link that they can
use without needing to know any details about xRegistry.

The applicable protocol binding also defines how clients create or update
schema Versions through the document view.

For example, the xRegistry HTTP Binding uses the `$details` URL suffix to
access the metadata view of the schema Resource or a specific Version.

Beyond this, the [xRegistry Core][xRegistry Core] specification provides rich
filtering and export/import capabilities, which can be used to retrieve schema
documents in bulk, or to export/import schemas and schema Versions in a
structured way. The [xRegistry pagination][xRegistry pagination] mechanism can
be used to retrieve large sets of schemas or schema versions in a paginated
manner.

## 2. Notations and Terminology

### 2.1. Notational Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://tools.ietf.org/html/rfc2119).

For clarity, OPTIONAL attributes (specification-defined and extensions) are
OPTIONAL for clients to use, but the servers' responsibility will vary.
Server-unknown extension attributes MUST be silently stored in the backing
datastore. Specification-defined and server-known extension attributes MUST
generate an error if the corresponding feature is not supported or enabled.
However, as with all attributes, if accepting the attribute would result in a
bad state (such as exceeding a size limit, or results in a security issue),
then the server MAY choose to reject the request.

In the pseudo JSON format snippets `?` means the preceding attribute is
OPTIONAL, `*` means the preceding attribute MAY appear zero or more times,
and `+` means the preceding attribute MUST appear at least once. The presence
of the `#` character means the remaining portion of the line is a comment.
Whitespace characters in the JSON snippets are used for readability and are
not normative.

### 2.2. Terminology

This specification defines the following terms:

#### 2.2.1. Schema

We use the term **schema** (or schema Resource) in this specification as a
logical grouping of **schema Versions**. A **schema Version** is a concrete
document. The **schema** Resource is a semantic umbrella formed around one or
more concrete schema Version documents that represent iterations of the same
logical schema. Per the definition of the [`compatibility`][xRegistry
compatibility] attribute, all Versions of a single **schema** MUST adhere to the
rules defined by the `compatibility` attribute. Any breaking change MUST result
in a new **schema** Resource being created.

In terms of versioning, you can think of a **schema** as a collection of
versions that are compatible according to the selected `compatibility` mode.
The [`deprecated`][xRegistry deprecated] attribute MAY be used to indicate the
appropriate new schema to use following a breaking change.

### 2.3. Schema Group

A Schema Group is a container for schemas that are related to each other in
some application-defined way. This specification does not impose any
restrictions on what schemas can be contained in a Schema Group.

## 3. Schema Registry Model

The authoritative xRegistry extension model of the Schema Registry resides in
the [model.json](model.json) file.

For easy reference, the JSON serialization of a Schema Registry adheres to
this form:

```yaml
{
  "specversion": "<STRING>",                       # xRegistry core attributes
  "registryid": "<STRING>",
  "self": "<URL>",
  "xid": "<XID>",
  "epoch": <UINTEGER>,
  "name": "<STRING>", ?
  "description": "<STRING>", ?
  "documentation": "<URL>", ?
  "labels": {
    "<STRING>": "<STRING>" *
  }, ?
  "createdat": "<TIMESTAMP>",
  "modifiedat": "<TIMESTAMP>",

  "model": { ... }, ?

  "schemagroups": {
    "KEY": {                                       # schemagroupid
      "schemagroupid": "<STRING>",                 # xRegistry core attributes
      "self": "<URL>",
      "xid": "<XID>",
      "epoch": <UINTEGER>,
      "name": "<STRING>", ?
      "description": "<STRING>", ?
      "documentation": "<URL>", ?
      "labels": { "<STRING>": "<STRING>" * }, ?
      "createdat": "<TIMESTAMP>",
      "modifiedat": "<TIMESTAMP>",
      "deprecated": { ... }, ?
      "format": "<STRING>", ?

      "schemas": {
        "KEY": {                                   # schemaid
          "schemaid": "<STRING>",                  # xRegistry core attributes
          "versionid": "<STRING>",
          "self": "<URL>",
          "xid": "<XID>",

          #  Start of default Version's attributes
          "epoch": <UINTEGER>,
          "name": "<STRING>", ?                    # Version level attrs
          "description": "<STRING>", ?
          "documentation": "<URL>", ?
          "labels": { "<STRING>": "<STRING>" * }, ?
          "createdat": "<TIMESTAMP>",
          "modifiedat": "<TIMESTAMP>",
          "ancestorid": "<STRING>",
          "contenttype": "<STRING>", ?
          "format": "<STRING>", ?
          "formatvalidated": <BOOLEAN>, ?
          "formatvalidatedreason": "<STRING>", ?
          "compatibilityvalidated": <BOOLEAN>, ?
          "compatibilityvalidatedreason": "<STRING>", ?

          "schemaurl": "<URL>", ?
          "schema": <ANY> ?
          "schemabase64": "<STRING>", ?
          #  End of default Version's attributes

          "metaurl": "<URL>",                      # Resource level attrs
          "meta": { ... }, ?

          "versions": { ... }, ?
          "versionsurl": "<URL>",
          "versionscount": <UINTEGER>
        } *
      }, ?
      "schemasurl": "<URL>",                       # Schemas collection
      "schemascount": <UINTEGER>
    } *
  }, ?
  "schemagroupsurl": "<URL>",                      # SchemaGroups collection
  "schemagroupscount": <UINTEGER>
}
```

## 4. Schema Registry

The Schema Registry is a metadata store for organizing schemas and schema
Versions of any kind; it is a document store.

Implementations of this specification MAY include additional extension
attributes, including the `*` attribute of type `any`.

Since the Schema Registry is an application of the [xRegistry
specification][xRegistry Core], all attributes for Groups, Resources, and
Resource Version objects are inherited from there.

### 4.1. Schema Groups

The Group (`<GROUP>`) name for the Schema Registry is `schemagroup` (singular).
The plural, used as the collection name, is `schemagroups`. The Schema Group
does not have any specific extension attributes.

A schema group is a collection of schemas that are related to each other in
some application-defined way. A Schema Group does not impose any restrictions
on the contained schemas, meaning that a Schema Group MAY contain schemas of
different formats.

Every schema (i.e. the schema Resource) MUST reside inside a Schema Group.

Example:

The following abbreviated Schema Registry content shows a single Schema Group
containing 5 schemas.

```yaml
{
  "specversion": "1.0-rc4",
  # other xRegistry top-level attributes excluded for brevity

  "schemagroups": {
    "com.example.schemas": {
      "schemagroupid": "com.example.schemas",
      # Other xRegistry Group-level attributes excluded for brevity

      "schemasurl": "https://example.com/schemagroups/com.example.schemas/schemas",
      "schemascount": 5
    }
  },
  "schemagroupsurl": "http://example.com/schemagroups",
  "schemagroupscount": 1
}
```

There might be cases where all schemas within a schemagroup need to have the
same `format` value. To enable this, set the schemagroup's `format` value to
the string that all schemas/Versions within that schemagroup need to use.

Additionally, if desired, a schemagroup-instance level constraint MAY be added:

```yaml
"constraints": {
  "schemas.format": {
    "default": "JsonSchema/draft-07"
  }
}
```

This will define a schemagroup-specific default value for the schemas' `format`
value so clients would not need to specify it manually for each schema.

### 4.2. Schema Resources

The Resource (`<RESOURCE>`) inside of Schema Groups is named `schema`. The
plural, used as the collection name, is `schemas`. Any single `schema` is a
container for one or more `versions`, which hold the concrete schema documents
or schema document references.

All Versions of a single Schema Resource MUST adhere to the semantic rules of
the schema's [`compatibility`][xRegistry compatibility] attribute, if specified.

Implementations of this specification MAY choose to support any of the
[`compatibility`][xRegistry compatibility] values defined in the core xRegistry
specification.

Implementations of this specification SHOULD use the xRegistry default algorithm
for generating new `versionid` values and for determining which is the latest
Version. See [Version IDs][xRegistry version-ids] for more information, but in
summary it means:

- `versionid`s are unsigned integers starting with `1`
- They monotonically increase by `1` with each new Version
- The latest is the Version with the lexically largest `versionid` value after
  all `versionid`s have been left-padded with spaces to the same length

When semantic versioning is used in a solution, it is RECOMMENDED to include a
major version identifier in the `schemaid`, like `"com.example.event.v1"` or
`"com.example.event.2024-02"`, so that incompatible, but historically related
schemas can be more easily identified by users and developers. The schema
`versionid` then functions as the semantic minor version identifier.

The [`ancestorid`][xRegistry ancestorid] attribute permits multiple version
branches to exist, and allows for implementations to determine the Version
lineage. See the [`ancestorid`][xRegistry ancestorid] attribute in the core
xRegistry specification for more information.

### 4.3. Schema Formats

This specification further refines the
[core specification's `format`](../core/spec.md#format-attribute) for use
in a Schema Registry by defining a set of common schema format names that MUST
be used for the given formats, but applications MAY define extensions for
other formats on their own.

- Examples:
  - `JsonSchema/draft-07`
  - `Protobuf/3`
  - `XSD/1.1`
  - `Avro/1.9`

The following abbreviated example shows three embedded `Protobuf/3` schema
Versions for a schema named `com.example.telemetrydata`:

```yaml
{
  "specversion": "1.0-rc4",
  # other xRegistry top-level attributes excluded for brevity

  "schemagroups": {
    "com.example.telemetry": {
      "schemagroupid": "com.example.telemetry",
      # other xRegistry group-level attributes excluded for brevity

      "schemas": {
        "com.example.telemetrydata": {
          "schemaid": "com.example.telemetrydata",
          "versionid": "3",
          "isdefault": true,
          "description": "device telemetry event data",
          "ancestorid": "2",
          "format": "Protobuf/3",
          # other xRegistry default Version attributes excluded for brevity

          "schema": "syntax = \"proto3\"; message Metrics { float metric = 1; string unit = 2; string description = 3; }",

          "metaurl": "http://example.com/schemagroups/com.example.telemetry/schemas/com.example.telemetrydata/meta",

          "versions": {
            "1": {
              "schemaid": "com.example.telemetrydata",
              "versionid": "1",
              "isdefault": false,
              "description": "device telemetry event data",
              "ancestorid": "1",
              "format": "Protobuf/3",
              # other xRegistry Version-level attributes excluded for brevity

              "schema": "syntax = \"proto3\"; message Metrics { float metric = 1; }"
            },
            "2": {
              "schemaid": "com.example.telemetrydata",
              "versionid": "2",
              "isdefault": false,
              "description": "device telemetry event data",
              "ancestorid": "1",
              "format": "Protobuf/3",
              # other xRegistry Version-level attributes excluded for brevity

              "schema": "syntax = \"proto3\"; message Metrics { float metric = 1; string unit = 2; }"
            },
            "3": {
              "schemaid": "com.example.telemetrydata",
              "versionid": "3",
              "isdefault": true,
              "description": "device telemetry event data",
              "ancestorid": "2",
              "format": "Protobuf/3",
              # other xRegistry Version-level attributes excluded for brevity

              "schema": "syntax = \"proto3\"; message Metrics { float metric = 1; string unit = 2; string description = 3; }"
            }
          },
          "versionsurl": "http://example.com/schemagroups/com.example.telemetry/schemas/com.example.telemetrydata/versions",
          "versionscount": 3
        }
      },
      "schemasurl": "http://example.com/schemagroups/com.example.telemetry/schemas",
      "schemascount": 1
    }
  },
  "schemagroupsurl": "http://example.com/schemagroups",
  "schemagroupscount": 1
}
```

#### 4.3.1. JSON Schema

The [`format`](../core/spec.md#format-attribute) identifier for JSON Schema is
`JsonSchema`.

When the `format` attribute is set to `JsonSchema`, the `schema` attribute of
the schema Resource is a JSON object representing a JSON Schema document
conformant with the declared version.

When a URI, like the Message Registry's
[`dataschemauri`](../message/spec.md#dataschemauri), points to a JSON Schema
document, it MAY use a [JSON pointer][JSON pointer] expression to deep link into
the schema document to reference a particular type definition. Otherwise the
top-level object definition of the schema is used.

The version of the JSON Schema format is the version of the JSON Schema
specification that is used to define the schema. The version of the JSON Schema
specification is defined in the `$schema` attribute of the schema document.

The identifiers for the following JSON Schema versions

- Draft 07: `http://json-schema.org/draft-07/schema`
- Draft 2019-09: `https://json-schema.org/draft/2019-09/schema`
- Draft 2020-12: `https://json-schema.org/draft/2020-12/schema`

are defined as follows:

- `JsonSchema/draft-07`
- `JsonSchema/draft/2019-09`
- `JsonSchema/draft/2020-12`

which follows the exact convention as defined for JSON schema and expecting an
eventually released version 1.0 of the JSON Schema specification using a plain
version number.

#### 4.3.2. XML Schema

The [`format`](../core/spec.md#format-attribute) identifier for XML Schema is
`XSD`. The version of the XML Schema format is the version of the W3C XML
Schema specification that is used to define the schema.

When the `format` attribute is set to `XSD`, the `schema` attribute of the
schema Resource is a string containing an XML Schema document conformant with
the declared version.

When a URI, like the Message Registry's
[`dataschemauri`](../message/spec.md#dataschemauri), points to an XML Schema
document, it MAY use an XPath expression to deep link into the schema document
to reference a particular type definition. Otherwise the top-level object
definition of the schema is used.

The identifiers for the following XML Schema versions:

- 1.0: `https://www.w3.org/TR/xmlschema-1/`
- 1.1: `https://www.w3.org/TR/xmlschema11-1/`

are defined as follows:

- `XSD/1.0`
- `XSD/1.1`

#### 4.3.3. Apache Avro Schema

The [`format`](../core/spec.md#format-attribute) identifier for Apache Avro
Schema is `Avro`. The version of the Apache Avro Schema format is the version
of the Apache Avro Schema release that is used to define the schema.

When the `format` attribute is set to `Avro`, the `schema` attribute of the
schema Resource is a JSON object representing an Avro schema document conformant
with the declared version.

Examples:

- `Avro/1.8.2` is the identifier for the Apache Avro release 1.8.2.
- `Avro/1.11.0` is the identifier for the Apache Avro release 1.11.0

When a URI, like the Message Registry's
[`dataschemauri`](../message/spec.md#dataschemauri), points to an Avro Schema
document, it MAY use a URI fragment suffix `[:]{record-name}` to deep link into
the schema document to reference a particular type definition. Otherwise the
top-level object definition of the schema is used. The ':' character is used as
a separator when the URI already contains a fragment.

Examples:

- If the Avro schema document is referenced using the URI
`https://example.com/avro/telemetry.avsc#TelemetryEvent`, the URI fragment
`#TelemetryEvent` references the record declaration of the `TelemetryEvent`
record.
- If the Avro schema document is a local Schema Registry reference like
`#/schemagroups/com.example.telemetry/schemas/com.example.telemetrydata`, in
which the reference is already in the form of a URI fragment, the suffix is
appended, separated by a colon, for instance
`.../com.example.telemetrydata:TelemetryEvent`.

#### 4.3.4. Protobuf Schema

The [`format`](../core/spec.md#format-attribute) identifier for Protobuf Schema
is `Protobuf`. The version of the Protobuf Schema format is the version of the
Protobuf syntax that is used to define the schema.

When the `format` attribute is set to `Protobuf`, the `schema` attribute of the
schema Resource is a string containing a Protobuf schema document conformant
with the declared version.

- `Protobuf/3` is the identifier for the Protobuf syntax version 3.
- `Protobuf/2` is the identifier for the Protobuf syntax version 2.

A URI, like the Message Registry's
[`dataschemauri`](../message/spec.md#dataschemauri), that points to a Protobuf
Schema document MUST reference a Protobuf `message` declaration contained in the
schema document. If the URI does not contain a fragment, the message name MUST
be appended as a URI fragment using `#{message-name}`. If the URI already
contains a fragment, the message name MUST be appended to the fragment using
`:{message-name}`.

Examples:

- If the Protobuf schema document is referenced using the URI
  `https://example.com/protobuf/telemetry.proto`, the URI fragment
  `#TelemetryEvent` references the message declaration of the `TelemetryEvent`
  message.
- If the Protobuf schema document is a local Schema Registry reference like
  `#/schemagroups/com.example.telemetry/schemas/com.example.telemetrydata`, in
  which the reference is already in the form of a URI fragment, the suffix
  is appended, separated by a colon, for instance
  `.../com.example.telemetrydata:TelemetryEvent`.

#### 4.3.5. JSON Structure Schema

The [`format`](../core/spec.md#format-attribute) identifier for JSON Structure
Schema is `JsonStructure`. When the `format` attribute is set to `JsonStructure`,
the `schema` attribute of the schema Resource is a JSON object representing a JSON
Structure schema document [JSTRUCT-CORE].

The version identifier follows the pattern `JsonStructure/{version}`, where
`{version}` is the version of the JSON Structure Core specification that is
used to define the schema.

`JsonStructure/draft-04` is the identifier for the Internet-Draft version 04 of
the JSON Structure Core specification. If a future RFC is published, the
version identifier will be updated to reflect the RFC number, for example
`JsonStructure/rfc-0000`.

When a URI, like the Message Registry's
[`dataschemauri`](../message/spec.md#dataschemauri), points to a JSON Structure
schema document, it MAY use a [JSON pointer][JSON pointer] expression to deep
link into the schema document to reference a particular type definition. This is
typically used to reference type definitions within the `definitions` namespace.

Examples:

- `https://example.com/schemas/person.json#/definitions/Employee` uses the
  `#/definitions/Employee` fragment to reference the `Employee` type definition.
- For local Schema Registry references like
  `#/schemagroups/com.example.schemas/schemas/com.example.person/versions/1/definitions/Employee`,
  append the JSON Pointer fragment to reference a specific type within that schema.



Like the [xRegistry Core][xRegistry Core] specification, this specification does
not explicitly address authentication or authorization levels of users, nor how
to securely protect the APIs.

It is expected that any implementation of this specification will use
authentication and authorization mechanisms that are appropriate for the
application domain and the deployment environment. This MAY include, but is not
limited to, OAuth 2.0, OpenID Connect, API keys, or other mechanisms appropriate
for the use case.

For authorization, the `schemagroup` concept provides a natural authorization
boundary, where users can be granted access to specific schema groups, and
therefore to the schemas contained within those groups. The `schema` Resource
itself can be used to further restrict access to specific schema Versions within
a schema, allowing for fine-grained access control.

---

[JSON Pointer]: https://www.rfc-editor.org/rfc/rfc6901
[JSTRUCT-CORE]: https://json-structure.github.io/core/draft-vasters-json-structure-core.html
[CloudEvents dataschema]: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md#dataschema
[xRegistry Core]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html
[xRegistry self]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#self-attribute
[xRegistry shortself]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#shortself-attribute
[xRegistry compatibility]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#compatibility-attribute
[xRegistry version-ids]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#version-ids
[xRegistry attributes-and-extensions]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#attributes-and-extensions
[xRegistry ancestorid]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#ancestorid-attribute
[xRegistry pagination]: https://xregistry.io/xreg/xregistryspecs/pagination-v1/docs/spec.html
[xRegistry deprecated]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#deprecated
[xRegistry default-version]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#registry-design
[xRegistry hasdocument]: https://xregistry.io/xreg/xregistryspecs/core-v1/docs/spec.html#hasdocument
