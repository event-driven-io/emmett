# JSON Structure SDKs

Official SDKs for validating JSON documents against [JSON Structure](https://json-structure.org) schemas.

JSON Structure is a type-oriented schema language for JSON, designed for defining data structures
that can be validated and mapped to programming language types.

## Available SDKs

| Language | Package | Status |
|----------|---------|--------|
| [Python](./python/) | [`json-structure`](https://pypi.org/project/json-structure/) | ✅ Available |
| [.NET](./dotnet/) | [`JsonStructure`](https://www.nuget.org/packages/JsonStructure) | ✅ Available |
| [Java](./java/) | [`json-structure`](https://central.sonatype.com/artifact/org.json-structure/json-structure) | ✅ Available |
| [TypeScript/JavaScript](./typescript/) | [`@json-structure/sdk`](https://www.npmjs.com/package/@json-structure/sdk) | ✅ Available |
| [Go](./go/) | [`github.com/json-structure/sdk/go`](https://pkg.go.dev/github.com/json-structure/sdk/go) | ✅ Available |
| [Rust](./rust/) | [`json-structure`](https://crates.io/crates/json-structure) | ✅ Available |
| [Perl](./perl/) | `JSON::Structure` | ✅ Available |
| [Swift](./swift/) | `JSONStructure` | ✅ Available |
| [C](./c/) | `json-structure` | ✅ Available |
| [PHP](./php/) | [`json-structure/sdk`](https://packagist.org/packages/json-structure/sdk) | ✅ Available |
| [Ruby](./ruby/) | `jsonstructure` | ✅ Available |
| [R](./r/) | `jsonstructure` | ✅ Available |

## Features

All SDKs provide:

- **Schema Validation**: Validate JSON Structure schema documents for correctness
- **Instance Validation**: Validate JSON instances against JSON Structure schemas
- **Full Type Support**: All 34 primitive and compound types from JSON Structure Core v0
- **Extensions**: Support for validation addins, conditional composition, and imports

## CLI Tool (`jstruct`)

A standalone command-line validator for quick schema and instance checks—no SDK wiring required.

### Pre-built Binaries

Download from [GitHub Releases](https://github.com/json-structure/sdk/releases):

| Platform | Architecture | File |
|----------|--------------|------|
| Linux | x86_64 | `jstruct-x86_64-unknown-linux-gnu.tar.gz` |
| Linux | ARM64 | `jstruct-aarch64-unknown-linux-gnu.tar.gz` |
| macOS | Intel | `jstruct-x86_64-apple-darwin.tar.gz` |
| macOS | Apple Silicon | `jstruct-aarch64-apple-darwin.tar.gz` |
| Windows | x86_64 | `jstruct-x86_64-pc-windows-msvc.zip` |
| Windows | ARM64 | `jstruct-aarch64-pc-windows-msvc.zip` |

> **Note:** The binaries are **not code-signed**. On Windows you may need to click *"Run anyway"* in SmartScreen; on macOS run `xattr -d com.apple.quarantine jstruct` after extracting.

### Build from Source (Cargo)

If you have Rust installed:

```bash
cargo install json-structure --features cli
```

### Usage

```bash
# Validate schema files
jstruct check schema.struct.json another.struct.json

# Validate instances against a schema (quiet—exit code only)
jstruct validate -q -s schema.struct.json data/*.json
```

See [rust/CLI.md](./rust/CLI.md) for the full command reference.

## Quick Start

### Python

```bash
pip install json-structure
```

```python
from json_structure import InstanceValidator, SchemaValidator

# Validate a schema
schema = {
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}

schema_validator = SchemaValidator()
schema_errors = schema_validator.validate(schema)

# Validate an instance
instance = {"name": "Alice", "age": 30}
instance_validator = InstanceValidator(schema)
instance_errors = instance_validator.validate_instance(instance)
```

### .NET

```bash
dotnet add package JsonStructure
```

```csharp
using JsonStructure.Validation;
using System.Text.Json.Nodes;

// Validate a schema
var schema = JsonNode.Parse("""
{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}
""");

var schemaValidator = new SchemaValidator();
var schemaResult = schemaValidator.Validate(schema);

// Validate an instance
var instance = JsonNode.Parse("""{"name": "Alice", "age": 30}""");
var instanceValidator = new InstanceValidator();
var instanceResult = instanceValidator.Validate(instance, schema);
```

### Java

```xml
<dependency>
    <groupId>org.json-structure</groupId>
    <artifactId>json-structure</artifactId>
    <version>0.1.0</version>
</dependency>
```

```java
import org.json_structure.validation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

ObjectMapper mapper = new ObjectMapper();

// Validate a schema
JsonNode schema = mapper.readTree("""
{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}
""");

SchemaValidator schemaValidator = new SchemaValidator();
ValidationResult schemaResult = schemaValidator.validate(schema);

// Validate an instance
JsonNode instance = mapper.readTree("{\"name\": \"Alice\", \"age\": 30}");
InstanceValidator instanceValidator = new InstanceValidator();
ValidationResult instanceResult = instanceValidator.validate(instance, schema);
```

### TypeScript/JavaScript

```bash
npm install @json-structure/sdk
```

```typescript
import { SchemaValidator, InstanceValidator } from '@json-structure/sdk';

// Validate a schema
const schema = {
  $schema: 'https://json-structure.org/meta/core/v0/#',
  name: 'Person',
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'int32' }
  }
};

const schemaValidator = new SchemaValidator();
const schemaResult = schemaValidator.validate(schema);

// Validate an instance
const instance = { name: 'Alice', age: 30 };
const instanceValidator = new InstanceValidator();
const instanceResult = instanceValidator.validate(instance, schema);
```

### Go

```bash
go get github.com/json-structure/sdk/go
```

```go
package main

import (
    "encoding/json"
    "fmt"
    jsonstructure "github.com/json-structure/sdk/go"
)

func main() {
    // Define a schema
    schemaJSON := `{
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        }
    }`

    var schema map[string]interface{}
    json.Unmarshal([]byte(schemaJSON), &schema)

    // Validate the schema
    schemaValidator := jsonstructure.NewSchemaValidator(nil)
    schemaResult := schemaValidator.Validate(schema)
    fmt.Printf("Schema valid: %v\n", schemaResult.IsValid)

    // Validate an instance
    instance := map[string]interface{}{
        "name": "Alice",
        "age":  float64(30),
    }

    instanceValidator := jsonstructure.NewInstanceValidator(nil)
    instanceResult := instanceValidator.Validate(instance, schema)
    fmt.Printf("Instance valid: %v\n", instanceResult.IsValid)
}
```

### Perl

```bash
cpanm JSON::Structure
```

```perl
use JSON::Structure::SchemaValidator;
use JSON::Structure::InstanceValidator;
use JSON::MaybeXS;

# Define a schema
my $schema = decode_json(q|{
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "name": "Person",
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "int32"}
    }
}|);

# Validate the schema
my $schema_validator = JSON::Structure::SchemaValidator->new();
my $schema_result = $schema_validator->validate($schema);
print "Schema valid: ", ($schema_result->is_valid ? "true" : "false"), "\n";

# Validate an instance
my $instance = decode_json('{"name": "Alice", "age": 30}');
my $instance_validator = JSON::Structure::InstanceValidator->new(schema => $schema);
my $instance_result = $instance_validator->validate($instance);
print "Instance valid: ", ($instance_result->is_valid ? "true" : "false"), "\n";
```

### Rust

```bash
cargo add json-structure
```

```rust
use json_structure::{SchemaValidator, InstanceValidator};
use serde_json::json;

fn main() {
    // Define a schema
    let schema = json!({
        "$schema": "https://json-structure.org/meta/core/v0/#",
        "name": "Person",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "int32"}
        }
    });

    // Validate the schema
    let schema_validator = SchemaValidator::new();
    let schema_result = schema_validator.validate(&schema);
    println!("Schema valid: {}", schema_result.is_valid());

    // Validate an instance
    let instance = json!({"name": "Alice", "age": 30});
    let instance_validator = InstanceValidator::new();
    let instance_result = instance_validator.validate(&instance, &schema);
    println!("Instance valid: {}", instance_result.is_valid());
}
```

### C

```bash
# Build with CMake
mkdir build && cd build
cmake ..
cmake --build .
```

```c
#include "json_structure.h"
#include <stdio.h>

int main() {
    // Define a schema
    const char* schema_json = "{\n"
        "\"$schema\": \"https://json-structure.org/meta/core/v0/#\",\n"
        "\"name\": \"Person\",\n"
        "\"type\": \"object\",\n"
        "\"properties\": {\n"
        "    \"name\": {\"type\": \"string\"},\n"
        "    \"age\": {\"type\": \"int32\"}\n"
        "}\n"
    "}";

    // Parse and validate the schema
    cJSON* schema = cJSON_Parse(schema_json);
    JsValidationResult result = js_validate_schema(schema);
    printf("Schema valid: %s\n", result.is_valid ? "true" : "false");
    js_result_cleanup(&result);

    // Validate an instance
    const char* instance_json = "{\"name\": \"Alice\", \"age\": 30}";
    cJSON* instance = cJSON_Parse(instance_json);
    result = js_validate_instance(instance, schema);
    printf("Instance valid: %s\n", result.is_valid ? "true" : "false");
    
    js_result_cleanup(&result);
    cJSON_Delete(instance);
    cJSON_Delete(schema);
    return 0;
}
```

### Swift

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/json-structure/sdk.git", from: "0.1.0")
]
```

```swift
import JSONStructure
import Foundation

// Define a schema
let schema: [String: Any] = [
    "$schema": "https://json-structure.org/meta/core/v0/#",
    "$id": "https://example.com/person.struct.json",
    "name": "Person",
    "type": "object",
    "properties": [
        "name": ["type": "string"],
        "age": ["type": "int32"]
    ]
]

// Validate the schema
let schemaValidator = SchemaValidator()
let schemaResult = schemaValidator.validate(schema)
print("Schema valid: \(schemaResult.isEmpty)")

// Validate an instance
let instance: [String: Any] = ["name": "Alice", "age": 30]
let instanceValidator = InstanceValidator(schema: schema)
let instanceResult = instanceValidator.validate(instance)
print("Instance valid: \(instanceResult.isEmpty)")
```

### PHP

```bash
composer require json-structure/sdk
```

```php
<?php

use JsonStructure\SchemaValidator;
use JsonStructure\InstanceValidator;

// Validate a schema
$schema = [
    '$schema' => 'https://json-structure.org/meta/core/v0/#',
    '$id' => 'https://example.com/person.struct.json',
    'name' => 'Person',
    'type' => 'object',
    'properties' => [
        'name' => ['type' => 'string'],
        'age' => ['type' => 'int32']
    ]
];

$schemaValidator = new SchemaValidator();
$schemaErrors = $schemaValidator->validate($schema);

// Validate an instance
$instance = ['name' => 'Alice', 'age' => 30];
$instanceValidator = new InstanceValidator($schema);
$instanceErrors = $instanceValidator->validate($instance);
```

### R

```r
# install.packages("remotes")
remotes::install_github("json-structure/sdk", subdir = "r")
```

```r
library(jsonstructure)

# Validate a schema (accepts a JSON string or an R list)
schema <- list(
  "$schema" = "https://json-structure.org/meta/core/v0/#",
  name = "Person",
  type = "object",
  properties = list(
    name = list(type = "string"),
    age = list(type = "int32")
  )
)
schema_result <- js_validate_schema(schema)
is_valid(schema_result)

# Validate an instance
instance_result <- js_validate_instance(list(name = "Alice", age = 30L), schema)
is_valid(instance_result)
```

## Documentation

- [JSON Structure Specification](https://github.com/json-structure/core)
- [JSON Structure Primer](https://github.com/json-structure/primer-and-samples)

## Contributing

Contributions are welcome! Please see the individual SDK directories for language-specific
contribution guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
