# Avrotize & Structurize

mcp-name: io.github.clemensv/avrotize

[![PyPI version](https://img.shields.io/pypi/v/avrotize)](https://pypi.org/project/avrotize/)
[![Python Versions](https://img.shields.io/pypi/pyversions/avrotize)](https://pypi.org/project/avrotize/)
[![Build Status](https://github.com/clemensv/avrotize/actions/workflows/build_deploy.yml/badge.svg)](https://github.com/clemensv/avrotize/actions/workflows/build_deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/pypi/dm/avrotize)](https://pypi.org/project/avrotize/)

**[📚 Documentation & Examples](https://clemensv.github.io/avrotize/)** | **[🎨 Conversion Gallery](https://clemensv.github.io/avrotize/gallery/)**

Avrotize is a ["Rosetta Stone"](https://en.wikipedia.org/wiki/Rosetta_Stone) for data structure definitions, allowing you to convert between numerous data and database schema formats and to generate code for different programming languages.

It is, for instance, a well-documented and predictable converter and code generator for data structures originally defined in JSON Schema (of arbitrary complexity).

The tool leans on the Apache Avro-derived [Avrotize Schema](specs/avrotize-schema.md) as its schema model.

- Programming languages: Python, C#, Java, TypeScript, JavaScript, Rust, Go, C++
- SQL Databases: MySQL, MariaDB, PostgreSQL, SQL Server, Oracle, SQLite, BigQuery, Snowflake, Redshift, DB2
- Other databases: KQL/Kusto, SurrealDB, MongoDB, Cassandra, Redis, Elasticsearch, DynamoDB, CosmosDB
- Data schema formats: Avro, JSON Schema, JSON Structure, XML Schema (XSD), Protocol Buffers 2 and 3, ASN.1, Apache Parquet, JSON Type Definition (JTD), CDDL, CUE, FlatBuffers, Apache Thrift IDL, Smithy IDL, Cap'n Proto, RAML 1.0 Data Types, and OpenAPI 3.x

## Installation

You can install Avrotize from PyPI, [having installed Python 3.10 or later](https://www.python.org/downloads/):

```bash
pip install avrotize
```

For MCP server support (`avrotize mcp`), install with the MCP extra:

```bash
pip install "avrotize[mcp]"
```

For SQL database support (`sql2a` command), install the optional database drivers:

```bash
# PostgreSQL
pip install avrotize[postgres]

# MySQL
pip install avrotize[mysql]

# SQL Server
pip install avrotize[sqlserver]

# All SQL databases
pip install avrotize[all-sql]
```

## Usage

Avrotize provides several commands for converting schema formats via Avrotize Schema.

Converting to Avrotize Schema:

- [`avrotize s2a`](jsonstructure.md#conversion-from-json-structure-into-avro-schema) - Convert JSON Structure to Avrotize Schema.
- [`avrotize j2a`](#convert-json-schema-to-avrotize-schema) - Convert JSON schema to Avrotize Schema.
- [`avrotize p2a`](#convert-proto-schema-to-avrotize-schema) - Convert Protobuf (2 or 3) schema to Avrotize Schema.
- [`avrotize x2a`](#convert-xml-schema-xsd-to-avrotize-schema) - Convert XML schema to Avrotize Schema.
- [`avrotize asn2a`](#convert-asn1-schema-to-avrotize-schema) - Convert ASN.1 to Avrotize Schema.
- [`avrotize jtd2a`](#convert-json-type-definition-jtd-to-avrotize-schema) - Convert JSON Type Definition (JTD) to Avrotize Schema.
- [`avrotize cue2a`](#convert-cue-schema-subset-to-avrotize-schema) - Convert a supported CUE schema subset to Avrotize Schema.
- [`avrotize fbs2a`](#convert-flatbuffers-schema-to-avrotize-schema) - Convert FlatBuffers schema to Avrotize Schema.
- [`avrotize thrift2a`](#convert-apache-thrift-idl-to-avrotize-schema) - Convert Apache Thrift IDL to Avrotize Schema.
- [`avrotize smithy2a`](#convert-smithy-idl-data-shapes-to-avrotize-schema) - Convert Smithy 2.0 IDL data shapes to Avrotize Schema.
- [`avrotize capnp2a`](#convert-capn-proto-schema-to-avrotize-schema) - Convert Cap'n Proto schema to Avrotize Schema.
- [`avrotize raml2a`](#convert-raml-data-types-to-avrotize-schema) - Convert RAML 1.0 Data Types to Avrotize Schema.
- [`avrotize kstruct2a`](#convert-kafka-connect-schema-to-avrotize-schema) - Convert Kafka Connect Schema to Avrotize Schema.
- [`avrotize sql2a`](#convert-sql-database-schema-to-avrotize-schema) - Convert SQL database schema to Avrotize Schema.
- [`avrotize k2a`](#convert-kusto-table-definition-to-avrotize-schema) - Convert Kusto table definitions to Avrotize Schema.
- [`avrotize surreal2a`](#convert-surrealql-schema-to-avrotize-schema) - Convert SurrealQL schema definitions to Avrotize Schema.
- [`avrotize pq2a`](#convert-parquet-schema-to-avrotize-schema) - Convert Parquet schema to Avrotize Schema.
- [`avrotize csv2a`](#convert-csv-file-to-avrotize-schema) - Convert CSV file to Avrotize Schema.

Converting from Avrotize Schema:

- [`avrotize a2s`](jsonstructure.md#conversion-of-avro-schema-into-json-structure) - Convert Avrotize Schema to JSON Structure.
- [`avrotize a2j`](#convert-avrotize-schema-to-json-schema) - Convert Avrotize Schema to JSON schema.
- [`avrotize a2p`](#convert-avrotize-schema-to-proto-schema) - Convert Avrotize Schema to Protobuf 3 schema.
- [`avrotize a2x`](#convert-avrotize-schema-to-xml-schema) - Convert Avrotize Schema to XML schema.
- [`avrotize a2asn`](#convert-avrotize-schema-to-asn1-schema) - Convert Avrotize Schema to ASN.1 schema.
- [`avrotize a2jtd`](#convert-avrotize-schema-to-json-type-definition-jtd) - Convert Avrotize Schema to JSON Type Definition (JTD).
- [`avrotize a2cue`](#convert-avrotize-schema-to-cue-schema-subset) - Convert Avrotize Schema to the supported CUE schema subset.
- [`avrotize a2fbs`](#convert-avrotize-schema-to-flatbuffers-schema) - Convert Avrotize Schema to FlatBuffers schema.
- [`avrotize a2thrift`](#convert-avrotize-schema-to-apache-thrift-idl) - Convert Avrotize Schema to Apache Thrift IDL.
- [`avrotize a2smithy`](#convert-avrotize-schema-to-smithy-idl-data-shapes) - Convert Avrotize Schema to Smithy 2.0 IDL data shapes.
- [`avrotize a2capnp`](#convert-avrotize-schema-to-capn-proto-schema) - Convert Avrotize Schema to Cap'n Proto schema.
- [`avrotize a2raml`](#convert-avrotize-schema-to-raml-data-types) - Convert Avrotize Schema to RAML 1.0 Data Types.
- [`avrotize a2sql`](#convert-avrotize-schema-to-sql-table-definition) - Convert Avrotize Schema to SQL table definition.
- [`avrotize a2k`](#convert-avrotize-schema-to-kusto-table-declaration) - Convert Avrotize Schema to Kusto table definition.
- [`avrotize a2tsml`](#convert-avrotize-schema-to-tabular-model-scripting-language-tmsl) - Convert Avrotize Schema to Tabular Model Scripting Language (TMSL).
- [`avrotize a2surreal`](#convert-avrotize-schema-to-surrealql-schema) - Convert Avrotize Schema to SurrealQL schema definitions.
- [`avrotize a2pq`](#convert-avrotize-schema-to-empty-parquet-file) - Convert Avrotize Schema to Parquet or Iceberg schema.
- [`avrotize a2ib`](#convert-avrotize-schema-to-iceberg-schema) - Convert Avrotize Schema to Iceberg schema.
- [`avrotize a2mongo`](#convert-avrotize-schema-to-mongodb-schema) - Convert Avrotize Schema to MongoDB schema.
- [`avrotize a2cassandra`](#convert-avrotize-schema-to-cassandra-schema) - Convert Avrotize Schema to Cassandra schema.
- [`avrotize a2es`](#convert-avrotize-schema-to-elasticsearch-schema) - Convert Avrotize Schema to Elasticsearch schema.
- [`avrotize a2dynamodb`](#convert-avrotize-schema-to-dynamodb-schema) - Convert Avrotize Schema to DynamoDB schema.
- [`avrotize a2cosmos`](#convert-avrotize-schema-to-cosmosdb-schema) - Convert Avrotize Schema to CosmosDB schema.
- [`avrotize a2couchdb`](#convert-avrotize-schema-to-couchdb-schema) - Convert Avrotize Schema to CouchDB schema.
- [`avrotize a2firebase`](#convert-avrotize-schema-to-firebase-schema) - Convert Avrotize Schema to Firebase schema.
- [`avrotize a2hbase`](#convert-avrotize-schema-to-hbase-schema) - Convert Avrotize Schema to HBase schema.
- [`avrotize a2neo4j`](#convert-avrotize-schema-to-neo4j-schema) - Convert Avrotize Schema to Neo4j schema.
- [`avrotize a2dp`](#convert-avrotize-schema-to-datapackage-schema) - Convert Avrotize Schema to Datapackage schema.
- [`avrotize a2csv`](#convert-avrotize-schema-to-csv-schema) - Convert Avrotize schema to CSV schema.
- [`avrotize a2graphql`](#convert-avrotize-schema-to-graphql-schema) - Convert Avrotize schema to GraphQL schema.
- [`avrotize a2md`](#convert-avrotize-schema-to-markdown-documentation) - Convert Avrotize Schema to Markdown documentation.

Converting to and from JSON Structure:

- [`avrotize j2s`](jsonschematostructure.md) - Convert JSON Schema to JSON Structure.
- [`avrotize s2j`](structuretojsonschema.md) - Convert JSON Structure to JSON Schema.
- [`avrotize s2p`](#convert-json-structure-to-protocol-buffers) - Convert JSON Structure to Protocol Buffers (.proto files).
- [`avrotize s2x`](#convert-json-structure-to-xml-schema-xsd) - Convert JSON Structure to XML Schema (XSD).
- [`avrotize s2asn`](#convert-json-structure-schema-to-asn1-schema) - Convert JSON Structure Schema to ASN.1 schema.
- [`avrotize jtd2s`](#convert-json-type-definition-jtd-to-json-structure) - Convert JSON Type Definition (JTD) to JSON Structure.
- [`avrotize s2jtd`](#convert-json-structure-to-json-type-definition-jtd) - Convert JSON Structure to JSON Type Definition (JTD).
- [`avrotize cddl2s`](cddl.md) - Convert CDDL schema to JSON Structure.
- [`avrotize s2cddl`](cddl.md) - Convert JSON Structure to CDDL schema.
- [`avrotize oas2s`](#convert-openapi-to-json-structure) - Convert OpenAPI 3.x document to JSON Structure.
- [`avrotize cue2s`](#convert-cue-schema-subset-to-json-structure) - Convert a supported CUE schema subset to JSON Structure.
- [`avrotize s2cue`](#convert-json-structure-to-cue-schema-subset) - Convert JSON Structure to the supported CUE schema subset.
- [`avrotize fbs2s`](#convert-flatbuffers-schema-to-json-structure) - Convert FlatBuffers schema to JSON Structure.
- [`avrotize s2fbs`](#convert-json-structure-to-flatbuffers-schema) - Convert JSON Structure to FlatBuffers schema.
- [`avrotize thrift2s`](#convert-apache-thrift-idl-to-json-structure) - Convert Apache Thrift IDL to JSON Structure.
- [`avrotize s2thrift`](#convert-json-structure-to-apache-thrift-idl) - Convert JSON Structure to Apache Thrift IDL.
- [`avrotize smithy2s`](#convert-smithy-idl-data-shapes-to-json-structure) - Convert Smithy 2.0 IDL data shapes to JSON Structure.
- [`avrotize s2smithy`](#convert-json-structure-to-smithy-idl-data-shapes) - Convert JSON Structure to Smithy 2.0 IDL data shapes.
- [`avrotize capnp2s`](#convert-capn-proto-schema-to-json-structure) - Convert Cap'n Proto schema to JSON Structure.
- [`avrotize s2capnp`](#convert-json-structure-to-capn-proto-schema) - Convert JSON Structure to Cap'n Proto schema.
- [`avrotize raml2s`](#convert-raml-data-types-to-json-structure) - Convert RAML 1.0 Data Types to JSON Structure.
- [`avrotize s2raml`](#convert-json-structure-to-raml-data-types) - Convert JSON Structure to RAML 1.0 Data Types.
- [`avrotize s2sql`](#convert-json-structure-schema-to-sql-schema) - Convert JSON Structure Schema to SQL table definition.
- [`avrotize s2k`](#convert-json-structure-schema-to-kusto-table-declaration) - Convert JSON Structure Schema to Kusto table definition.
- [`avrotize k2s`](#convert-kusto-table-definition-to-json-structure) - Convert Kusto table definitions to JSON Structure.
- [`avrotize s2tsml`](#convert-json-structure-to-tabular-model-scripting-language-tmsl) - Convert JSON Structure to Tabular Model Scripting Language (TMSL).
- [`avrotize s2pq`](#convert-json-structure-to-empty-parquet-file) - Convert JSON Structure to Parquet schema.
- [`avrotize s2ib`](#convert-json-structure-to-iceberg-schema) - Convert JSON Structure to Iceberg schema.
- [`avrotize s2cassandra`](#convert-json-structure-schema-to-cassandra-schema) - Convert JSON Structure Schema to Cassandra schema.
- [`avrotize s2graphql`](#convert-json-structure-schema-to-graphql-schema) - Convert JSON Structure schema to GraphQL schema.
- [`avrotize s2dp`](#convert-json-structure-schema-to-datapackage-schema) - Convert JSON Structure schema to Datapackage schema.
- [`avrotize s2csv`](#convert-json-structure-to-csv-schema) - Convert JSON Structure schema to CSV schema.
- [`avrotize s2md`](#convert-json-structure-schema-to-markdown-documentation) - Convert JSON Structure schema to Markdown documentation.

Inferring schemas from data:

- [`avrotize json2a`](#infer-avro-schema-from-json-files) - Infer Avro schema from JSON files.
- [`avrotize json2s`](#infer-json-structure-schema-from-json-files) - Infer JSON Structure schema from JSON files.
- [`avrotize xml2a`](#infer-avro-schema-from-xml-files) - Infer Avro schema from XML files.
- [`avrotize xml2s`](#infer-json-structure-schema-from-xml-files) - Infer JSON Structure schema from XML files.

Generate code from Avrotize Schema:

- [`avrotize a2cs`](#convert-avrotize-schema-to-c-classes) - Generate C# code from Avrotize Schema.
- [`avrotize a2java`](#convert-avrotize-schema-to-java-classes) - Generate Java code from Avrotize Schema.
- [`avrotize a2py`](#convert-avrotize-schema-to-python-classes) - Generate Python code from Avrotize Schema.
- [`avrotize a2ts`](#convert-avrotize-schema-to-typescript-classes) - Generate TypeScript code from Avrotize Schema.
- [`avrotize a2js`](#convert-avrotize-schema-to-javascript-classes) - Generate JavaScript code from Avrotize Schema.
- [`avrotize a2go`](#convert-avrotize-schema-to-go-classes) - Generate Go code from Avrotize Schema.
- [`avrotize a2rust`](#convert-avrotize-schema-to-rust-classes) - Generate Rust code from Avrotize Schema.
- [`avrotize a2cpp`](#convert-avrotize-schema-to-c-classes) - Generate C++ code from Avrotize Schema.

Generate code from JSON Structure:

- [`avrotize s2cs`](#convert-json-structure-to-c-classes) - Generate C# code from JSON Structure schema.
- [`avrotize s2java`](#convert-json-structure-to-java-classes) - Generate Java code from JSON Structure schema.
- [`avrotize s2py`](#convert-json-structure-to-python-classes) - Generate Python code from JSON Structure schema.
- [`avrotize s2ts`](#convert-json-structure-to-typescript-classes) - Generate TypeScript code from JSON Structure schema.
- [`avrotize s2js`](#convert-json-structure-to-javascript-classes) - Generate JavaScript code from JSON Structure schema.
- [`avrotize s2go`](#convert-json-structure-to-go-classes) - Generate Go code from JSON Structure schema.
- [`avrotize s2rust`](#convert-json-structure-to-rust-classes) - Generate Rust code from JSON Structure schema.
- [`avrotize s2cpp`](#convert-json-structure-to-c-classes) - Generate C++ code from JSON Structure schema.

Other commands:

- [`avrotize validate`](#validate-json-instances-against-schemas) - Validate JSON instances against Avro or JSON Structure schemas.
- `avrotize mcp` - Run Avrotize as a local MCP server exposing conversion tools to MCP clients.
- [`avrotize pcf`](#create-the-parsing-canonical-form-pcf-of-an-avrotize-schema) - Create the Parsing Canonical Form (PCF) of an Avrotize Schema.
- [`avrotize validate-tmsl`](#validate-tmsl-scripts-locally) - Validate TMSL scripts locally against documented object structure.

## Overview

## MCP server

You can run Avrotize as a local MCP server over stdio:

```bash
avrotize mcp
```

Catalog-ready metadata files are included:

- Official MCP Registry manifest: [server.json](server.json)
- Microsoft/GitHub MCP catalog listing template: [catalogs/microsoft-github-mcp.md](catalogs/microsoft-github-mcp.md)
- Generic cross-catalog manifest (optional): [mcp-server.json](mcp-server.json)
- VS Code + Copilot usage quickstart: [copilot-vscode-mcp-quickstart.md](copilot-vscode-mcp-quickstart.md)

To publish to the official MCP Registry:

```bash
mcp-publisher validate server.json
mcp-publisher publish server.json
```

The MCP server exposes tools to:

- describe server capabilities and routing guidance (`describe_capabilities`)
- list available conversion commands (`list_conversions`)
- inspect a conversion command (`get_conversion`)
- execute conversions (`run_conversion`)

You can use Avrotize to convert between Avro/Avrotize Schema and other schema formats like JSON Schema, XML Schema (XSD), Protocol Buffers (Protobuf), ASN.1, and database schema formats like Kusto Data Table Definition (KQL) and SQL Table Definition. That means you can also convert from JSON Schema to Protobuf going via Avrotize Schema.

You can also generate C#, Java, TypeScript, JavaScript, and Python code from Avrotize Schema documents. The difference to the native Avro tools is that Avrotize can emit data classes without Avro library dependencies and, optionally, with annotations for JSON serialization libraries like Jackson or System.Text.Json.

The tool does not convert data (instances of schemas), only the data structure definitions.

Mind that the primary objective of the tool is the conversion of schemas that describe data structures used in applications, databases, and message systems. While the project's internal tests do cover a lot of ground, it is nevertheless not a primary goal of the tool to convert every complex document schema like those used for devops pipeline or system configuration files.

## Why?

Data structure definitions are an essential part of data exchange, serialization, and storage. They define the shape and type of data, and they are foundational for tooling and libraries for working with the data. Nearly all data schema languages are coupled to a specific data exchange or storage format, locking the definitions to that format.

Avrotize is designed as a tool to "unlock" data definitions from JSON Schema or XML Schema and make them usable in other contexts. The intent is also to lay a foundation for transcoding data from one format to another, by translating the schema definitions as accurately as possible into the schema model of the target format's schema. The transcoding of the data itself requires separate tools that are beyond the scope of this project.

The use of the term "data structure definition" and not "data object definition" is quite intentional. The focus of the tool is on data structures that can be used for messaging and eventing payloads, for data serialization, and for database tables, with the goal that those structures can be mapped cleanly from and to common programming language types.

Therefore, Avrotize intentionally ignores common techniques to model object-oriented inheritance. For instance, when converting from JSON Schema, all content from `allOf` expressions is merged into a single record type rather than trying to model the inheritance tree in Avro.

## Avrotize Schema

Avrotize Schema is a schema model that is a full superset of the popular Apache Avro Schema model. Avrotize Schema is the "pivot point" for this tool. All schemas are converted from and to Avrotize Schema.

Since Avrotize Schema is a superset of Avro Schema and uses its extensibility features, every Avrotize Schema is also a valid Avro Schema and vice versa.

Why did we pick Avro Schema as the foundational schema model?

Avro Schema ...

- provides a simple, clean, and concise way to define data structures. It is quite easy to understand and use.
- is self-contained by design without having or requiring external references. Avro Schema can express complex data structure hierarchies spanning multiple namespace boundaries all in a single file, which neither JSON Schema nor XML Schema nor Protobuf can do.
- can be resolved by code generators and other tools "top-down" since it enforces dependencies to be ordered such that no forward-referencing occurs.
- emerged out of the Apache Hadoop ecosystem and is widely used for serialization and storage of data and for data exchange between systems.
- supports native and logical types that cover the needs of many business and technical use cases.
- can describe the popular JSON data encoding very well and in a way that always maps cleanly to a wide range of programming languages and systems. In contrast, it's quite easy to inadvertently define a JSON Schema that is very difficult to map to a programming language structure.
- is itself expressed as JSON. That makes it easy to parse and generate, which is not the case for Protobuf or ASN.1, which require bespoke parsers.

> It needs to be noted here that while Avro Schema is great for defining data structures, and data classes generated from Avro Schema using this tool or other tools can be used to with the most popular JSON serialization libraries, the Apache Avro project's own JSON encoding has fairly grave interoperability issues with common usage of JSON. Avrotize defines an alternate JSON encoding

 in [`avrojson.md`](avrojson.md).

Avro Schema does not support all the bells and whistles of XML Schema or JSON Schema, but that is a feature, not a bug, as it ensures the portability of the schemas across different systems and infrastructures. Specifically, Avro Schema does not support many of the data validation features found in JSON Schema or XML Schema. There are no `pattern`, `format`, `minimum`, `maximum`, or `required` keywords in Avro Schema, and Avro does not support conditional validation.

In a system where data originates as XML or JSON described by a validating XML Schema or JSON Schema, the assumption we make here is that data will be validated using its native schema language first, and then the Avro Schema will be used for transformation or transfer or storage.

## Adding CloudEvents columns for database tables

When converting Avrotize Schema to Kusto Data Table Definition (KQL), SQL Table Definition, or Parquet Schema, the tool can add special columns for [CloudEvents](https://cloudevents.io) attributes. CNCF CloudEvents is a specification for describing event data in a common way.

The rationale for adding such columns to database tables is that messages and events commonly separate event metadata from the payload data, while that information is merged when events are projected into a database. The metadata often carries important context information about the event that is not contained in the payload itself. Therefore, the tool can add those columns to the database tables for easy alignment of the message context with the payload when building event stores.

### Convert Proto schema to Avrotize Schema

```bash
avrotize p2a <path_to_proto_file> [--out <path_to_avro_schema_file>]
```

Parameters:

- `<path_to_proto_file>`: The path to the Protobuf schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- Proto 2 and Proto 3 syntax are supported.
- Proto package names are mapped to Avro namespaces. The tool does resolve imports and consolidates all imported types into a single Avrotize Schema file.
- The tool embeds all 'well-known' Protobuf 3.0 types in Avro format and injects them as needed when the respective types are imported. Only the `Timestamp` type is mapped to the Avro logical type 'timestamp-millis'. The rest of the well-known Protobuf types are kept as Avro record types with the same field names and types.
- Protobuf allows any scalar type as key in a `map`, Avro does not. When converting from Proto to Avro, the type information for the map keys is ignored.
- The field numbers in message types are not mapped to the positions of the fields in Avro records. The fields in Avro are ordered as they appear in the Proto schema. Consequently, the Avrotize Schema also ignores the `extensions` and `reserved` keywords in the Proto schema.
- The `optional` keyword results in an Avro field being nullable (union with the `null` type), while the `required` keyword results in a non-nullable field. The `repeated` keyword results in an Avro field being an array of the field type.
- The `oneof` keyword in Proto is mapped to an Avro union type.
- All `options` in the Proto schema are ignored.

### Convert Avrotize Schema to Proto schema

```bash
avrotize a2p <path_to_avro_schema_file> [--out <path_to_proto_directory>] [--naming <naming_mode>] [--allow-optional]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Protobuf schema directory to write the conversion result to. If omitted, the output is directed to stdout.
- `--naming`: (optional) Type naming convention. Choices are `snake`, `camel`, `pascal`.
- `--allow-optional`: (optional) Enable support for 'optional' fields.

Conversion notes:

- Avro namespaces are resolved into distinct proto package definitions. The tool will create a new `.proto` file with the package definition and an `import` statement for each namespace found in the Avrotize Schema.
- Avro type unions `[]` are converted to `oneof` expressions in Proto. Avro allows for maps and arrays in the type union, whereas Proto only supports scalar types and message type references. The tool will therefore emit message types containing a single array or map field for any such case and add it to the containing type, and will also recursively resolve further unions in the array and map values.
- The sequence of fields in a message follows the sequence of fields in the Avro record. When type unions need to be resolved into `oneof` expressions, the alternative fields need to be assigned field numbers, which will shift the field numbers for any subsequent fields.

### Convert CUE schema subset to Avrotize Schema

```bash
avrotize cue2a <path_to_cue_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]

### Convert FlatBuffers schema to Avrotize Schema

```bash
avrotize fbs2a <path_to_fbs_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]

### Convert Apache Thrift IDL to Avrotize Schema

```bash
avrotize thrift2a <path_to_thrift_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]

### Convert Smithy IDL data shapes to Avrotize Schema

```bash
avrotize smithy2a <path_to_smithy_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]

### Convert Cap'n Proto schema to Avrotize Schema

```bash
avrotize capnp2a <path_to_capnp_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]

### Convert RAML Data Types to Avrotize Schema

```bash
avrotize raml2a <path_to_raml_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_cue_file>`: The path to the CUE file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Namespace for generated Avrotize Schema records. If omitted, a simple CUE `package` name is used as the namespace.

Supported subset / limitations:

- Supported: schema-style definitions `#Name: { ... }`, top-level fields as a generated record, required fields `name: T`, optional fields `name?: T`, primitive types `string`, `int`, `float`, `number`, `bool`, `bytes`, and `null` (`int` maps to Avro `long`; `number` maps to Avro `double`).
- Supported: nested structs as records, open lists `[...T]` as arrays, open structs `{ [string]: T }` as maps, references to other definitions (`#Other`), disjunctions as Avro unions, nullable disjunctions such as `*null | T` or `T | null`, string-literal disjunctions as Avro enums with sanitized symbols, and simple defaults like `name: T | *default`.
- Out of scope: full CUE constraint solving, imports beyond a simple package declaration, complex constraints and comprehensions, computed or unified expressions, bounds and regex constraints (`>0`, `=~"..."`), interpolation, and package/module resolution. Unsupported constructs are skipped or mapped to a broad string type with a conversion note rather than causing a crash.

Example:

```cue
package demo

#Person: {
  name: string
  age?: int
  tags: [...string]
  status: "new" | "active"
}
```

### Convert Avrotize Schema to CUE schema subset

```bash
avrotize a2cue <path_to_avro_schema_file> [--out <path_to_cue_file>] [--namespace <cue_package_hint>]
```

Conversion notes:

- Avro records become CUE definitions (`#Name: { ... }`), fields become `name: Type`, nullable unions become optional fields where possible, enums become string disjunctions, arrays become `[...T]`, and maps become `{ [string]: T }`.
- Avro `int` and `long` both emit as CUE `int`; `float` emits as `float`; `double` emits as `number`. Avro namespaces are reduced to a simple CUE package name using the last namespace segment.
- The converter emits the same practical schema subset accepted by `cue2a`; it does not attempt to reconstruct CUE constraints, imports, comprehensions, or computed expressions.

### Convert CUE schema subset to JSON Structure

```bash
avrotize cue2s <path_to_cue_file> [--out <path_to_structure_file>] [--namespace <namespace>]
```

`cue2s` bridges through an intermediate Avrotize Schema file and therefore uses the same supported CUE subset and limitations as `cue2a`.

### Convert JSON Structure to CUE schema subset

```bash
avrotize s2cue <path_to_structure_file> [--out <path_to_cue_file>] [--namespace <cue_package_hint>]
```

`s2cue` bridges through an intermediate Avrotize Schema file and emits the same practical CUE schema subset as `a2cue`.

- `<path_to_fbs_file>`: The path to the FlatBuffers `.fbs` schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the FlatBuffers namespace for the Avrotize Schema.

Conversion notes and limitations:

- FlatBuffers `namespace` declarations are mapped to Avro namespaces. `table` and `struct` declarations are mapped to Avro records; FlatBuffers structs carry fixed inline layout semantics that Avro does not represent, so this is documented on the generated record.
- FlatBuffers enums are mapped to Avro enums. Integer enum values are preserved in the non-standard Avrotize `ordinals` annotation; consumers that only understand Avro enum symbols may ignore those integer values.
- FlatBuffers unions are mapped to Avro unions of their member record types.
- Scalar mappings: signed 8/16/32-bit integers map to Avro `int`; unsigned 32-bit integers and all 64-bit integers map to Avro `long`; `uint64`/`ulong` values beyond signed 64-bit range cannot be represented exactly by Avro `long`; `float` and `double` map to Avro `float` and `double`; `string` maps to Avro `string`.
- Vectors map to Avro arrays, except `[ubyte]`/`[uint8]`, which maps to Avro `bytes`.
- Table fields without `(required)` are emitted as nullable Avro fields with `null` defaults. FlatBuffers field defaults are preserved as the Avrotize `fbsDefault` annotation for nullable fields.
- `root_type` is preserved as a record-level `root_type` annotation.

### Convert Avrotize Schema to FlatBuffers schema

```bash
avrotize a2fbs <path_to_avro_schema_file> [--out <path_to_fbs_file>] [--namespace <flatbuffers_namespace>]

- `<path_to_thrift_file>`: The path to the Apache Thrift IDL file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the Avro namespace. Without an override, `namespace *` is used, then the first language-specific namespace.

Conversion notes and limitations:

- `struct`, `exception`, and `union` declarations are emitted as Avro records. Thrift unions are modeled as records whose fields are all nullable; Avro does not enforce the Thrift rule that at most one field is set.
- `enum` declarations are emitted as Avro enums. Ordinals are preserved in an `ordinals` annotation. Symbols and names that are not valid Avro names are sanitized.
- `typedef` aliases are resolved to their target type. `const` declarations and `service` definitions are skipped because they do not describe persistent data structures.
- `set<T>` is emitted as an Avro array and does not preserve uniqueness semantics. `map<string,V>` is emitted as an Avro map; maps with non-string keys are emitted as arrays of `{ key, value }` records.
- `include` statements are recorded by the parser but are not recursively resolved by the converter. Convert included IDL files separately or pre-expand them before conversion.

### Convert Avrotize Schema to Apache Thrift IDL

```bash
avrotize a2thrift <path_to_avro_schema_file> [--out <path_to_thrift_file>] [--namespace <thrift_namespace>]

- `<path_to_smithy_file>`: The path to the Smithy 2.0 IDL file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the Smithy `namespace` for the emitted Avro namespace.

Conversion notes:

- Phase 1 supports Smithy data shapes only: `structure`, `union`, `enum`, `intEnum`, `list`, `map`, and scalar shape references. `service`, `operation`, `resource`, HTTP/protocol traits, mixins beyond simple parsing, and `apply` statements are explicitly out of scope and are skipped without failing conversion.
- Smithy `namespace` maps to Avro `namespace`. `@documentation` maps to Avro `doc`; `@required` makes a field non-nullable; non-required fields are nullable and default to `null`; `@default` maps to the Avro field default where Avro permits it. `@deprecated` and `@tags` are carried into `doc` text.
- Smithy `union` shapes are represented as Avro records whose alternatives are nullable fields, preserving member names while keeping the Avro schema valid. Avro field unions convert back to Smithy `union` shapes.
- Smithy `intEnum` converts to an Avro enum with an `ordinals` annotation; Avro itself stores enum symbols, so integer values are metadata for round-tripping.
- Smithy `list` and `map` members map to Avro arrays and maps. Avro maps are string-keyed, so Smithy map keys should be `String`; other key declarations are noted but cannot be represented as Avro map keys.
- Scalar mappings include `Blob`→`bytes`, `Boolean`→`boolean`, `String`→`string`, integer widths→`int`/`long`, floats→`float`/`double`, `Timestamp`→valid Avro `long` with `timestamp-millis`, `BigInteger`→`string`, `BigDecimal`→`double`, and `Document`→`string`.

### Convert Avrotize Schema to Smithy IDL data shapes

```bash
avrotize a2smithy <path_to_avro_schema_file> [--out <path_to_smithy_file>] [--namespace <smithy_namespace>]

- `<path_to_capnp_file>`: The path to the Cap'n Proto `.capnp` schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: Optional Avro namespace. If omitted, the input file name is used.

Conversion notes and limitations:

- Structs map to Avro records, enums map to Avro enums, and field ordinals are stored as `capnpOrdinal` metadata. Enum ordinals are stored as `capnpOrdinals`.
- Cap'n Proto fields are pointer-default/zero-default optional in practice; Avrotize emits nullable Avro fields (`["null", T]`) with `default: null` for non-`Void` fields.
- Primitive mapping: `Bool`→`boolean`; `Int8`/`Int16`/`Int32`→`int`; `Int64`→`long`; unsigned integers including `UInt64`→`long` (range checks are not represented); `Float32`→`float`; `Float64`→`double`; `Text`→`string`; `Data`→`bytes`; `Void`→`null`; `List(T)`→Avro array. No invalid Avro logical types are emitted.
- Anonymous and named Cap'n Proto unions are represented as nullable fields tagged with `capnpUnion` metadata rather than as exclusive Avro unions; exclusivity constraints are not enforced by Avro.
- Groups are represented as inline nested Avro records. Nested structs and enums are emitted as named Avro types in derived nested namespaces.
- The file id is accepted but not used as an Avro namespace seed. `interface`, `const`, `annotation`, imports, and using declarations are skipped.

### Convert Avrotize Schema to Cap'n Proto schema

```bash
avrotize a2capnp <path_to_avro_schema_file> [--out <path_to_capnp_file>] [--namespace <namespace_note>]

- `<path_to_raml_file>`: The path to the RAML 1.0 file or library. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Namespace for generated Avro named types.

Conversion notes:

- Phase 1 supports RAML 1.0 **Data Types** in the `types:` section only. API resources, methods, traits, resourceTypes, securitySchemes, annotations, and external `!include` expansion are explicitly out of scope and are ignored or left as inert YAML values.
- Object types with `properties:` become Avro records. Optional properties (`name?` or `required: false`) become nullable Avro fields with `null` first and default `null`.
- Scalar mappings are `string`→`string`, `number`→`double`, `integer`→`long`, `boolean`→`boolean`, `file`→`bytes`, and `nil`→`null`.
- RAML date/time precision is normalized to valid Avro logical types: `date-only`→`int`/`date`, `time-only`→`int`/`time-millis`, and `datetime-only`/`datetime`→`long`/`timestamp-millis`.
- Arrays use `T[]` or `type: array` with `items`. Unions use `A | B`; nullable `T?` is treated as `nil | T`.
- Maps use the documented RAML convention `properties: { "//": T }` or `additionalProperties: T` and become Avro maps.
- RAML enums become Avro enums; symbols are sanitized to Avro identifiers. Non-string enum base types are emitted as Avro enum symbols, so literal value typing is not preserved.

### Convert Avrotize Schema to RAML Data Types

```bash
avrotize a2raml <path_to_avro_schema_file> [--out <path_to_raml_file>] [--namespace <namespace_to_strip>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the FlatBuffers `.fbs` file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the FlatBuffers namespace.

Conversion notes and limitations:

- Avro records are emitted as FlatBuffers tables, Avro enums as FlatBuffers enums, arrays as vectors, and Avro `bytes` as `[ubyte]`.
- Nullable Avro unions (`["null", T]`) become optional FlatBuffers fields. Multi-branch Avro unions of named types are emitted as FlatBuffers `union` declarations.
- Avro namespaces map to FlatBuffers namespaces. The top record, or the record annotated with `root_type`, is emitted as `root_type`.
- Avro maps, logical types, fixed types, aliases, validation annotations, and arbitrary custom annotations have no direct FlatBuffers equivalent and are either simplified to compatible field types or omitted.

### Convert Avrotize Schema to ASN.1 schema

```bash
avrotize a2asn <path_to_avro_schema_file> [--out <path_to_asn1_file>] [--module <asn1_module_name>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the ASN.1 module file to write the conversion result to. If omitted, the output is directed to stdout. The ASN.1 module name is derived from the output file name when `--module` is not given.
- `--module`: (optional) Override the ASN.1 module name.

Conversion notes and limitations:

- The emitted module uses `DEFINITIONS AUTOMATIC TAGS`, which lets the ASN.1 compiler disambiguate `OPTIONAL` and `CHOICE` tags automatically.
- Avro records map to `SEQUENCE`, Avro enums to `ENUMERATED`, arrays to `SEQUENCE OF`, and `fixed` to `OCTET STRING (SIZE(n))`.
- Avro maps map to `SEQUENCE OF SEQUENCE { key UTF8String, value ... }`.
- Nullable unions (`["null", T]`) become `OPTIONAL` members; multi-branch unions become an ASN.1 `CHOICE`.
- Logical types map to ASN.1 useful types: `date` → `DATE`, `time-millis`/`time-micros` → `TIME-OF-DAY`, `timestamp-*` → `DATE-TIME`; `decimal`, `uuid`, and `duration` are represented as `REAL`/`UTF8String` because ASN.1 has no exact equivalents.
- Identifiers are sanitized to strict X.680 (hyphens instead of underscores); the module is validated by round-tripping through the `asn1tools` compiler.

### Convert JSON Structure Schema to ASN.1 schema

```bash
avrotize s2asn <path_to_structure_schema_file> [--out <path_to_asn1_file>] [--module <asn1_module_name>]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the ASN.1 module file to write the conversion result to. If omitted, the output is directed to stdout. The ASN.1 module name is derived from the output file name when `--module` is not given.
- `--module`: (optional) Override the ASN.1 module name.

Conversion notes and limitations:

- This is a direct JSON Structure → ASN.1 mapping; it does **not** route through Avrotize Schema, so the richer JSON Structure type system is preserved.
- Sized integer types map to `INTEGER` with faithful range constraints (for example `int8` → `INTEGER (-128..127)`, `uint32` → `INTEGER (0..4294967295)`).
- `object` maps to `SEQUENCE`, `array` to `SEQUENCE OF`, `set` to `SET OF`, `map` to `SEQUENCE OF SEQUENCE { key UTF8String, value ... }`, `tuple` to a positional `SEQUENCE`, and `choice` to `CHOICE`.
- String `enum`/`const` values map to `ENUMERATED` (preserving the symbol labels and their ordinals); integer `enum`/`const` values map to an `INTEGER (v1 | v2 | ...)` value constraint (preserving the exact values).
- `$extends` merges the base object's properties into the derived `SEQUENCE`; canonical `{"type": {"$ref": ...}}` references, bare `{"$ref": ...}` references, and nested definition namespaces are all resolved.
- Non-required or nullable members become `OPTIONAL`. Types without an exact ASN.1 equivalent (`uuid`, `uri`, `duration`, `jsonpointer`) are represented as `UTF8String`; `any` maps to the ASN.1 open type `ANY`.

### Convert FlatBuffers schema to JSON Structure

```bash
avrotize fbs2s <path_to_fbs_file> [--out <path_to_json_structure_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_fbs_file>`: The path to the FlatBuffers `.fbs` schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the JSON Structure file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the namespace used by the Avrotize Schema bridge.

Conversion notes:

- This conversion bridges through Avrotize Schema (`fbs2a` followed by `a2s`) and therefore shares the FlatBuffers-to-Avro mapping limitations listed above.
- The FlatBuffers `root_type` record is used as the JSON Structure root when present.

### Convert JSON Structure to FlatBuffers schema

```bash
avrotize s2fbs <path_to_json_structure_file> [--out <path_to_fbs_file>] [--namespace <flatbuffers_namespace>]
```

Parameters:

- `<path_to_json_structure_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the FlatBuffers `.fbs` file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the FlatBuffers namespace.

Conversion notes:

- This conversion bridges through Avrotize Schema (`s2a` followed by `a2fbs`) and therefore shares the Avro-to-FlatBuffers mapping limitations listed above.
- JSON Structure constraints and metadata that do not survive the Avrotize Schema bridge are not represented in the generated FlatBuffers schema.

- `--out`: The path to the Thrift IDL file to write. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the emitted `namespace *` value.

Conversion notes and limitations:

- Avro records are emitted as Thrift `struct` definitions with sequential field ids. Avro enums are emitted as Thrift enums.
- Nullable Avro unions (`["null", T]`) are emitted as `optional` fields; other multi-branch Avro unions are approximated as `string`.
- Avro arrays are emitted as `list<T>` and Avro maps as `map<string,V>`. Thrift `set` and non-string map-key semantics cannot be recovered from Avro.
- Avro logical types and custom annotations are not represented in Thrift IDL.

### Convert Apache Thrift IDL to JSON Structure

```bash
avrotize thrift2s <path_to_thrift_file> [--out <path_to_structure_file>] [--namespace <avro_schema_namespace>]
```

Converts Thrift IDL to JSON Structure by first converting to Avrotize Schema. The Thrift-to-Avro limitations above therefore apply.

### Convert JSON Structure to Apache Thrift IDL

```bash
avrotize s2thrift <path_to_structure_file> [--out <path_to_thrift_file>] [--namespace <thrift_namespace>]
```

Converts JSON Structure to Thrift IDL by first converting to Avrotize Schema. The Avro-to-Thrift limitations above therefore apply.

- `--out`: The path to the Smithy IDL file to write. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Override the Smithy namespace to emit.

Conversion notes:

- Avro records become Smithy `structure` shapes; nullable unions become optional members; non-null fields are emitted with `@required`.
- Avro enums become Smithy `enum` shapes, or `intEnum` when an `ordinals` annotation is present. Avro arrays and maps become Smithy `list` and `map` shapes. Avro unions with multiple non-null alternatives become Smithy `union` shapes.
- Service and operation modeling is explicitly out of phase-1 scope; this command emits Smithy data shapes only.

- `--out`: The path to the Cap'n Proto schema file to write. If omitted, the output is directed to stdout.
- `--namespace`: Optional namespace note included as a comment in the generated file.

Conversion notes and limitations:

- Avro records map to `struct`, enums to `enum`, arrays to `List(T)`, strings to `Text`, bytes/fixed to `Data`, and nullable unions to the non-null Cap'n Proto field type.
- Fields are emitted with deterministic sequential ordinals (`@0`, `@1`, ...). A stable generated file id is emitted; replace it if the schema needs a project-owned Cap'n Proto id.
- Multi-branch Avro unions are emitted as nested choice structs or `union` blocks when `capnpUnion` metadata is present. Avro maps are represented as lists of generated key/value entry structs because Cap'n Proto has no direct map primitive.

### Convert Cap'n Proto schema to JSON Structure

```bash
avrotize capnp2s <path_to_capnp_file> [--out <path_to_json_structure_file>] [--namespace <avro_schema_namespace>] [--naming <naming_mode>] [--avro-encoding]
```

This conversion bridges through an intermediate Avrotize Schema, so the Cap'n Proto limitations documented for `capnp2a` apply.

### Convert JSON Structure to Cap'n Proto schema

```bash
avrotize s2capnp <path_to_json_structure_file> [--out <path_to_capnp_file>] [--namespace <namespace_note>]
```

This conversion bridges through an intermediate Avrotize Schema, so the Avro-to-Cap'n Proto limitations documented for `a2capnp` apply.

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file. If omitted, the file is read from stdin.
- `--out`: The path to the RAML file to write. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Namespace to strip from generated RAML type references.

Conversion notes:

- The converter emits a `#%RAML 1.0 Library` with a `types:` map. Full RAML API resource/method conversion is explicitly out of scope.
- Avro records become RAML `object` types, nullable fields are emitted with the `name?` optional-property form, enums become `enum:`, arrays become `T[]`, maps use `properties: { "//": T }`, and unions become `A | B`.
- Avro logical types map back to RAML `date-only`, `time-only`, or `datetime`. `datetime-only` cannot be distinguished from Avro timestamp logical types on reverse conversion.

### Convert JSON schema to Avrotize Schema

```bash
avrotize j2a <path_to_json_schema_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>] [--split-top-level-records]
```

Parameters:

- `<path_to_json_schema_file>`: The path to the JSON schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) The namespace to use in the Avrotize Schema if the JSON schema does not define a namespace.
- `--split-top-level-records`: (optional) Split top-level records into separate files.

Conversion notes:

- [JSON Schema Handling in Avrotize](jsonschema.md)

### Convert Avrotize Schema to JSON schema

```bash
avrotize a2j <path_to_avro_schema_file> [--out <path_to_json_schema_file>] [--naming <naming_mode>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the JSON schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--naming`: (optional) Type naming convention. Choices are `snake`, `camel`, `pascal`, `default`.

Conversion notes:

- [JSON Schema Handling in Avrotize](jsonschema.md)

### Convert XML Schema (XSD) to Avrotize Schema

```bash
avrotize x2a <path_to_xsd_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_xsd_file>`: The path to the XML schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) The namespace to use in the Avrotize Schema if the XML schema does not define a namespace.

Conversion notes:

- All XML Schema constructs are mapped to Avro record types with fields, whereby **both**, elements and attributes, become fields in the record. XML is therefore flattened into fields and this aspect of the structure is not preserved.
- Avro does not support `xsd:any` as Avro does not support arbitrary typing and must always use a named type. The tool will map `xsd:any` to a field `any` typed as a union that allows scalar values or two levels of array and/or map nesting.
- `simpleType` declarations that define enums are mapped to `enum` types in Avro. All other facets are ignored and simple types are mapped to the corresponding Avro type.
- `complexType` declarations that have simple content where a base type is augmented with attributes is mapped to a record type in Avro. Any other facets defined on the complex type are ignored.
- If the schema defines a single root element, the tool will emit a single Avro record type. If the schema defines multiple root elements, the tool will emit a union of record types, each corresponding to a root element.
- All fields in the resulting Avrotize Schema are annotated with an `xmlkind` extension attribute that indicates whether the field was an `element` or an `attribute` in the XML schema.

### Convert Avrotize Schema to XML schema

```bash
avrotize a2x <path_to_avro_schema_file> [--out <path_to_xsd_schema_file>] [--namespace <target_namespace>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the XML schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Target namespace for the XSD schema.

Conversion notes:

- Avro record types are mapped to XML Schema complex types with elements.
- Avro enum types are mapped to XML Schema simple types with restrictions.
- Avro logical types are mapped to XML Schema simple types with restrictions where required.
- Avro unions are mapped to standalone XSD simple type definitions with a union restriction if all union types are primitives.
- Avro unions with complex types are resolved into distinct types for each option that are

 then joined with a choice.

### Convert JSON Structure to XML Schema (XSD)

```bash
avrotize s2x <path_to_structure_file> [--out <path_to_xsd_schema_file>] [--namespace <target_namespace>]
```

Parameters:

- `<path_to_structure_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the XML schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Target namespace for the XSD schema.

Conversion notes:

- JSON Structure object types are mapped to XML Schema complex types with elements.
- JSON Structure primitive types (string, int8-128, uint8-128, float/double, boolean, etc.) are mapped to appropriate XSD simple types.
- Extended primitive types are mapped as follows:
  - `binary`/`bytes` → `xs:base64Binary`
  - `date` → `xs:date`
  - `time` → `xs:time`
  - `datetime`/`timestamp` → `xs:dateTime`
  - `duration` → `xs:duration`
  - `uuid` → `xs:string`
  - `uri` → `xs:anyURI`
  - `decimal` → `xs:decimal`
- Collection types:
  - `array` and `set` → complex types with sequences of items
  - `map` → complex type with entry elements containing key and value
  - `tuple` → complex type with fixed sequence of typed items
- Union types (`choice` or type arrays like `["string", "null"]`):
  - Tagged unions (with discriminator) → `xs:choice` elements
  - Inline unions → abstract base types with concrete extensions
  - Nullable types → elements with `minOccurs="0"`
- Type references (`$ref`) are resolved to named XSD types
- Type extensions (`$extends`) are mapped to XSD complex type extensions with `xs:complexContent`
- Abstract types are marked with `abstract="true"` in XSD
- Validation constraints (minLength, maxLength, pattern, minimum, maximum) are converted to XSD restrictions/facets
- Required properties become elements with `minOccurs="1"`, optional properties have `minOccurs="0"`

### Convert ASN.1 schema to Avrotize Schema

```bash
avrotize asn2a <path_to_asn1_schema_file>[,<path_to_asn1_schema_file>,...] [--out <path_to_avro_schema_file>]
```

Parameters:

- `<path_to_asn1_schema_file>`: The path to the ASN.1 schema file to be converted. The tool supports multiple files in a comma-separated list. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- All ASN.1 types are mapped to Avro record types, enums, and unions. Avro does not support the same level of nesting of types as ASN.1, the tool will map the types to the best fit.
- The tool will map the following ASN.1 types to Avro types:
  - `SEQUENCE` and `SET` are mapped to Avro record types.
  - `CHOICE` is mapped to an Avro record types with all fields being optional. While the `CHOICE` type technically corresponds to an Avro union, the ASN.1 type has different named fields for each option, which is not a feature of Avro unions.
  - `OBJECT IDENTIFIER` is mapped to an Avro string type.
  - `ENUMERATED` is mapped to an Avro enum type.
  - `SEQUENCE OF` and `SET OF` are mapped to Avro array type.
  - `BIT STRING` is mapped to Avro bytes type.
  - `OCTET STRING` is mapped to Avro bytes type.
  - `INTEGER` is mapped to Avro long type.
  - `REAL` is mapped to Avro double type.
  - `BOOLEAN` is mapped to Avro boolean type.
  - `NULL` is mapped to Avro null type.
  - `UTF8String`, `PrintableString`, `IA5String`, `BMPString`, `NumericString`, `TeletexString`, `VideotexString`, `GraphicString`, `VisibleString`, `GeneralString`, `UniversalString`, `CharacterString`, `T61String` are all mapped to Avro string type.
  - All other ASN.1 types are mapped to Avro string type.
- The ability to parse ASN.1 schema files is limited and the tool may not be able to parse all ASN.1 files. The tool is based on the Python asn1tools package and is limited to that package's capabilities.

### Convert Kusto table definition to Avrotize Schema

```bash
avrotize k2a --kusto-uri <kusto_cluster_uri> --kusto-database <kusto_database> [--out <path_to_avro_schema_file>] [--emit-cloudevents-xregistry]
```

Parameters:

- `--kusto-uri`: The URI of the Kusto cluster to connect to.
- `--kusto-database`: The name of the Kusto database to read the table definitions from.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--emit-cloudevents-xregistry`: (optional) See discussion below.

Conversion notes:

- The tool directly connects to the Kusto cluster and reads the table definitions from the specified database. The tool will convert all tables in the database to Avro record types, returned in a top-level type union.
- Connecting to the Kusto cluster leans on the same authentication mechanisms as the Azure CLI. The tool will use the same authentication context as the Azure CLI if it is installed and authenticated.
- The tool will map the Kusto column types to Avro types as follows:
  - `bool` is mapped to Avro boolean type.
  - `datetime` is mapped to Avro long type with logical type `timestamp-millis`.
  - `decimal` is mapped to a logical Avro type with the `logicalType` set to `decimal` and the `precision` and `scale` set to the values of the `decimal` type in Kusto.
  - `guid` is mapped to Avro string type.
  - `int` is mapped to Avro int type.
  - `long` is mapped to Avro long type.
  - `real` is mapped to Avro double type.
  - `string` is mapped to Avro string type.
  - `timespan` is mapped to a logical Avro type with the `logicalType` set to `duration`.
- For `dynamic` columns, the tool will sample the data in the table to determine the structure of the dynamic column. The tool will map the dynamic column to an Avro record type with fields that correspond to the fields found in the dynamic column. If the dynamic column contains nested dynamic columns, the tool will recursively map those to Avro record types. If records with conflicting structures are found in the dynamic column, the tool will emit a union of record types for the dynamic column.
- If the `--emit-cloudevents-xregistry` option is set, the tool will emit an [xRegistry](http://xregistry.io) registry manifest file with a CloudEvent message definition for each table in the Kusto database and a separate Avro Schema for each table in the embedded schema registry. If one or more tables are found to contain CloudEvent data (as indicated by the presence of the CloudEvents attribute columns), the tool will inspect the content of the `type` (or `__type` or `__type`) columns to determine which CloudEvent types have been stored in the table and will emit a CloudEvent definition and schema for each unique type.

### Convert Kusto table definition to JSON Structure

```bash
avrotize k2s [<path_to_kusto_file>] [--out <path_to_structure_file>] [--kusto-uri <kusto_cluster_uri>] [--kusto-database <kusto_database>] [--table-name <table_name>]
```

The command accepts either a Kusto definition file or a live Kusto cluster and database. It can sample `dynamic` columns to infer nested structures, choices, and enums. Use `--emit-cloudevents` to add CloudEvents declarations or `--emit-xregistry` to emit an xRegistry manifest instead of a single JSON Structure schema.

### Convert SQL database schema to Avrotize Schema

```bash
avrotize sql2a --connection-string <connection_string> [--username <user>] [--password <pass>] [--dialect <dialect>] [--database <database>] [--table-name <table>] [--out <path_to_avro_schema_file>] [--namespace <namespace>] [--infer-json] [--infer-xml] [--sample-size <n>] [--emit-cloudevents] [--emit-xregistry]
```

Parameters:

- `--connection-string`: The database connection string. Supports SSL/TLS and integrated authentication options (see examples below).
- `--username`: (optional) Database username. Overrides any username in the connection string. Use this to avoid credentials in command history.
- `--password`: (optional) Database password. Overrides any password in the connection string. Use this to avoid credentials in command history.
- `--dialect`: (optional) The SQL dialect: `postgres` (default), `mysql`, `sqlserver`, `oracle`, or `sqlite`.
- `--database`: (optional) The database name if not specified in the connection string.
- `--table-name`: (optional) A specific table to convert. If omitted, all tables are converted.
- `--out`: The path to the Avrotize Schema file. If omitted, output goes to stdout.
- `--namespace`: (optional) The Avro namespace for the generated schema.
- `--infer-json`: (optional, default: true) Infer schema for JSON/JSONB columns by sampling data.
- `--infer-xml`: (optional, default: true) Infer schema for XML columns by sampling data.
- `--sample-size`: (optional, default: 100) Number of rows to sample for JSON/XML schema inference.
- `--emit-cloudevents`: (optional) Detect CloudEvents tables and emit CloudEvents declarations.
- `--emit-xregistry`: (optional) Emit an xRegistry manifest instead of a single schema file.

Connection string examples:

```bash
# PostgreSQL with separate credentials (preferred for security)
avrotize sql2a --connection-string "postgresql://host:5432/mydb?sslmode=require" --username myuser --password mypass --out schema.avsc

# PostgreSQL with SSL (credentials in URL)
avrotize sql2a --connection-string "postgresql://user:pass@host:5432/mydb?sslmode=require" --out schema.avsc

# MySQL with SSL
avrotize sql2a --connection-string "mysql://user:pass@host:3306/mydb?ssl=true" --dialect mysql --out schema.avsc

# SQL Server with Windows Authentication (omit user/password)
avrotize sql2a --connection-string "mssql://@host:1433/mydb" --dialect sqlserver --out schema.avsc

# SQL Server with TLS encryption
avrotize sql2a --connection-string "mssql://user:pass@host:1433/mydb?encrypt=true" --dialect sqlserver --out schema.avsc

# SQLite file
avrotize sql2a --connection-string "/path/to/database.db" --dialect sqlite --out schema.avsc
```

Conversion notes:

- The tool connects to a live database and reads the schema from the information schema or system catalogs.
- Type mappings for each dialect:
  - **PostgreSQL**: All standard types including `uuid`, `jsonb`, `xml`, arrays, and custom types.
  - **MySQL**: Standard types including `json`, `enum`, `set`, and spatial types.
  - **SQL Server**: Standard types including `uniqueidentifier`, `xml`, `money`, and `hierarchyid`.
  - **Oracle**: Standard types including `number`, `clob`, `blob`, and Oracle-specific types.
  - **SQLite**: Dynamic typing mapped based on declared type affinity.
- For JSON/JSONB columns (PostgreSQL, MySQL) and XML columns, the tool samples data to infer the structure. Fields that appear in some but not all records are folded together. If field types conflict across records, the tool emits a union of record types.
- For columns with keys that cannot be valid Avro identifiers (UUIDs, URLs, special characters), the tool generates `map<string, T>` types instead of record types.
- Table and column comments are preserved as Avro `doc` attributes where available.
- Primary key columns are noted in the schema's `unique` attribute.

### Convert SurrealQL Schema to Avrotize Schema

```bash
avrotize surreal2a <path_to_surrealql_schema_file> [--out <path_to_avro_schema_file>] [--namespace <namespace>]
```

Parameters:

- `<path_to_surrealql_schema_file>`: The SurrealQL schema file containing `DEFINE TABLE` and `DEFINE FIELD` statements.
- `--out`: The path to the Avrotize Schema file. If omitted, output goes to stdout.
- `--namespace`: (optional) The Avro namespace for generated records.

Conversion notes:

- `DEFINE TABLE <name> SCHEMAFULL|SCHEMALESS` becomes an Avro record named `<name>`.
- Dotted SurrealDB field paths such as `address.city` become nested Avro records; array item paths such as `phones[*].number` become arrays of nested records.
- SurrealDB scalar types map as follows: `string` -> Avro `string`, `int` -> `long`, `float`/`number` -> `double`, `bool` -> `boolean`, `bytes` -> `bytes`, `datetime` -> `long` with `timestamp-millis`, `uuid` -> `string` with `uuid`, and `decimal` -> `bytes` with Avro `decimal` (`precision` 38, `scale` 9).
- `option<T>` becomes a nullable Avro union `['null', T]` with default `null`.
- `array<T>` and `set<T>` become Avro arrays. Avro has no native set semantics, so uniqueness is not represented.
- `duration` and `geometry` are represented as strings.
- `record<T>` references are represented as string record ids because Avro record references model embedded schemas, not SurrealDB record id links.


### Infer Avro schema from JSON files

```bash
avrotize json2a <json_files...> [--out <path>] [--type-name <name>] [--namespace <namespace>] [--sample-size <n>] [--infer-choices] [--choice-depth <n>]
```

Parameters:

- `<json_files...>`: One or more JSON files to analyze. Supports JSON arrays, single objects, and JSONL (JSON Lines) format. Use `@filelist.txt` to read file paths from a response file.
- `--out`: The path to the Avro schema file. If omitted, output goes to stdout.
- `--type-name`: (optional) Name for the root type (default: "Document").
- `--namespace`: (optional) Avro namespace for generated types.
- `--sample-size`: (optional) Maximum number of records to sample (0 = all, default: 0).
- `--infer-choices`: (optional) Detect discriminated unions and emit as Avro unions with discriminator field defaults.
- `--choice-depth`: (optional) Maximum nesting depth for choice inference (1 = root only, 2+ = nested objects, default: 1).

Example:

```bash
# Infer schema from multiple JSON files
avrotize json2a data1.json data2.json --out schema.avsc --type-name Event --namespace com.example

# Infer schema from JSONL file with discriminated union detection
avrotize json2a events.jsonl --out events.avsc --type-name LogEntry --infer-choices

# Use response file for many input files
avrotize json2a @file_list.txt --out schema.avsc --infer-choices --choice-depth 2
```

### Infer JSON Structure schema from JSON files

```bash
avrotize json2s <json_files...> [--out <path>] [--type-name <name>] [--base-id <uri>] [--sample-size <n>] [--infer-choices] [--choice-depth <n>] [--infer-enums]
```

Parameters:

- `<json_files...>`: One or more JSON files to analyze. Use `@filelist.txt` to read file paths from a response file.
- `--out`: The path to the JSON Structure schema file. If omitted, output goes to stdout.
- `--type-name`: (optional) Name for the root type (default: "Document").
- `--base-id`: (optional) Base URI for $id generation (default: "https://example.com/").
- `--sample-size`: (optional) Maximum number of records to sample (0 = all, default: 0).
- `--infer-choices`: (optional) Detect discriminated unions and emit as `choice` types with discriminator field defaults.
- `--choice-depth`: (optional) Maximum nesting depth for choice inference (1 = root only, 2+ = nested objects, default: 1).
- `--infer-enums`: (optional) Detect enum types from repeated string values with low cardinality.

The inferrer also automatically detects:
- **Datetime patterns**: ISO 8601 timestamps, dates, and times are typed as `datetime`, `date`, or `time`.
- **Required vs optional fields**: Fields present in all records are marked required; sparse fields are optional.

Example:

```bash
# Basic inference
avrotize json2s data.json --out schema.jstruct.json --type-name Person --base-id https://myapi.example.com/schemas/

# Full inference with choices and enums
avrotize json2s events/*.json --out events.jstruct.json --type-name Event --infer-choices --choice-depth 2 --infer-enums

# Process many files via response file
avrotize json2s @file_list.txt --out schema.jstruct.json --infer-choices --infer-enums
```

### Infer Avro schema from XML files

```bash
avrotize xml2a <xml_files...> [--out <path>] [--type-name <name>] [--namespace <namespace>] [--sample-size <n>]
```

Parameters:

- `<xml_files...>`: One or more XML files to analyze. Use `@filelist.txt` to read file paths from a response file.
- `--out`: The path to the Avro schema file. If omitted, output goes to stdout.
- `--type-name`: (optional) Name for the root type (default: "Document").
- `--namespace`: (optional) Avro namespace for generated types.
- `--sample-size`: (optional) Maximum number of documents to sample (0 = all, default: 0).

Example:

```bash
avrotize xml2a config.xml --out config.avsc --type-name Configuration --namespace com.example.config
```

### Infer JSON Structure schema from XML files

```bash
avrotize xml2s <xml_files...> [--out <path>] [--type-name <name>] [--base-id <uri>] [--sample-size <n>]
```

Parameters:

- `<xml_files...>`: One or more XML files to analyze. Use `@filelist.txt` to read file paths from a response file.
- `--out`: The path to the JSON Structure schema file. If omitted, output goes to stdout.
- `--type-name`: (optional) Name for the root type (default: "Document").
- `--base-id`: (optional) Base URI for $id generation (default: "https://example.com/").
- `--sample-size`: (optional) Maximum number of documents to sample (0 = all, default: 0).

Conversion notes (applies to all inference commands):

- XML attributes are converted to fields prefixed with `@` (normalized to valid identifiers).
- Text content in mixed-content elements becomes a `#text` field.
- Repeated elements are inferred as arrays.
- Multiple files with different structures are merged into a unified schema.
- Sparse data (fields that appear in some but not all records) is folded into a single type.

### Convert Avrotize Schema to Kusto table declaration

```bash
avrotize a2k <path_to_avro_schema_file> [--out <path_to_kusto_kql_file>] [--record-type <record_type>] [--emit-cloudevents-columns] [--emit-cloudevents-dispatch]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Kusto KQL file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Avro record type to convert to a Kusto table.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the table: `___id`, `___source`, `___subject`, `___type`, and `___time`.
- `--emit-cloudevents-dispatch`: (optional) If set, the tool will add a table named `_cloudevents_dispatch` to the script or database, which serves as an ingestion and dispatch table for CloudEvents. The table has columns for the core CloudEvents attributes and a `data` column that holds the CloudEvents data. For each table in the Avrotize Schema, the tool will create an update policy that maps events whose `type` attribute matches the Avro type name to the respective table.

Conversion notes:

- Only the Avro `record` type can be mapped to a Kusto table. If the Avrotize Schema contains other types (like `enum` or `array`), the tool will ignore them.
- Only the first `record` type in the Avrotize Schema is converted to a Kusto table. If the Avrotize Schema contains other `record` types, they will be ignored. The `--record-type` option can be used to specify which `record` type to convert.
- The fields of the record are mapped to columns in the Kusto table. Fields that are records or arrays or maps are mapped to columns of type `dynamic` in the Kusto table.

### Convert JSON Structure Schema to Kusto table declaration

```bash
avrotize s2k <path_to_structure_schema_file> [--out <path_to_kusto_kql_file>] [--record-type <record_type>] [--emit-cloudevents-columns] [--emit-cloudevents-dispatch]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Kusto KQL file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the record type to convert to a Kusto table.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the table: `___id`, `___source`, `___subject`, `___type`, and `___time`.
- `--emit-cloudevents-dispatch`: (optional) If set, the tool will add a table named `_cloudevents_dispatch` to the script or database, which serves as an ingestion and dispatch table for CloudEvents. The table has columns for the core CloudEvents attributes and a `data` column that holds the CloudEvents data. For each table in the JSON Structure Schema, the tool will create an update policy that maps events whose `type` attribute matches the type name to the respective table.

Conversion notes:

- Only JSON Structure `object` types can be mapped to a Kusto table. Other types (like `enum`, `array`, `choice`) are not directly convertible to tables.
- The tool converts the first `object` type found in the schema, or uses the type specified with `--record-type`.
- Object properties are mapped to columns in the Kusto table. Complex types (objects, arrays, maps, sets, tuples, choices) are mapped to columns of type `dynamic`.
- JSON Structure primitive types are mapped to appropriate Kusto scalar types:
  - `string`, `uri`, `jsonpointer` → `string`
  - `boolean` → `bool`
  - `integer`, `int8`, `uint8`, `int16`, `uint16`, `int32` → `int`
  - `uint32`, `int64`, `uint64` → `long`
  - `int128`, `uint128`, `decimal` → `decimal`
  - `number`, `float`, `double`, `float8`, `binary32`, `binary64` → `real`
  - `date`, `datetime`, `timestamp` → `datetime`
  - `time`, `duration` → `timespan`
  - `uuid` → `guid`
  - `binary` → `dynamic`

### Convert Avrotize Schema to Tabular Model Scripting Language (TMSL)

```bash
avrotize a2tsml <path_to_avro_schema_file> [--out <path_to_tmsl_file>] [--record-type <record_type>] [--database-name <database_name>] [--compatibility-level <level>] [--emit-cloudevents-columns]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to convert. If omitted, the file is read from stdin.
- `--out`: The path to the TMSL JSON file. If omitted, the output is directed to stdout.
- `--record-type`: (optional) Select a record by its simple or fully qualified name. If omitted, all top-level records are emitted as tables.
- `--database-name`: (optional) Set the tabular model database name. The first selected record name is used by default.
- `--compatibility-level`: (optional) Set the tabular model compatibility level. The default is `1605`.
- `--emit-cloudevents-columns`: (optional) Add nullable `___type`, `___source`, `___id`, `___time`, and `___subject` columns to each table.

Conversion notes:

- Each top-level Avro record becomes a TMSL table and each field becomes a column.
- Avro `unique` metadata marks matching TMSL columns as keys. Avro `foreignKeys` metadata becomes TMSL model relationships when the referenced records are present.
- Primitive numeric, Boolean, string, binary, decimal, and temporal types map to their corresponding TMSL data types. Records, arrays, maps, and general unions map to `variant`.
- The result is a TMSL `createOrReplace` command containing the database and model definition. It defines the semantic model structure but does not create data-source partitions or load data.

### Convert JSON Structure to Tabular Model Scripting Language (TMSL)

```bash
avrotize s2tsml <path_to_structure_schema_file> [--out <path_to_tmsl_file>] [--record-type <record_type>] [--database-name <database_name>] [--compatibility-level <level>] [--emit-cloudevents-columns]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to convert. If omitted, the file is read from stdin.
- `--out`: The path to the TMSL JSON file. If omitted, the output is directed to stdout.
- `--record-type`: (optional) Select the object type to emit. If omitted, all converted top-level records are emitted as tables.
- `--database-name`: (optional) Set the tabular model database name. The first selected type name is used by default.
- `--compatibility-level`: (optional) Set the tabular model compatibility level. The default is `1605`.
- `--emit-cloudevents-columns`: (optional) Add nullable `___type`, `___source`, `___id`, `___time`, and `___subject` columns to each table.

Conversion notes:

- The converter first maps JSON Structure to Avrotize Schema and then applies the same table, column, key, relationship, and type mappings as `a2tsml`.
- JSON Structure features without direct tabular equivalents, including nested objects, collections, and choices, are represented as `variant` columns.
- The result is a TMSL `createOrReplace` command containing the database and model definition. It defines the semantic model structure but does not create data-source partitions or load data.

### Convert Avrotize Schema to SQL Schema

```bash
avrotize a2sql [input] --out <path_to_sql_script> --dialect <dialect>
```

Parameters:

- `input`: The path to the Avrotize schema file to be converted (or read from stdin if omitted).
- `--out`: The path to the SQL script file to write the conversion result to.
- `--dialect`: The SQL dialect (database type) to target. Supported dialects include:
  - `mysql`, `mariadb`, `postgres`, `sqlserver`, `oracle`, `sqlite`, `bigquery`, `snowflake`, `redshift`, `db2`
- `--emit-cloudevents-columns`: (Optional) Add CloudEvents columns to the SQL table.

For detailed conversion rules and type mappings for each SQL dialect, refer to the [SQL Conversion Notes](sqlcodegen.md) document.

### Convert Avrotize Schema to SurrealQL Schema

```bash
avrotize a2surreal <path_to_avro_schema_file> [--out <path_to_surrealql_schema_file>] [--record-type <record_type>]
```

Parameters:

- `<path_to_avro_schema_file>`: The Avrotize Schema file to convert.
- `--out`: The path to the SurrealQL schema file. If omitted, output goes to stdout.
- `--record-type`: (optional) Convert only the named Avro record.

Conversion notes:

- Each Avro record becomes `DEFINE TABLE <name> SCHEMAFULL`.
- Nested Avro records are emitted as dotted SurrealDB field paths.
- Avro arrays become `array<T>`; arrays of records are emitted with `[*]` item field definitions.
- Nullable Avro unions of `null` plus one type become `option<T>`.
- Avro `timestamp-millis`, `uuid`, and `decimal` logical types become `datetime`, `uuid`, and `decimal` respectively.

### Convert JSON Structure Schema to SQL Schema

```bash
avrotize s2sql [input] --out <path_to_sql_script> --dialect <dialect> [--emit-cloudevents-columns]
```

Parameters:

- `input`: The path to the JSON Structure schema file to be converted (or read from stdin if omitted).
- `--out`: The path to the SQL script file to write the conversion result to.
- `--dialect`: The SQL dialect (database type) to target. Supported dialects include:
  - `mysql`, `mariadb`, `postgres`, `sqlserver`, `oracle`, `sqlite`, `bigquery`, `snowflake`, `redshift`, `db2`
- `--emit-cloudevents-columns`: (Optional) Add CloudEvents columns to the SQL table.

Conversion notes:

- The tool converts JSON Structure schemas to SQL DDL statements for various database dialects.
- JSON Structure primitive types (string, int8-128, uint8-128, float, double, decimal, binary, date, datetime, uuid, etc.) are mapped to appropriate SQL types for each dialect.
- Compound types (array, set, map, object, choice, tuple) are typically mapped to JSON/JSONB columns or equivalent in the target database.
- Required properties from the JSON Structure schema become non-nullable columns and are used for primary keys.
- The `namespace` and `name` properties from the JSON Structure schema are used to construct table names.
- Type annotations like `maxLength`, `precision`, and `scale` are preserved in column comments.

For detailed conversion rules and type mappings for each SQL dialect when converting from JSON Structure, refer to the [SQL Conversion Notes](sqlcodegen.md) document.

### Convert Avrotize Schema to MongoDB schema

```bash
avrotize a2mongo <path_to_avro_schema_file> [--out <path_to_mongodb_schema>] [--emit-cloudevents-columns]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the MongoDB schema file to write the conversion result to.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the MongoDB schema.

Conversion notes:

- The fields of the Avro record type are mapped to fields in the MongoDB schema. Fields that are records or arrays or maps are mapped to fields of type `object`.
- The emitted MongoDB schema file is a JSON file that can be used with MongoDB's `mongoimport` tool to create a collection with the specified schema.

Here are the "Convert ..." sections for the newly added commands:

### Convert Avrotize schema to Cassandra schema

```bash
avrotize a2cassandra [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the Cassandra schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the Cassandra schema (optional, default: false).

Refer to the detailed conversion notes for Cassandra in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert JSON Structure Schema to Cassandra Schema

```bash
avrotize s2cassandra [input] --out <output_file> [--emit-cloudevents-columns]
```

Parameters:

- `input`: Path to the JSON Structure schema file (or read from stdin if omitted).
- `--out`: Output path for the Cassandra CQL schema file (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the Cassandra schema (optional, default: false).

Conversion notes:

- The tool converts JSON Structure schemas to Cassandra CQL DDL statements.
- JSON Structure primitive types are mapped to appropriate Cassandra types (int32 → int, string → text, uuid → uuid, etc.).
- Required properties are used to construct the PRIMARY KEY for the table.
- Complex types (array, map, object) are stored as text columns in Cassandra.

Refer to the detailed conversion notes for Cassandra in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to DynamoDB schema

```bash
avrotize a2dynamodb [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the DynamoDB schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the DynamoDB schema (optional, default: false).

Refer to the detailed conversion notes for DynamoDB in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to Elasticsearch schema

```bash
avrotize a2es [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the Elasticsearch schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the Elasticsearch schema (optional, default: false).

Refer to the detailed conversion notes for Elasticsearch in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to CouchDB schema

```bash
avrotize a2couchdb [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the CouchDB schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the CouchDB schema (optional, default: false).

Refer to the detailed conversion notes for CouchDB in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to Neo4j schema

```bash
avrotize a2neo4j [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the Neo4j schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the Neo4j schema (optional, default: false).

Refer to the detailed conversion notes for Neo4j in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to Firebase schema

```bash
avrotize a2firebase [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the Firebase schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the Firebase schema (optional, default: false).

Refer to the detailed conversion notes for Firebase in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to CosmosDB schema

```bash
avrotize a2cosmos [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the CosmosDB schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the CosmosDB schema (optional, default: false).

Refer to the detailed conversion notes for CosmosDB in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize schema to HBase schema

```bash
avrotize a2hbase [input] --out <output_directory> [--emit-cloudevents-columns]
```

- `input`: Path to the Avrotize schema file (or read from stdin if omitted).
- `--out`: Output path for the HBase schema (required).
- `--emit-cloudevents-columns`: Add CloudEvents columns to the HBase schema (optional, default: false).

Refer to the detailed conversion notes for HBase in the [NoSQL Conversion Notes](nosqlcodegen.md).

### Convert Avrotize Schema to empty Parquet file

```bash
avrotize a2pq <path_to_avro_schema_file> [--out <path_to_parquet_schema_file>] [--record-type <record-type-from-avro>] [--emit-cloudevents-columns]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Parquet schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Avro record type to convert to a Parquet schema.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the Parquet schema: `__id`, `__source`, `__subject`, `__type`, and `__time`.

Conversion notes:

- The emitted Parquet file contains only the schema, no data rows.
- The tool only supports writing Parquet files for Avrotize Schema that describe a single `record` type. If the Avrotize Schema contains a top-level union, the `--record-type` option must be used to specify which record type to emit.
- The fields of the record are mapped to columns in the Parquet file. Array and record fields are mapped to Parquet nested types. Avro type unions are mapped to structures, not to Parquet unions since those are not supported by the PyArrow library used here.

### Convert Avrotize Schema to Iceberg schema

```bash
avrotize a2ib <path_to_avro_schema_file> [--out <path_to_iceberg_schema_file>] [--record-type <record-type-from-avro>] [--emit-cloudevents-columns] [--format schema|arrow]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Iceberg schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Avro record type to convert to an Iceberg schema.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the Iceberg schema: `__id`, `__source`, `__subject`, `__type`, and `__time`.
- `--format`: (optional) Output format. `schema` (default) outputs JSON per the [Iceberg Table Spec Appendix C](https://iceberg.apache.org/spec/#appendix-c-json-serialization). `arrow` outputs a binary Arrow IPC serialized schema.

Conversion notes:

- The emitted Iceberg file contains only the schema, no data rows.
- The tool only supports writing Iceberg files for Avrotize Schema that describe a single `record` type. If the Avrotize Schema contains a top-level union, the `--record-type` option must be used to specify which record type to emit.
- The fields of the record are mapped to columns in the Iceberg file. Array and record fields are mapped to Iceberg nested types. Avro type unions are mapped to structures, not to Iceberg unions since those are not supported by the PyArrow library used here.

### Convert JSON Structure to Iceberg schema

```bash
avrotize s2ib <path_to_structure_schema_file> [--out <path_to_iceberg_schema_file>] [--record-type <record-type-from-structure>] [--emit-cloudevents-columns] [--format schema|arrow]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Iceberg schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the record type in definitions to convert to an Iceberg schema.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the Iceberg schema: `___id`, `___source`, `___subject`, `___type`, and `___time`.
- `--format`: (optional) Output format. `schema` (default) outputs JSON per the [Iceberg Table Spec Appendix C](https://iceberg.apache.org/spec/#appendix-c-json-serialization). `arrow` outputs a binary Arrow IPC serialized schema.

Conversion notes:

- The emitted Iceberg file contains only the schema, no data rows.
- The tool supports JSON Structure schemas with `type: "object"` at the top level. If the schema contains a `$ref` or the record type is in definitions, the `--record-type` option can be used to specify which type to emit.
- JSON Structure types are mapped to Iceberg types as follows:
  - **Primitive types**: `string` → StringType, `boolean` → BooleanType, numeric types (int8-128, uint8-128, float, double) → appropriate IntegerType/LongType/FloatType/DoubleType
  - **Extended types**: `binary`/`bytes` → BinaryType, `date` → DateType, `time` → TimeType, `datetime`/`timestamp` → TimestampType, `duration` → LongType (microseconds), `decimal` → DecimalType (with precision/scale), `uuid`/`uri`/`jsonpointer` → StringType
  - **Compound types**: `object` → StructType, `array`/`set` → ListType, `map` → MapType, `tuple` → StructType with indexed fields
  - **Choice types**: Mapped to StructType with alternative fields (Iceberg doesn't have native union support)
- Type annotations such as `precision`, `scale`, and validation constraints are preserved where applicable.
- The `$extends` feature is supported - base type properties are included in the conversion.
- Required and optional properties are handled via Iceberg's `required` field flag.

### Convert JSON Structure to empty Parquet file

```bash
avrotize s2pq <path_to_structure_schema_file> [--out <path_to_parquet_file>] [--record-type <record-type-from-structure>] [--emit-cloudevents-columns] [--format parquet|schema]
```

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Parquet file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the record type in `definitions` to convert to a Parquet schema.
- `--emit-cloudevents-columns`: (optional) If set, the tool will add [CloudEvents](https://cloudevents.io) attribute columns to the Parquet schema: `___id`, `___source`, `___subject`, `___type`, and `___time`.
- `--format`: (optional) Output format. `parquet` (default) writes an empty Parquet file whose footer carries the schema. `schema` writes the derived schema as JSON for inspection.

Notes:

- The emitted Parquet file contains only the schema, no data rows.
- The tool supports JSON Structure schemas with `type: "object"` at the top level. If the schema contains a `$ref` or the record type is in `definitions`, the `--record-type` option can be used to specify which type to emit.
- JSON Structure types are mapped to Parquet (PyArrow) types as follows:
  - **Primitive types**: `string` → string, `boolean` → bool, sized integer types (`int8`…`int64`, `uint8`…`uint64`) → the matching PyArrow integer type, `float`/`float32` → float32, `double`/`float64` → float64, `decimal` → decimal128 honoring `precision`/`scale`, `bytes`/`binary` → binary, `uuid`/`uri`/`jsonpointer` → string.
  - **Temporal types**: `date` → date32, `time` → time64[us], `datetime`/`timestamp` → timestamp[us], `duration` → int64 (microseconds).
  - **Compound types**: `object` → struct, `array`/`set` → list, `map` → map, `tuple` → struct with indexed fields. A property-less (open) `object` becomes `map<string, string>`.
  - **Choice types**: Mapped to a struct of optional alternatives (Parquet has no native union type).
- The `$extends` feature is supported - base type properties are included in the conversion.
- Required properties are emitted as non-nullable columns; all others are nullable.

### Convert JSON Type Definition (JTD) to Avrotize Schema

```bash
avrotize jtd2a <path_to_jtd_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_jtd_file>`: The path to the JSON Type Definition file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Namespace for generated Avro records and enums.

Conversion notes:

- JTD `type` forms map to Avro primitives; `timestamp` is encoded as Avro `long` with `logicalType: "timestamp-millis"`.
- JTD `enum` symbols are sanitized to Avro names when needed. The original JTD symbols are retained in `jtdEnumSymbols` metadata for round trips.
- JTD `properties` become required Avro record fields. `optionalProperties` become nullable Avro fields with `default: null`.
- JTD `elements` and `values` map to Avro arrays and maps. `definitions`/`ref` map to named Avro types.
- JTD `discriminator`/`mapping` maps to an Avro union of records. Each branch carries the discriminator as a single-symbol enum field plus `jtdDiscriminator`/`jtdMappingKey` metadata for round trips.
- Avro has no direct equivalent for JTD `additionalProperties`; the setting is preserved as `jtdAdditionalProperties` metadata but is not enforced by Avro.

### Convert Avrotize Schema to JSON Type Definition (JTD)

```bash
avrotize a2jtd <path_to_avro_schema_file> [--out <path_to_jtd_file>] [--record-type <record-type-from-avro>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the JSON Type Definition file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Avro record type to use as the JTD root when the file contains multiple named types.

Conversion notes:

- Avro primitives map to the closest JTD `type`; converter metadata such as `jtdType` is used to restore narrower JTD integer and float forms when present.
- Avro `long` with `logicalType: "timestamp-millis"` maps to JTD `timestamp`.
- Nullable Avro unions map to `nullable: true`; nullable fields with `default: null` map to JTD `optionalProperties`.
- General Avro unions do not have a native JTD equivalent. Only discriminator unions emitted by `jtd2a` round-trip to JTD `discriminator`/`mapping`; other unions are retained as metadata.

### Convert JSON Type Definition (JTD) to JSON Structure

```bash
avrotize jtd2s <path_to_jtd_file> [--out <path_to_structure_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_jtd_file>`: The path to the JSON Type Definition file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the JSON Structure file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) Namespace for generated intermediate Avro records and enums.

Conversion notes:

- The conversion bridges through Avrotize Schema, so the JTD-to-Avro limitations also apply.

### Convert JSON Structure to JSON Type Definition (JTD)

```bash
avrotize s2jtd <path_to_structure_file> [--out <path_to_jtd_file>] [--record-type <record-type-from-structure>]
```

Parameters:

- `<path_to_structure_file>`: The path to the JSON Structure file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the JSON Type Definition file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Structure/Avro record type to use as the JTD root.

Conversion notes:

- The conversion bridges through Avrotize Schema, so JSON Structure features without JTD equivalents may be simplified or emitted as metadata.

### Convert Parquet schema to Avrotize Schema

```bash
avrotize pq2a <path_to_parquet_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_parquet_file>`: The path to the Parquet file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) The namespace to use in the Avrotize Schema if the Parquet file does not define a namespace.

Conversion notes:

- The tool reads the schema from the Parquet file and converts it to Avrotize Schema. The data in the Parquet file is not read or converted.
- The fields of the Parquet schema are mapped to fields in the Avrotize Schema. Nested fields are mapped to nested records in the Avrotize Schema.

### Convert CSV file to Avrotize Schema

```bash
avrotize csv2a <path_to_csv_file> [--out <path_to_avro_schema_file>] [--namespace <avro_schema_namespace>]
```

Parameters:

- `<path_to_csv_file>`: The path to the CSV file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Avrotize Schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--namespace`: (optional) The namespace to use in the Avrotize Schema if the CSV file does not define a namespace.

Conversion notes:

- The tool reads the CSV file and converts it to Avrotize Schema. The first row of the CSV file is assumed to be the header row, containing the field names.
- The fields of the CSV file are mapped to fields in the Avrotize Schema. The tool infers the types of the fields from the data in the CSV file.

### Convert Kafka Connect Schema to Avrotize Schema

```bash
avrotize kstruct2a [input] --out <path_to_avro_schema_file>
```

Parameters:

- `input`: The path to the Kafka Struct file to be converted (or read from stdin if omitted).
- `--out`: The path to the Avrotize Schema file to write the conversion result to.
- `--kstruct`: Deprecated: The path to the Kafka Struct file (for backward compatibility).

Conversion notes:

- The tool converts the Kafka Struct definition to an Avrotize Schema, mapping Kafka data types to their Avro equivalents.
- Kafka Structs are typically used to define data structures for Kafka Connect and other Kafka-based applications. This command facilitates interoperability by enabling the conversion of these definitions into Avro, which can be further used with various serialization and schema registry tools.

### Convert Avrotize Schema to C# classes

```bash
avrotize a2cs <path_to_avro_schema_file> [--out <path_to_csharp_dir>] [--namespace <csharp_namespace>] [--avro-annotation] [--system_text_json_annotation] [--newtonsoft-json-annotation] [--pascal-properties] [--target-framework <tfm>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the C# classes to. Required.
- `--namespace`: (optional) The namespace to use in the C# classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--system_text_json_annotation`: (optional) Use System.Text.Json annotations.
- `--newtonsoft-json-annotation`: (optional) Use Newtonsoft.Json annotations.
- `--pascal-properties`: (optional) Use PascalCase properties.
- `--target-framework`: (optional) Target framework(s) for the generated `.csproj` (e.g. `net8.0`, or `net8.0;net10.0` for multi-targeting). Defaults to `net10.0`.

Conversion notes:

- The tool generates C# classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a C# class.
- The fields of the record are mapped to properties in the C# class. Nested records are mapped to nested classes in the C# class.
- The tool supports adding annotations to the properties in the C# class. The `--avro-annotation` option adds Avro annotations, the `--system_text_json_annotation` option adds System.Text.Json annotations, and the `--newtonsoft-json-annotation` option adds Newtonsoft.Json annotations.
- The `--pascal-properties` option changes the naming convention of the properties to PascalCase.

### Convert Avrotize Schema to Java classes

```bash
avrotize a2java <path_to_avro_schema_file> [--out <path_to_java_dir>] [--package <java_package>] [--avro-annotation] [--jackson-annotation] [--pascal-properties]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Java classes to. Required.
- `--package`: (optional) The package to use in the Java classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--jackson-annotation`: (optional) Use Jackson annotations.
- `--pascal-properties`: (optional) Use PascalCase properties.

Conversion notes:

- The tool generates Java classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Java class.
- The fields of the record are mapped to properties in the Java class. Nested records are mapped to nested classes in the Java class.
- The tool supports adding annotations to the properties in the Java class. The `--avro-annotation` option adds Avro annotations, and the `--jackson-annotation` option adds Jackson annotations.
- The `--pascal-properties` option changes the naming convention of the properties to PascalCase.

### Convert Avrotize Schema to Python classes

```bash
avrotize a2py <path_to_avro_schema_file> [--out <path_to_python_dir>] [--package <python_package>] [--dataclasses-json-annotation] [--avro-annotation]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Python classes to. Required.
- `--package`: (optional) The package to use in the Python classes.
- `--dataclasses-json-annotation`: (optional) Use dataclasses-json annotations.
- `--avro-annotation`: (optional) Use Avro annotations.

Conversion notes:

- The tool generates Python classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Python class.
- The fields of the record are mapped to properties in the Python class. Nested records are mapped to nested classes in the Python class.
- The tool supports adding annotations to the properties in the Python class. The `--dataclasses-json-annotation` option adds dataclasses-json annotations, and the `--avro-annotation` option adds Avro annotations.

### Convert Avrotize Schema to TypeScript classes

```bash
avrotize a2ts <path_to_avro_schema_file> [--out <path_to_typescript_dir>] [--package <typescript_package>] [--avro-annotation] [--typedjson-annotation]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the TypeScript classes to. Required.
- `--package`: (optional) The package to use in the TypeScript classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--typedjson-annotation`: (optional) Use TypedJSON annotations.

Conversion notes:

- The tool generates TypeScript classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a TypeScript class.
- The fields of the record are mapped to properties in the TypeScript class. Nested records are mapped to nested classes in the TypeScript class.
- TypeScript contextual keywords such as `type`, `namespace`, `module`, and `readonly` are preserved when used as field names.
- The tool supports adding annotations to the properties in the TypeScript class. The `--avro-annotation` option adds Avro annotations, and the `--typedjson-annotation` option adds TypedJSON annotations.

### Convert JSON Structure to TypeScript classes

```bash
avrotize s2ts <path_to_structure_schema_file> [--out <path_to_typescript_dir>] [--package <typescript_package>] [--typedjson-annotation] [--avro-annotation]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the TypeScript classes to. Required.
- `--package`: (optional) The TypeScript package name for the generated project.
- `--typedjson-annotation`: (optional) Use TypedJSON annotations for JSON serialization support.
- `--avro-annotation`: (optional) Add Avro binary serialization support with embedded Structure schema.

Conversion notes:

- The tool generates TypeScript classes from JSON Structure schema. Each object type in the JSON Structure schema is converted to a TypeScript class.
- Supports all JSON Structure Core types including:
  - **Primitive types**: string, number, boolean, null
  - **Extended types**: binary, int8-128, uint8-128, float8/float/double, decimal, date, datetime, time, duration, uuid, uri, jsonpointer
  - **Compound types**: object, array, set, map, tuple, any, choice (unions)
- JSON Structure features are supported:
  - **$ref references**: Type references are resolved and generated as separate classes
  - **$extends inheritance**: Base class properties are included in derived classes
  - **$offers/$uses add-ins**: Add-in properties are merged into classes that use them
  - **Abstract types**: Marked with `abstract` keyword in TypeScript
  - **Required/optional properties**: Required properties are non-nullable, optional properties are nullable
  - **Choice types**: Converted to TypeScript union types
- The generated project includes:
  - TypeScript source files in `src/` directory
  - `package.json` with dependencies
  - `tsconfig.json` for TypeScript compilation
  - `.gitignore` file
  - `index.ts` for exporting all generated types
- The TypeScript code can be compiled using `npm run build` (requires `npm install` first)
- For more details on JSON Structure handling, see [jsonstructure.md](jsonstructure.md)

### Convert Avrotize Schema to JavaScript classes

```bash
avrotize a2js <path_to_avro_schema_file> [--out <path_to_javascript_dir>] [--package <javascript_package>] [--avro-annotation]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the JavaScript classes to. Required.
- `--package`: (optional) The package to use in the JavaScript classes.
- `--avro-annotation`: (optional) Use Avro annotations.

Conversion notes:

- The tool generates JavaScript classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a JavaScript class.
- The fields of the record are mapped to properties in the JavaScript class. Nested records are mapped to nested classes in the JavaScript class.
- The tool supports adding annotations to the properties in the JavaScript class. The `--avro-annotation` option adds Avro annotations.

### Convert Avrotize Schema to C++ classes

```bash
avrotize a2cpp <path_to_avro_schema_file> [--out <path_to_cpp_dir>] [--namespace <cpp_namespace>] [--avro-annotation] [--json-annotation]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the C++ classes to. Required.
- `--namespace`: (optional) The namespace to use in the C++ classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--json-annotation`: (optional) Use JSON annotations.
- `--xml-annotation`: (optional) Use `encoding/xml` tags and XML serialization.

Conversion notes:

- The tool generates C++ classes from the Avrotize Schema. Each record type in the Av

rotize Schema is converted to a C++ class.

- The fields of the record are mapped to properties in the C++ class. Nested records are mapped to nested classes in the C++ class.
- The tool supports adding annotations to the properties in the C++ class. The `--avro-annotation` option adds Avro annotations, the `--json-annotation` option adds JSON annotations, and the `--xml-annotation` option adds XML annotations.

### Convert Avrotize Schema to Go classes

```bash
avrotize a2go <path_to_avro_schema_file> [--out <path_to_go_dir>] [--package <go_package>] [--avro-annotation] [--json-annotation] [--xml-annotation] [--package-site <go_package_site>] [--package-username <go_package_username>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Go classes to. Required.
- `--package`: (optional) The package to use in the Go classes.
- `--package-site`: (optional) The package site to use in the Go classes.
- `--package-username`: (optional) The package username to use in the Go classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--json-annotation`: (optional) Use JSON annotations.

Conversion notes:

- The tool generates Go classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Go class.
- The fields of the record are mapped to properties in the Go class. Nested records are mapped to nested classes in the Go class.
- The tool supports adding annotations to the properties in the Go class. The `--avro-annotation` option adds Avro annotations, and the `--json-annotation` option adds JSON annotations.

### Convert Avrotize Schema to Rust classes

```bash
avrotize a2rust <path_to_avro_schema_file> [--out <path_to_rust_dir>] [--package <rust_package>] [--avro-annotation] [--serde-annotation]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Rust classes to. Required.
- `--package`: (optional) The package to use in the Rust classes.
- `--avro-annotation`: (optional) Use Avro annotations.
- `--serde-annotation`: (optional) Use Serde annotations.

Conversion notes:

- The tool generates Rust classes from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Rust class.
- The fields of the record are mapped to properties in the Rust class. Nested records are mapped to nested classes in the Rust class.
- The tool supports adding annotations to the properties in the Rust class. The `--avro-annotation` option adds Avro annotations, and the `--serde-annotation` option adds Serde annotations.

### Convert JSON Structure to C++ classes

```bash
avrotize s2cpp <path_to_structure_file> --out <path_to_cpp_dir> [--namespace <cpp_namespace>] [--json-annotation]
```

Parameters:

- `<path_to_structure_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the C++ classes to. Required.
- `--namespace`: (optional) The namespace to use in the C++ classes.
- `--json-annotation`: (optional) Include JSON serialization support (default: true).

Conversion notes:

- The tool generates C++ classes from JSON Structure schemas. Each object type in the JSON Structure schema is converted to a C++ class.
- The fields of the object are mapped to properties in the C++ class. Nested objects are mapped to nested classes.
- The tool supports all JSON Structure Core types including primitives (string, number, boolean), extended types (int8-128, uint8-128, float, double, decimal, binary, date, datetime, time, duration, uuid, uri), and compound types (object, array, set, map, tuple, choice).
- JSON Structure-specific features are supported including $ref type references, namespaces, definitions, and container type aliases.
- The generated code includes CMake build files and vcpkg dependency management for easy integration.

### Convert JSON Structure to Rust classes

```bash
avrotize s2rust <path_to_structure_schema_file> [--out <path_to_rust_dir>] [--package <rust_package>] [--json-annotation]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Rust classes to. Required.
- `--package`: (optional) The package name to use in the Rust classes.
- `--json-annotation`: (optional) Use Serde JSON annotations for serialization support.

Conversion notes:

- The tool generates Rust structs and enums from JSON Structure schemas. Each object type in the JSON Structure schema is converted to a Rust struct.
- The fields of objects are mapped to struct fields with appropriate Rust types. Nested objects are mapped to nested structs.
- All JSON Structure Core types are supported:
  - **Primitive types**: string, number, boolean, null
  - **Extended types**: binary, int8-128, uint8-128, float8/float/double, decimal, date, datetime, time, duration, uuid, uri, jsonpointer
  - **Compound types**: object, array, set, map, tuple, any, choice (discriminated unions)
- JSON Structure-specific features are supported:
  - Namespaces and definitions
  - Type references ($ref)
  - Required and optional properties
  - Abstract types
  - Extensions ($extends)
- The `--json-annotation` option adds Serde derive macros for JSON serialization and deserialization.
- Generated code includes embedded unit tests that verify struct creation and serialization (when annotations are enabled).

### Convert JSON Structure to Go classes

```bash
avrotize s2go <path_to_structure_file> --out <path_to_go_dir> [--package <go_package>] [--json-annotation] [--avro-annotation] [--xml-annotation] [--package-site <package_site>] [--package-username <username>]
```

Parameters:

- `<path_to_structure_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Go structs to. Required.
- `--package`: (optional) The package name to use in the Go code.
- `--json-annotation`: (optional) Add JSON struct tags for encoding/json.
- `--xml-annotation`: (optional) Add `encoding/xml` tags and XML serialization.
- `--avro-annotation`: (optional) Add Avro struct tags.
- `--package-site`: (optional) The package site for the Go module (e.g., github.com).
- `--package-username`: (optional) The username/organization for the Go module.

Conversion notes:

- The tool generates Go structs from JSON Structure schemas. Each object type is converted to a Go struct.
- JSON Structure primitive types are mapped to Go types. Extended types like `date`, `time`, `datetime` are mapped to time.Time.
- Integer types (int8, int16, int32, int64, uint8, etc.) are mapped to corresponding Go integer types.
- Choice types are generated as interface{} types for flexibility.
- The tool generates a complete Go module with go.mod file, struct definitions, helper functions, and unit tests.
- Generated code includes methods for JSON serialization/deserialization when annotations are enabled.

### Convert JSON Structure to Java classes

```bash
avrotize s2java <path_to_structure_schema_file> [--out <path_to_java_dir>] [--package <java_package>] [--jackson-annotation] [--pascal-properties]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the Java classes to. Required.
- `--package`: (optional) The Java package name for the generated classes.
- `--jackson-annotation`: (optional) Use Jackson annotations for JSON serialization (default: true).
- `--pascal-properties`: (optional) Use PascalCase for property names.

Conversion notes:

- The tool generates Java classes from JSON Structure schemas. Each object type is converted to a Java class with getter/setter methods.
- JSON Structure primitive types are mapped to Java types. Extended types like `date`, `time`, `datetime` are mapped to `LocalDate`, `LocalTime`, `Instant`.
- Integer types (int8-int64, uint8-uint64) are mapped to corresponding Java types. `uint64` uses `BigInteger` for full range support.
- Choice types (discriminated unions) use Jackson polymorphism with `@JsonTypeInfo` and `@JsonSubTypes` annotations.
- Tuple types serialize as JSON arrays using `@JsonFormat(shape = Shape.ARRAY)`.
- The tool generates a complete Maven project with pom.xml including Jackson dependencies.
- Generated classes include `equals()` and `hashCode()` implementations.

### Convert JSON Structure to JavaScript classes

```bash
avrotize s2js <path_to_structure_schema_file> [--out <path_to_js_dir>] [--package <package_name>] [--avro-annotation]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the directory to write the JavaScript classes to. Required.
- `--package`: (optional) The package name for the generated classes.
- `--avro-annotation`: (optional) Add Avro binary serialization support.

Conversion notes:

- The tool generates JavaScript ES6 classes from JSON Structure schemas with full type support.
- JSON Structure primitive types are mapped to JavaScript types. Extended types like `date`, `time`, `datetime` are handled as Date objects or strings.
- Integer types are mapped to JavaScript Number or BigInt depending on size.
- Choice types are generated as union type classes with factory methods.
- Tuple types are generated as arrays with fixed length.
- The tool generates a complete npm package with package.json.
- Generated classes include serialization/deserialization methods and optional Avro support when enabled.

### Convert Avrotize Schema to Datapackage schema

```bash
avrotize a2dp <path_to_avro_schema_file> [--out <path_to_datapackage_file>] [--record-type <record-type-from-avro>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Datapackage schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the Avro record type to convert to a Datapackage schema.

Conversion notes:

- The tool generates a Datapackage schema from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Datapackage resource.
- The fields of the record are mapped to fields in the Datapackage resource. Nested records are mapped to nested resources in the Datapackage.

### Convert JSON Structure schema to Datapackage schema

```bash
avrotize s2dp <path_to_structure_schema_file> [--out <path_to_datapackage_file>] [--record-type <record-type-from-structure>]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Datapackage schema file to write the conversion result to. If omitted, the output is directed to stdout.
- `--record-type`: (optional) The name of the JSON Structure record type to convert to a Datapackage schema.

Conversion notes:

- The tool generates a Datapackage schema from the JSON Structure schema. Each object type in the JSON Structure schema is converted to a Datapackage resource.
- The properties of the object are mapped to fields in the Datapackage resource schema.
- All JSON Structure Core types are supported, including:
  - JSON primitive types (string, number, boolean, null)
  - Extended primitive types (int8-128, uint8-128, float/double, decimal, binary, date, datetime, time, duration, uuid, uri, jsonpointer)
  - Compound types (object, array, set, map, tuple, choice/union)
- JSON Structure-specific features are preserved:
  - Namespaces are used to organize resources
  - Type references ($ref) are resolved
  - Type annotations (maxLength, minLength, pattern, minimum, maximum, enum) are converted to Data Package field constraints
  - Union types (nullable fields) are properly handled

### Convert Avrotize Schema to Markdown documentation

```bash
avrotize a2md <path_to_avro_schema_file> [--out <path_to_markdown_file>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Markdown file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- The tool generates Markdown documentation from the Avrotize Schema. Each record type in the Avrotize Schema is converted to a Markdown section.
- The fields of the record are documented in a table in the Markdown section. Nested records are documented in nested sections in the Markdown file.

### Convert JSON Structure schema to Markdown documentation

```bash
avrotize s2md <path_to_structure_schema_file> [--out <path_to_markdown_file>]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Markdown file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- The tool generates Markdown documentation from JSON Structure Core schemas following the patterns established by the Avrotize Schema to Markdown converter.
- Supports all JSON Structure Core types including:
  - **JSON Primitive Types**: string, number, boolean, null
  - **Extended Primitive Types**: binary, int8-128, uint8-128, float8/float/double, decimal, date, datetime, time, duration, uuid, uri, jsonpointer
  - **Compound Types**: object, array, set, map, tuple, any, choice (both tagged and inline unions)
- Supports JSON Structure Core features:
  - Namespaces and definitions are documented in separate sections
  - Type references ($ref) are converted to Markdown links
  - Extensions ($extends) and abstract types are clearly marked
  - Required/optional properties are indicated
- Extended features (when present in schemas):
  - Validation constraints (minLength, maxLength, minimum, maximum, pattern, etc.) are documented alongside properties
  - Type-specific annotations (precision, scale for decimals, minItems/maxItems for arrays, etc.)
- Each object type in the schema is converted to a Markdown section with its properties documented in a structured list format.
- Choice types (unions) are documented with their selector (if present) and available choices.
- The definitions section documents all reusable type definitions.

### Convert JSON Structure to CSV Schema

```bash
avrotize s2csv <path_to_structure_schema_file> [--out <path_to_csv_schema_file>]
```

Parameters:

- `<path_to_structure_schema_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the CSV schema file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- The tool converts JSON Structure schemas to CSV Schema format.
- All JSON Structure Core types are supported including primitives (string, number, boolean, null, integer), extended types (int8-128, uint8-128, float/double, decimal, date, datetime, time, duration, uuid, uri, binary), and compound types (object, array, set, map, tuple, choice).
- Compound types (arrays, objects, maps) are represented as strings in CSV schema, as CSV format doesn't have native support for complex nested structures.
- Required/optional properties are preserved with the `nullable` flag.
- Validation constraints (maxLength, minLength, pattern, minimum, maximum, precision, scale) are preserved in the CSV schema.
- Enum and const keywords are supported and preserved in the output.
- JSON Structure-specific features like `$ref`, `$extends`, definitions, and namespaces are resolved during conversion.

### Convert Avrotize Schema to CSV Schema

```bash
avrotize a2csv <path_to_avro_schema_file> [--out <path_to_csv_schema_file>]
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the CSV schema file to write the conversion result to. If omitted, the output is directed to stdout.

Conversion notes:

- The tool converts Avrotize schemas to CSV Schema format.
- Avro primitive types (string, int, long, float, double, boolean, bytes) are mapped to appropriate CSV schema types.
- Avro logical types (date, timestamp-millis, decimal, uuid) are preserved in the output.
- Complex types (records, arrays, maps) are represented as strings in CSV schema, as CSV format doesn't have native support for nested structures.
- Only single record types can be converted to CSV schema.


### Convert RAML Data Types to JSON Structure

```bash
avrotize raml2s <path_to_raml_file> [--out <path_to_json_structure_file>] [--namespace <avro_schema_namespace>]
```

Converts RAML 1.0 Data Types to JSON Structure by bridging through Avrotize Schema. The same RAML phase-1 limitations apply: only inline `types:` data types are in scope; API resources, methods, traits, resourceTypes, securitySchemes, annotations, and external `!include` expansion are out of scope.

### Convert JSON Structure to RAML Data Types

```bash
avrotize s2raml <path_to_json_structure_file> [--out <path_to_raml_file>] [--namespace <namespace_to_strip>]
```

Converts JSON Structure to a RAML 1.0 Library by bridging through Avrotize Schema. The output contains RAML Data Types only and does not generate API resources or methods.

### Convert JSON Structure to Protocol Buffers

```bash
avrotize s2p <path_to_json_structure_file> --out <path_to_proto_directory> [--naming-mode <naming_mode>] [--allow-optional]
```

Parameters:

- `<path_to_json_structure_file>`: The path to the JSON Structure schema file to be converted. If omitted, the file is read from stdin.
- `--out`: The path to the Protocol Buffers schema directory to write the conversion result to. This parameter is required as proto files need to be written to a directory.
- `--naming-mode`: (optional) Type naming convention. Choices are `snake`, `camel`, `pascal`. Default is `pascal`.
- `--allow-optional`: (optional) Enable support for 'optional' keyword for nullable fields (proto3).

Conversion notes:

- The tool converts JSON Structure schemas directly to Protocol Buffers `.proto` files without going through Avrotize Schema.
- JSON Structure primitive types (string, number, boolean, null) and extended types (int8-128, uint8-128, float32/64, decimal, date, datetime, time, duration, uuid, uri) are mapped to appropriate Protocol Buffers types.
- Compound types (object, array, set, map, tuple, choice) are converted to Protocol Buffers messages, repeated fields, map fields, and oneof constructs.
- JSON Structure namespaces are resolved into distinct proto package definitions.
- Type references (`$ref`) are resolved and converted to appropriate message types.
- Choice types (unions) are converted to Protocol Buffers `oneof` constructs.
- Abstract types and extensions (`$extends`) are handled by generating appropriate message hierarchies.


### Convert Smithy IDL data shapes to JSON Structure

```bash
avrotize smithy2s <path_to_smithy_file> [--out <path_to_json_structure_file>] [--namespace <avro_schema_namespace>]
```

This command converts Smithy 2.0 IDL data shapes to JSON Structure by bridging through Avrotize Schema. It has the same Smithy phase-1 scope and limitations as `smithy2a`: service, operation, resource, and protocol modeling are out of scope and skipped.

### Convert JSON Structure to Smithy IDL data shapes

```bash
avrotize s2smithy <path_to_json_structure_file> [--out <path_to_smithy_file>] [--namespace <smithy_namespace>]
```

This command converts JSON Structure to Smithy 2.0 IDL data shapes by bridging through Avrotize Schema. It emits data shapes only; Smithy service and operation modeling is explicitly out of scope for phase 1.

### Convert OpenAPI to JSON Structure

```bash
avrotize oas2s <path_to_openapi_file> --out <path_to_json_structure_file> [--namespace <namespace>] [--preserve-composition] [--detect-discriminators] [--lift-inline-schemas]
```

Parameters:

- `<path_to_openapi_file>`: The path to the OpenAPI 3.x document (JSON or YAML). If omitted, the file is read from stdin.
- `--out`: The path to the JSON Structure schema file to write the conversion result to. If omitted, the result is written to stdout.
- `--namespace`: (optional) Namespace for the JSON Structure schema.
- `--preserve-composition`: (optional) Preserve composition keywords (allOf, oneOf, anyOf). Default is `true`.
- `--detect-discriminators`: (optional) Detect OpenAPI discriminator patterns and convert to choice types. Default is `true`.
- `--lift-inline-schemas`: (optional) Lift inline schemas from paths/operations to named definitions. Default is `false`.

Conversion notes:

- The tool extracts schema definitions from `components.schemas` in the OpenAPI document and converts them to JSON Structure format.
- OpenAPI-specific keywords are handled as follows:
  - `nullable`: Converted to type union with `null`
  - `readOnly`, `writeOnly`, `deprecated`: Mapped to metadata annotations
  - `discriminator`: Used to create choice types with proper discriminator mapping
- OpenAPI `$ref` references (e.g., `#/components/schemas/Pet`) are converted to JSON Structure references (`#/definitions/Pet`).
- All JSON Schema features supported by the JSON Schema converter are preserved, including:
  - Object structures with properties and required fields
  - Enumerations
  - Numeric and string constraints (minimum, maximum, minLength, maxLength, pattern)
  - Array and set types (with uniqueItems)
  - Map types (from additionalProperties)
  - Composition (allOf, oneOf, anyOf)

Example:

```bash
# Convert an OpenAPI document to JSON Structure
avrotize oas2s petstore.yaml --out petstore.struct.json

# With namespace and inline schema lifting
avrotize oas2s api.json --out api.struct.json --namespace com.example.api --lift-inline-schemas
```

### Create the Parsing Canonical Form (PCF) of an Avrotize schema

```bash
avrotize pcf <path_to_avro_schema_file>
```

Parameters:

- `<path_to_avro_schema_file>`: The path to the Avrotize Schema file to be converted. If omitted, the file is read from stdin.

Conversion notes:

- The tool generates the Parsing Canonical Form (PCF) of the Avrotize Schema. The PCF is a normalized form of the schema that is used for schema comparison and compatibility checking.
- The PCF is a JSON object that is written to stdout.

### Validate JSON instances against schemas

```bash
avrotize validate <json_files...> --schema <schema_file> [--schema-type <type>] [--quiet]
```

Parameters:

- `<json_files...>`: One or more JSON files to validate. Supports single JSON objects, JSON arrays, and JSONL (newline-delimited JSON) formats.
- `--schema <schema_file>`: Path to the schema file (`.avsc` for Avro, `.jstruct.json` for JSON Structure).
- `--schema-type`: (optional) Schema type: `avro` or `jstruct`. Auto-detected from file extension if omitted.
- `--quiet`: (optional) Suppress output. Exit code 0 if all instances are valid, 1 if any are invalid.

Validation notes:

- Validates JSON instances against Avro schemas per the [Avrotize Schema specification](specs/avrotize-schema.md).
- Supports all Avro primitive types: null, boolean, int, long, float, double, bytes, string.
- Supports all Avro complex types: record, enum, array, map, fixed.
- Supports logical types with both native and string encodings: decimal, uuid, date, time-millis, time-micros, timestamp-millis, timestamp-micros, duration.
- Supports field `altnames` for JSON field name mapping.
- Supports enum `altsymbols` for JSON symbol mapping.
- For JSON Structure validation, requires the `json-structure` package.

Example:

```bash
# Validate JSON file against Avro schema
avrotize validate data.json --schema schema.avsc

# Validate multiple files
avrotize validate file1.json file2.json --schema schema.avsc

# Validate JSONL file against JSON Structure schema
avrotize validate events.jsonl --schema events.jstruct.json

# Quiet mode for CI/CD pipelines (exit code only)
avrotize validate data.json --schema schema.avsc --quiet
```

### Validate TMSL scripts locally

```bash
avrotize validate-tmsl [input] [--quiet]
```

Parameters:

- `[input]`: Path to the TMSL JSON file. If omitted, the file is read from stdin.
- `--quiet`: (optional) Suppress output. Exit code 0 if valid, 1 if invalid.

Validation notes:

- Performs local structural validation aligned with Microsoft TMSL object definitions for compatibility level 1200+.
- Validates `createOrReplace` command payload shape for the database/model/table/column path.
- Enforces documented column `dataType` enum values (`automatic`, `string`, `int64`, `double`, `dateTime`, `decimal`, `boolean`, `binary`, `unknown`, `variant`).
- Enforces strict object property checks (`additionalProperties: false`) for the validated subset.
- This is not a semantic engine validation; semantic checks still require execution against an XMLA endpoint.

Example:

```bash
# Validate a generated TMSL file
avrotize validate-tmsl model.tmsl.json

# CI mode with exit code only
avrotize validate-tmsl model.tmsl.json --quiet
```

### Convert JSON Structure schema to GraphQL schema

```bash
avrotize s2graphql [input] --out <path_to_graphql_schema_file>
```

Parameters:

- `[input]`: The path to the JSON Structure schema file. If omitted, the file is read from stdin.
- `--out <path_to_graphql_schema_file>`: The path to the output GraphQL schema file.

Conversion notes:

- Converts JSON Structure Core schema to GraphQL schema language (SDL)
- Supports all JSON Structure Core primitive types (string, number, boolean, null)
- Supports extended primitives (binary, int8-128, uint8-128, float/double, decimal, date, datetime, time, duration, uuid, uri, jsonpointer)
- Supports compound types (object, array, set, map, tuple, any, choice)
- Resolves type references ($ref) and maintains proper dependency ordering
- Maps JSON Structure namespaces to GraphQL types with simple names
- Generates custom scalars for specialized types (Date, DateTime, UUID, URI, Decimal, Binary, JSON)
- Required properties are marked with `!` in GraphQL
- Arrays and sets are represented as GraphQL lists `[Type]`
- Maps are represented using the JSON scalar type

Example:

```bash
# Convert a JSON Structure schema to GraphQL
avrotize s2graphql myschema.struct.json --out myschema.graphql

# Read from stdin and write to stdout
cat myschema.struct.json | avrotize s2graphql > myschema.graphql
```

### Convert Avrotize schema to GraphQL schema

```bash
avrotize a2graphql [input] --out <path_to_graphql_schema_file>
```

Parameters:

- `[input]`: The path to the Avrotize schema file. If omitted, the file is read from stdin.
- `--out <path_to_graphql_schema_file>`: The path to the output GraphQL schema file.

Conversion notes:

- Converts Avrotize schema to GraphQL schema language (SDL)
- Avro primitive types (string, int, long, float, double, boolean, bytes) are mapped to GraphQL scalar types
- Avro logical types (date, timestamp-millis, decimal, uuid) are mapped to custom GraphQL scalars
- Avro record types become GraphQL object types
- Avro arrays become GraphQL lists `[Type]`
- Avro maps are represented using the JSON scalar type
- Avro unions are converted to GraphQL union types
- Avro enums become GraphQL enum types

Example:

```bash
# Convert an Avrotize schema to GraphQL
avrotize a2graphql myschema.avsc --out myschema.graphql

# Read from stdin and write to stdout
cat myschema.avsc | avrotize a2graphql > myschema.graphql
```

## Reference documentation

In addition to the command reference above, the repository includes in-depth companion documents for specific formats and features:

**Schema model & specifications**

- [Avrotize Schema — formal specification](specs/avrotize-schema.md) — the Apache Avro-derived schema model used as the tool's intermediate representation.
- [Apache Avro Schema — formal specification](specs/avro-schema.md) — reference for the underlying Avro schema format.

**JSON Schema & JSON Structure**

- [JSON Schema handling](jsonschema.md) — how Avrotize interprets and converts JSON Schema documents.
- [JSON Structure handling](jsonstructure.md) — JSON Structure support and mappings.
- [JSON Schema → JSON Structure conversion](jsonschematostructure.md) — conversion rules from JSON Schema to JSON Structure.
- [JSON Structure → JSON Schema conversion](structuretojsonschema.md) — conversion rules from JSON Structure back to JSON Schema.

**Avro encodings & other data formats**

- ["Plain JSON" encoding for Apache Avro](avrojson.md) — the plain-JSON encoding used by Avrotize.
- [CDDL handling](cddl.md) — CDDL (RFC 8610) to JSON Structure conversion (`cddl2s`).

**Code generation**

- [C# code generation](csharpcodegen.md) — C# type mappings and emitted-code options.
- [Java code generation](javacodegen.md) — Java type mappings and emitted-code options.

**SQL & NoSQL databases**

- [SQL conversion notes](sqlcodegen.md) — Avro → SQL type mappings for each supported dialect (`a2sql`).
- [SQL → Avro type mappings](sql.md) — type mappings used when converting live SQL schemas to Avro (`sql2a`).
- [NoSQL conversion notes](nosqlcodegen.md) — type mappings for Cassandra, DynamoDB, MongoDB, and other NoSQL targets.

**MCP server**

- [VS Code + Copilot MCP quickstart](copilot-vscode-mcp-quickstart.md) — using the Avrotize MCP server from GitHub Copilot in VS Code.

**Project governance and contribution**

- [Contributing](CONTRIBUTING.md) — the short path for reports, ideas, and pull requests.
- [Support](SUPPORT.md) — where to ask and what to expect from best-effort participation.
- [Security](SECURITY.md) — private vulnerability reporting.
- [Governance](GOVERNANCE.md) — detailed maintainer authority, compatibility, review, and release policy.

This document provides an overview of the usage and functionality of Avrotize. For more detailed information, please refer to the [Avrotize Schema documentation](specs/avrotize-schema.md) and the individual command help messages.
