# xRegistry HTTP Binding

<!-- words: validatecompatibility validateformat -->
<!-- words: compat formatvalidated compatibilityvalidated -->
<!-- words: compat formatvalidatedreason compatibilityvalidatedreason -->

## Abstract

This specification defines an HTTP protocol binding for the
[xRegistry specification](./spec.md). This document will include just the
HTTP-specific details and semantics, leaving the
[core specification](./spec.md) to define the xRegistry generic processing
model and semantics that apply to all protocols.

## Table of Contents

- [Notations and Terminology](#notations-and-terminology)
  - [Terminology](#terminology)
- [HTTP Binding Overview](#http-binding-overview)
- [Registry HTTP APIs](#registry-http-apis)
  - [Entity Processing Rules](#entity-processing-rules)
    - [Creating or Updating Entities](#creating-or-updating-entities)
    - [HTTP-Specific Attribute Processing Rules](#http-specific-attribute-processing-rules)
    - [Pagination](#pagination)
    - [HTTP OPTIONS Method](#http-options-method)
  - [Registry Entity](#registry-entity)
    - [`GET /`](#get-)
    - [`PATCH` and `PUT /`](#patch-and-put-)
    - [`POST /`](#post-)
    - [`GET /export`](#get-export)
  - [Registry Capabilities](#registry-capabilities)
    - [`GET /capabilities`](#get-capabilities)
    - [`GET /capabilitiesoffered`](#get-capabilitiesoffered)
    - [`PATCH` and `PUT /capabilities`](#patch-and-put-capabilities)
  - [Registry Model](#registry-model)
    - [`GET /model`](#get-model)
    - [`GET /modelsource`](#get-modelsource)
    - [`PUT /modelsource`](#put-modelsource)
  - [Group Entity](#group-entity)
    - [`GET /<GROUPS>`](#get-groups)
    - [`PATCH` and `POST /<GROUPS>`](#patch-and-post-groups)
    - [`DELETE /<GROUPS>`](#delete-groups)
    - [`GET /<GROUPS>/<GID>`](#get-groupsgid)
    - [`PATCH` and `PUT /<GROUPS>/<GID>`](#patch-and-put-groupsgid)
    - [`POST /<GROUPS>/<GID>`](#post-groupsgid)
    - [`DELETE /<GROUPS>/<GID>`](#delete-groupsgid)
  - [Resource Entity](#resource-entity)
    - [`GET /<GROUPS>/<GID>/<RESOURCES>`](#get-groupsgidresources)
    - [`PATCH` and `POST /<GROUPS>/<GID>/<RESOURCES>`](#patch-and-post-groupsgidresources)
    - [`DELETE /<GROUPS>/<GID>/<RESOURCES>`](#delete-groupsgidresources)
    - [`GET /<GROUPS>/<GID>/<RESOURCES>/<RID>`](#get-groupsgidresourcesrid)
    - [`PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>`](#patch-and-put-groupsgidresourcesrid)
    - [`POST /<GROUPS>/<GID>/<RESOURCES>/<RID>`](#post-groupsgidresourcesrid)
    - [`DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>`](#delete-groupsgidresourcesrid)
  - [Meta Entity](#meta-entity)
    - [`GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`](#get-groupsgidresourcesridmeta)
    - [`PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`](#patch-and-put-groupsgidresourcesridmeta)
    - [`DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`](#delete-groupsgidresourcesridmeta)
  - [Version Entity](#version-entity)
    - [`GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`](#get-groupsgidresourcesridversions)
    - [`PATCH` and `POST /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`](#patch-and-post-groupsgidresourcesridversions)
    - [`DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`](#delete-groupsgidresourcesridversions)
    - [`GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`](#get-groupsgidresourcesridversionsvid)
    - [`PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`](#patch-and-put-groupsgidresourcesridversionsvid)
    - [`DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`](#delete-groupsgidresourcesridversionsvid)
  - [xRegistry Discovery](#xregistry-discovery)
- [Request Flags / Query Parameters](#request-flags--query-parameters)
- [HTTP Header Values](#http-header-values)
- [Error Processing](#error-processing)

## Notations and Terminology

### Notational Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://tools.ietf.org/html/rfc2119).

For clarity, OPTIONAL attributes (specification-defined and extensions) are
OPTIONAL for clients to use, but the servers' responsibility will vary.
Server-unknown extension attributes MUST be silently stored in the backing
datastore. Specification-defined attributes and server-known extension
attributes MUST generate an error if the corresponding feature is not supported
or enabled. However, as with all attributes, if accepting the attribute results
in a bad state (such as exceeding a size limit or resulting in a security
issue), then the server MAY choose to reject the request.

In the pseudo JSON format snippets `?` means the preceding item is OPTIONAL,
`*` means the preceding item MAY appear zero or more times, and `+` means the
preceding item MUST appear at least once. The presence of the `#` character
means the remaining portion of the line is a comment. Whitespace characters in
the JSON snippets are used for readability and are not normative.

When HTTP query parameters are discussed, they are presented as `?<NAME>` where
`<NAME>` is the name of the query parameter.

See the [core specification](./spec.md#notational-conventions) for details
about the use of `<...>` substitution values.

### Terminology

See the [core specification](./spec.md#terminology) for the list of xRegistry
defined terms that might be used.

## HTTP Binding Overview

### HTTP API Patterns

This specification defines the following base API patterns:

```yaml
/                                                # Access the Registry
/capabilities                                    # Access features enabled
/capabilitiesoffered                             # Access available features
/model                                           # Access full model definitions
/modelsource                                     # Access model customizations
/export                                          # Retrieve Registry as a doc
/<GROUPS>                                        # Access a Group Type
/<GROUPS>/<GID>                                  # Access a Group
/<GROUPS>/<GID>/<RESOURCES>                      # Access a Resource Type
/<GROUPS>/<GID>/<RESOURCES>/<RID>                # Default Version of Resource
/<GROUPS>/<GID>/<RESOURCES>/<RID>/meta           # Access a Resource's metadata
/<GROUPS>/<GID>/<RESOURCES>/<RID>/versions       # Versions of a Resource
/<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID> # Access Version of Resource
```

While these APIs are shown to be at the root path of a host,
implementations MAY choose to prefix them as necessary. However, the same
prefix MUST be used consistently for all APIs in the same Registry instance.

If an OPTIONAL HTTP path is not supported by an implementation, then any
use of that API MUST generate an error
([api_not_found](#api_not_found)).

If an HTTP method is not supported for a supported HTTP path, then an error
([action_not_supported](./spec.md#action_not_supported)) MUST be generated.

Implementations MAY support extension APIs, however, the following rules apply:
- New HTTP paths that extend non-root paths MUST NOT be defined as they might
  conflict with URLs of entities within the system.
- New root HTTP paths MAY be defined as long as they do not use Registry-level
  HTTP paths or attribute names. This includes extension and Groups collection
  attribute names.

For example, a new API with an HTTP path of `/my-api` is allowed, but APIs with
`/model/my-api` or `/name` HTTP paths are not.

### Adherence to HTTP Standards

This specification leans on the
[RFC9110 HTTP Semantics model](https://www.rfc-editor.org/rfc/rfc9110.html)
with the
[RFC5789 PATCH extension](https://www.rfc-editor.org/rfc/rfc5789.html).
The following key aspects are called out to help understand the overall
pattern of the APIs:
- A `PUT` or `POST` operation is a full replacement of the entities
  processed. Any missing attributes MUST be interpreted as a request for them
  to be deleted. However, attributes that are managed by the server might have
  specialized processing in those cases, in particular, mandatory attributes,
  as well as ones that have default values defined, MUST be reset to their
  default values rather than deleted.
- A `PATCH` operation MUST only modify the attributes explicitly mentioned
  in the request. Any attribute in the request with a value of `null` MUST be
  interpreted as a request to delete the attribute, and as with `PUT`/`POST`,
  server-managed attributes might have specialized processing.
- `PUT` MUST NOT be targeted at xRegistry collections. A `POST` or `PATCH`
  MUST be used instead to add entities to the collection, and a
  `DELETE` MUST then be used to delete unwanted entities.
- Unknown query parameters SHOULD be silently ignored by servers. This
  includes specification-defined but unsupported query parameters.
- Despite the
  [HTTP specification](https://datatracker.ietf.org/doc/html/rfc9110#name-idempotent-methods)
  saying that the `PUT` method is idempotent, this specification does not
  adhere to that rule when it comes to the `epoch` and `modifiedat` attributes.
  While multiple identical `PUT` requests will yield the same semantic effect
  as a single `PUT` for all other attributes, the `epoch` and `modifiedat`
  attributes are designed to always be updated on each write operation to that
  entity.

### No-Code Servers

In the [core specification](./spec.md) there is a
discussion about ["no-code servers"](./spec.md#design-no-code-servers). In the
case of HTTP, simple file servers SHOULD support exposing Resources where the
HTTP body response contains the Resource's domain-specific "document" as well
as exposing the serialization of the Resource's xRegistry metadata via the
[`$details`](#resource-metadata-vs-resource-document) suffix on the URL path.
This can be achieved by creating a secondary, sibling, file on disk with
`$details` at the end of its filename.

## Registry HTTP APIs

This section mainly focuses on the successful interaction patterns of the APIs.
For example, most examples will show an HTTP "200 OK" as the response. Each
implementation MAY choose to return a more appropriate response based on the
specific situation. For example, in the case of an authentication error the
server could return `401 Unauthorized`.

### Entity Processing Rules

Rather than repeating the processing rules for `PATCH`, `POST` and `PUT`,
for each type of xRegistry entity or Registry collection, the overall pattern
is defined once in this section and any entity-, or collection-specific rules
will be detailed in the appropriate section in the specification.

#### Creating or Updating Entities

This defines the general rules for how to update entities.

Creating or updating entities MAY be done using HTTP `PUT`, `PATCH` or `POST`
methods:
- `PUT    <PATH-TO-ENTITY>                # Process a single entity`
- `PATCH  <PATH-TO-ENTITY>                # Process a single entity`
- `POST   <PATH-TO-ENTITY>                # Process a set of child entities`
- `PATCH  <PATH-TO-COLLECTION>            # Process a set of entities`
- `POST   <PATH-TO-COLLECTION>            # Process a set of entities`

See the [`Request Flags`](#request-flags--query-parameters) section for the
list of flags/query parameters that MAY be used for each API.

The `PUT` variant MUST adhere to the following:
  - The URL MUST be of the form: `<PATH-TO-ENTITY>`.
  - The HTTP body MUST contain the full updated serialization of the entity to
    be processed.
  - The entity processed MUST either be created (if it does not already
    exist), or updated (if it does exist).
  - Any mutable attribute which is either missing or present with a value of
    `null`, MUST be interpreted as a request to delete the attribute.
  - Excluding any Registry collection attributes, all mutable attributes
    specified MUST be a full serialization of the attribute. Any missing
    nested attribute MUST be interpreted as a request to delete the attribute.
  - After processing the request, if there are any missing REQUIRED attributes
    then an error
    ([required_attribute_missing](./spec.md#required_attribute_missing))
    MUST be generated.

The `PATCH` variant when directed at a single entity, MUST adhere to the `PUT`
semantics defined above with the following exceptions:
  - Any mutable attribute which is missing MUST be interpreted as a request to
    leave it unchanged. However, modifying some other attribute (or some other
    server semantics) MAY modify it. A value of `null` MUST be interpreted as
    a request to delete the attribute.
  - When processing a Resource or Version, whose Resource type has its
    [`hasdocument`](./model.md#groupsstringresourcesstringhasdocument) model
    aspect set to `true`, the URL accessing the entity MUST include the
    `$details` suffix, and MUST generate an error
    ([details_required](#details_required)) in the absence of the
    `$details` suffix. This is because when it is absent, the processing of
    the HTTP `xRegistry-` headers are already defined with "PATCH" semantics
    so a normal `PUT` or `POST` can be used instead. Using `PATCH` in this
    case would mean that the request is trying to "patch" the Resource's
    "document", which this specification does not support at this time.
  - `PATCH` MAY be used to create new entities, but as with any of the create
    operations, any missing REQUIRED attributes MUST generate an error
    ([required_attribute_missing](./spec.md#required_attribute_missing)).

The `POST` variant when directed at a single entity other than a Resource,
MUST adhere to the following:
  - The HTTP body MUST contain only a JSON map where the key MUST be the
    attribute (collection) name of a nested xRegistry collection. The value
    of each map entry MUST be a map of nested entities where the key is the
    entity's `<SINGULAR>id` and the value is a serialization of the entity
    itself.
  - The processing of each top-level map entry MUST follow the same rules
    as defined for `POST` to the nested xRegistry collection where the map
    entry's value is the input.
  - The root of the JSON object in the HTTP body MUST NOT contain any
    attributes of the targeted entity other than the nested collections, and
    none of that entity's attribute are to be updated. This operation allows
    for an update to multiple nested collections in a single operation without
    modifying the owning entity.
  - The response message MUST be a map of the nested entity types with just
    the changed entities that were processed. No top-level entity attributes
    are to appear - similar to the request message.

The `POST` variant when directed at a Resource entity, MUST adhere to the
following:
  - The HTTP body MUST contain the serialization of the single Version to be
    created, however, it MAY include Resource-level read-only attributes (such
    as `versionscount`), and if they are present, then they MUST be silently
    ignored by the server. This is done as a convenience for users who might
    have obtained the Version's serialization from a query to a Resource (not
    a specific Version), in which case those extra Resource-level attributes
    would be included in the serialization.
  - The 'PUT' variant rules above MUST apply to the new Version entity.

The `PATCH` variant when directed at an xRegistry collection, MUST adhere to
the following:
  - The HTTP body MUST contain a JSON map where the key MUST be the
    `<SINGULAR>id` of each entity in the map. Note, that in the case of a map
    of Versions, the `versionid` is used.
  - Each value in the map MUST contain just the attributes that are to be
    updated for that entity.
  - The processing of each individual entity in the map MUST follow the same
    rules as defined for `PATCH` of a single entity above.

The `POST` variant when directed at an xRegistry collection MUST adhere to the
following:
  - The HTTP body MUST contain a JSON map where the key MUST be the
    `<SINGULAR>id` of each entity in the map. Note, that in the case of a map
    of Versions, the `versionid` is used.
  - Each value in the map MUST be the full serialization of the entity to be
    either added or updated. Note that `POST` does not support deleting
    entities from a collection, so a separate delete operation might be needed
    if there are entities that need to be removed.
  - The processing of each individual entity in the map MUST follow the same
    rules as defined for `PUT` above.
  - In the case of an empty map of Versions and the Resource being referenced
    does not exist yet, an error ([missing_versions](#missing_versions)) MUST
    be generated because a Resource can not exist without any Versions. If
    the intent was to create a Resource with a Version that has just default
    values, then there are other APIs that can be used that make that intent
    clear (e.g. `PUT` to the Resource itself).

The processing of each individual entity follows the same set of rules:
- If an entity with the specified `<SINGULAR>id` already exists then it MUST be
  interpreted as a request to update the existing entity. Otherwise, it MUST
  be interpreted as a request to create a new entity with that `<SINGULAR>id`.
- See the definition of each attribute for the rules governing how it is
  processed.
- Unless otherwise noted, all non-xRegistry collection attributes present MUST
  be a full representation of their values. This means any complex attributes
  (e.g. objects, maps), MUST be fully replaced by the incoming value.
- A request to update, or delete, a read-only attribute MUST be silently
  ignored. However, a request that includes a `<SINGULAR>id` MUST be compared
  with the entity's current value and if it differs then an error
  ([mismatched_id](./spec.md#mismatched_id)) MUST be generated. This includes
  both `<RESOURCE>id` and `versionid` in the case of Resources and Versions.
  This is to prevent accidentally updating the wrong entity.
- A request to update a mutable attribute with an invalid value MUST generate
  an error ([invalid_attribute](./spec.md#invalid_attribute))
  (this includes deleting a mandatory mutable attribute that has no default
  value defined).
- Registry collection attributes MUST be processed per the rules specified
  in the [Updating Nested Registry
  Collections](./spec.md#updating-nested-registry-collections) section.
- Write operations that are meant to include xRegistry metadata in the HTTP
  body MUST NOT be empty, and if detected MUST generate an error
  ([missing_body](#missing_body)). To denote an empty set of
   metadata, `{}` MUST be used instead.
- Any error during the processing of an entity, or its nested entities, MUST
  result in the entire request being rejected and no updates performed.

Resources and Versions have the following additional rules:
- When a write operation request includes the Resource/Version's metadata in
  the HTTP body, then the inclusion of any xRegistry `xRegistry-` HTTP headers
  MUST generate an error ([extra_xregistry_header](#extra_xregistry_header)).
- When a write operation request includes a domain-specific document in the
  HTTP body, and the `<RESOURCE>url` xRegistry HTTP header is present with a
  non-null value, the HTTP body MUST be empty. If the `<RESOURCE>url`
  attribute is absent, then the contents of the HTTP body (even if empty) are
  to be used as the entity's document.
- The `<RESOURCE>` and `<RESOURCEbase64>` attributes MUST never appear as
  xRegistry HTTP headers, and if present on a write request MUST generate
  an error ([extra_xregistry_header](#extra_xregistry_header)).

A successful response MUST return the same response as a `GET` to the entity
(or entities) processed, showing their current representation in the same
format (`$details` variant or not) as the request, with the
following exceptions:
- In the `POST` case, or a `PATCH` directed to an xRegistry collection, the
  result MUST contain only the entities processed, not the entire Registry
  collection.
- In the `PUT` or `PATCH` cases that are directed to a single entity, for a
  newly created entity, the HTTP status MUST be `201 Created`, and it MUST
  include an HTTP `Location` header with a URL to the newly created entity.
  Note that this URL MUST be the same as the `self` attribute of that entity.
- In the `PUT` or `PATCH` cases directed at a single Resource or Version, if
  a new Version was created, the response MUST include a `Content-Location`
  HTTP header to the newly created Version entity, and it MUST be the same as
  the Version's `self` attribute.
- The responses MUST NOT include any inlineable attributes (such as
  `<RESOURCE>`, `<RESOURCE>base64` or nested objects/collections) unless
  requested.

Otherwise an HTTP `200 OK` without an HTTP `Location` header MUST be returned.

Note that the response MUST be generated applying the semantics of any
[request flags](#request-flags--query-parameters) specified in the request
URL (e.g. `?inline`).

##### xRegistry Root HTTP Header

All API responses, including errors, SHOULD include a `Link` HTTP header of
the form:

```yaml
Link: <URL-TO-XREGISTRY-ROOT>;rel=xregistry-root
```

Where `URL-TO-XREGISTRY-ROOT` is the URL to the root of the current xRegistry
instance.

This allows for client-side response processing to unambiguously know the
base URL of the Registry from which the response came without needing to
know the request URL or attempting to determine the URL from the response
payload.

**Examples:**

```yaml
Link: <https://myregistry.example.com>;rel=xregistry-root
```

#### HTTP-Specific Attribute Processing Rules

##### `self` Attribute

In addition to the core specification's definition of
[`self`](./spec.md#self-attribute), the following HTTP-specific rules apply:

- When serializing Resources and Versions, whose Resource type's
  [`hasdocument`](./model.md#groupsstringresourcesstringhasdocument) aspect
  is set to `true`, then this URL MUST include the `$details` suffix appended
  to its `<SINGULAR>id` if it is serialized in the the HTTP body response. If
  the aspect is set to `false` then it MUST NOT include it. This rule applies
  even if the URL used in a request message did include the suffix.

##### `labels` Attribute

In addition to the core specification's definition of
[`labels`](./spec.md#labels-attribute), the following HTTP-specific rules
apply:

- When `labels` is serialized as an HTTP header, see
  [Serializing Resource Domain-Specific Documents](#serializing-resource-domain-specific-documents), then
  each map entry MUST appear as a separate HTTP header using a name of
  `xRegistry-labels.<KEYNAME>`.

##### `contenttype` Attribute

In addition to the core specification's definition of
[`contenttype`](./spec.md#contenttype-attribute), the following HTTP-specific
rules apply:

- When this attribute is serialized as an HTTP header, it MUST use the name
  `Content-Type` and not `xRegistry-contenttype`.
- On an update request when the xRegistry metadata appears in HTTP headers,
  unlike other attributes that will remain unchanged when not specified,
  this attribute MUST be erased if the incoming request does not include
  the `Content-Type` HTTP header.

##### `<RESOURCE>` Attribute

In addition to the core specification's definition of
[`<RESOURCE>`](./spec.md#resource-attribute), the following HTTP-specific
rules apply:

- When a Resource or Version's attributes are serialized as HTTP headers,
  this attribute MUST NOT be included in the list.

##### `<RESOURCE>base64` Attribute

In addition to the core specification's definition of
[`<RESOURCE>base64`](./spec.md#resourcebase64-attribute), the following
HTTP-specific rules apply:

- When a Resource or Version's attributes are serialized as HTTP headers,
  this attribute MUST NOT be included in the list.

#### Pagination

Since xRegistry collections (i.e. the `<COLLECTION>` attribute) could be too
large to retrieve in a single request, when retrieving a collection, the
client MAY request a subset by using the
[pagination specification](../pagination/spec.md). Likewise, the server MAY
choose to return a subset of the collection using the same mechanism defined
in that specification even if the request didn't ask for pagination. The
pagination specification MUST only be used when the request is directed at a
collection, not at its owning entity (such as the root of the Registry, or at
an individual Group or Resource).

In the remainder of this specification, the presence of the `Link` HTTP header
indicates that the [pagination specification](../pagination/spec.md)
MAY be used for that API.

#### HTTP OPTIONS Method

A server MAY support clients querying the list of supported HTTP methods
for any supported API. The request MUST be of the form:

```yaml
OPTIONS <PATH>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Allow: <METHODS>
Access-Control-Allow-Methods: <METHODS>
```

Where:
- `<METHODS>` is a comma-separated list of HTTP methods that are supported
  by that API.
- The same `<METHODS>` values MUST be returned for both headers.
- `OPTIONS` MUST be one of the values returned.
- This operation MUST NOT modify any data within the Registry.
- Implementations MAY choose to include other information per the
  [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.7)
  specification.

**Examples:**

Retrieve the supported list of HTTP methods at the root of the Registry:

```yaml
OPTIONS /
```

```yaml
HTTP/1.1 200 OK
Allow: GET, OPTIONS
Access-Control-Allow-Methods: GET, OPTIONS
```

### Registry Entity

#### `GET /`

A server MAY support clients retrieving the
[Registry Entity](./spec.md#registry-entity) via an HTTP `GET` directed to
the Registry Entity.

See [Registry Entity](./spec.md#registry-entity) for more information.

The request MUST be of the form:

```yaml
GET /
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  ... Registry entity excluded for brevity ...
}
```

**Examples:**

Retrieve a Registry that has 2 types of Groups (`endpoints` and
`schemagroups`):

```yaml
GET /
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "specversion": "1.0-rc4",
  "registryid": "myRegistry",
  "self": "https://example.com/",
  "xid": "/",
  "epoch": 1,
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",

  "endpointsurl": "https://example.com/endpoints",
  "endpointscount": 42,

  "schemagroupsurl": "https://example.com/schemagroups",
  "schemagroupscount": 1
}
```

#### `PATCH` and `PUT /`

A server MAY support clients updating the
[Registry entity](./spec.md#registry-entity) via an HTTP `PATCH` or `PUT`
directed to the Registry entity.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The request MUST be of the form:

```yaml
PUT /
Content-Type: application/json; charset=utf-8
or
PATCH /
Content-Type: application/json; charset=utf-8

{
  ... Registry entity excluded for brevity ...
}
```

Where:
- With the exception of the `capabilities`, `modelsource` and Groups
  attributes, the HTTP body MUST contain the full representation of the
  Registry entity in the case of `PUT`, or the full representation of just the
  modified attributes in the case of `PATCH`.
- A missing `capabilities` or `modelsource` attribute MUST NOT result in any
  changes to those values.
- For both the `PATCH` and `PUT` cases, if present, the `modelsource` attribute
  MUST be a complete replacement representation of the model definition. A
  value of `null` or `{}` MUST reset the model to the server's default value
  (no Groups, Resources, extension attributes or custom specification-defined
  attributes).  See [Creating or Updating the Registry
  Model](./model.md#creating-or-updating-the-registry-model) for more
  information.
- When the `capabilities` attribute is present and `PATCH` is used then only
  the top-level capabilities specified in the request MUST be updated. But,
  each capability present MUST be specified in its entirety. When `PUT` is
  used then it MUST be a complete replacement definition of all the
  capabilities. In either case, a value of `null` MUST reset the server to
  its default set of capabilities.

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  ... Registry entity excluded for brevity ...
}
```

**Examples:**

Updating a Registry's metadata:

```yaml
PUT /
Content-Type: application/json; charset=utf-8

{
  "registryid": "myRegistry",
  "name": "My Registry",
  "description": "An even cooler registry!"
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "specversion": "1.0-rc4",
  "registryid": "myRegistry",
  "self": "https://example.com/",
  "xid": "/",
  "epoch": 2,
  "name": "My Registry",
  "description": "An even cooler registry!",
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",

  "endpointsurl": "https://example.com/endpoints",
  "endpointscount": 42,

  "schemagroupsurl": "https://example.com/schemagroups",
  "schemagroupscount": 1
}
```

#### `POST /`

A server MAY support clients updating or creating multiple
[Groups](./spec.md#group-entity) of varying types via an HTTP `POST` directed
to the [Registry entity](./spec.md#registry-entity). This API is very similar
to the [`POST /<GROUPS>`](#patch-and-post-groups) API, except that the HTTP body
MUST be a map of Group types as shown below:

The request MUST be of the form:

```yaml
POST /
Content-Type: application/json; charset=utf-8

{
  # Repeat for each Group type that has a Group to be created or updated
  "<GROUPS>": {
    "<GROUP>id": {
      ... Group entity excluded for brevity ...
    } *
  } *
}
```

Notice the format is almost the same as what a `PUT /` would look like if the
request wanted to update the Registry's attributes and define a set of Groups,
but without the Registry's attributes. This allows for an update of the
specified Groups without modifying the Registry's attributes.

A request that isn't a map of Group types (e.g. it contains other Registry
level attributes) MUST generate an error ([groups_only](./spec.md#groups_only)).

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "<GROUPS>": {
    "<GROUP>id": {
      ... Group entity excluded for brevity ...
    } *
  } *
}
```

Where:
- The response MUST only include the Groups that were processed, and not any
  Registry-level attributes.

**Examples:**

Creating 4 Groups of 2 different Group types.

```yaml
POST /
Content-Type: application/json; charset=utf-8

{
  "endpoints": {
    "endpoint1": { ... Group endpoint1 excluded for brevity ... },
    "endpoint2": { ... Group endpoint2 excluded for brevity ... }
  },
  "schemagroups": {
    "schemagroup1": { ... Group schemagroup1 excluded for brevity ... },
    "schemagroup2": { ... Group schemagroup2 excluded for brevity ... }
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "endpoints": {
    "endpoint1": { ... Group endpoint1 excluded for brevity ... },
    "endpoint2": { ... Group endpoint2 excluded for brevity ... }
  },
  "schemagroups": {
    "schemagroup1": { ... Group schemagroup1 excluded for brevity ... },
    "schemagroup2": { ... Group schemagroup2 excluded for brevity ... }
  }
}
```

#### `GET /export`

The `GET /export` API MUST be an alias for
`GET /?doc&inline=*,capabilities,modelsource`. If this path is supported,
it MUST NOT support any HTTP update methods. This API was created:
- As a shorthand convenience syntax for clients that need to download the
  entire [Registry](./spec.md#registry-entity) as a single document. For
  example, to then be used in an "import" type of operation for another
  Registry, or for tooling that does not need the duplication of information
  that [Doc Flag](./spec.md#doc-flag) removes.
- Note, the semantics of the `doc` and `inline` flags MUST still be adhered to
  even if explicitly specifying those flags is not supported by the server.
- To allow for servers that do not support query parameters (such as
  [No-Code Servers](./spec.md#design-no-code-servers)) to expose the entire
  Registry with a single (non-query parameterized) API call.

[Request Flags](#request-flags--query-parameters) MAY be included, if
supported, and any [`?inline` flag](#inline-flag) specified MUST override the
default value defined above.

A request MUST be of the form:

```yaml
GET /export
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  ... Registry entity, and nested collections, excluded for brevity ...
}
```

### Registry Capabilities

#### `GET /capabilities`

A server SHOULD support clients retrieving the set of
[capabilities](./spec.md#registry-capabilities) (features) it supports via
an HTTP `GET` directed to the stand-alone `capabilities` map.

The request MUST be of the form:

```yaml
GET /capabilities
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Capabilities map excluded for brevity ... }
```

**Examples:**

```yaml
GET /capabilities
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "available": [
    "/capabilities", "/export", "/model", "/modelsource"
  ],
  "flags": [
    "binary", "collections", "doc", "epoch", "filter", "ignore", "inline",
    "setdefaultversionid", "sort", "specversion"
  ],
  "ignores": [ "capabilities", "defaultversionid", "defaultversionsticky",
    "epoch", "id", "modelsource", "readonly"
  ],
  "mutable": [ "capabilities", "entities", "model" ],
  "pagination": false,
  "shortself": false,
  "specversions": [ "1.0-rc4" ]
}
```

#### `GET /capabilitiesoffered`

If a server supports clients updating its
[capabilities](./spec.md#registry-capabilities), then it SHOULD support
clients retrieving the set of valid
[offered capabilities](./spec.md#offered-capabilities) it supports via an
HTTP `GET` directed to the stand-alone `capabilitiesoffered` map.

The request MUST be of the form:

```yaml
GET /capabilitiesoffered
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Capabilities offering map excluded for brevity ... }
```

**Examples:**

```yaml
GET /capabilitiesoffered
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "available": {
    "type": "array",
    "item": {
      "type": "string"
    },
    "enum": [ "/capabilities", "/capabilitiesoffered", "/export", "/model",
       "/modelsource" ]
  },
  "flags": {
    "type": "array",
    "item": {
      "type": "string"
    },
    "enum": [ "collections", "doc", "epoch", "filter", "ignore", "inline",
       "setdefaultversionid", "sort", "specversion" ]
  },
  "ignores": {
    "type": "array",
    "item": {
      "type": "string"
    },
    "enum": [ "capabilities", "defaultversionid", "defaultversionsticky",
      "epoch", "id", "modelsource", "readonly" ]
  },
  "pagination": {
    "type": "boolean",
    "enum": [ false, true ]
  },
  "shortself": {
    "type": "boolean",
    "enum": [ false, true ]
  },
  "specversions": {
    "type": "array",
    "item": {
      "type": "string"
    },
    "enum": [ "1.0-rc4" ]
  },
  "versionmodes": {
    "type": "array",
    "item": {
      "type": "string"
    },
    "enum": [ "manual" ]
  }
}
```

#### `PATCH` and `PUT /capabilities`

A server MAY support clients updating its supported
[capabilities](./spec.md#registry-capabilities) (features)
via an HTTP `PATCH` or `PUT` directed to the stand-alone `capabilities` map.

A `PUT` MUST be interpreted as a request to update the entire set of
capabilities and any missing capability MUST be interpreted as a request to
reset it to its default value.

A `PATCH` is used to update a subset of capabilities. Each capability included
MUST be fully specified, and only those specified in the request MUST be fully
replaced by the incoming values. In other words, `PATCH` is done at a
capability level, not any deeper within the JSON structure.

See [Updating the Capabilities of a
Server](./spec.md#updating-the-capabilities-of-a-server) for more information.

The request MUST be of the form:

```yaml
PATCH /capabilities
Content-Type: application/json; charset=utf-8
or
PUT /capabilities
Content-Type: application/json; charset=utf-8

{ ... Capabilities map excluded for brevity...  }
```

Where:
- The HTTP body MUST contain the full representation of all capabilities
  in the case of `PUT`, or the full representation of just the modified
  capabilities in the case of `PATCH`.

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Capabilities map excluded for brevity ... }
```

Any change to the configuration of the server that is not supported MUST result
in an error ([capability_error](./spec.md#capability_error)) and no changes
applied. Likewise, any unknown capability keys specified MUST generate an
error ([capability_error](./spec.md#capability_error)).

Note: The semantic changes MUST NOT take effect until after the processing of
the current request is completed, even though the response MUST show the
requested changes.

**Examples:**

```yaml
PATCH /capabilities

{
  "shortself": true
}
```

```yaml
{
  "available": [
    "/capabilities", "/export", "/model", "/modelsource"
  ],
  "flags": [
    "binary", "collections", "doc", "epoch", "filter", "ignore", "inline",
    "setdefaultversionid", "sort", "specversion"
  ],
  "ignores": [
    "capabilities", "defaultversionid", "defaultversionsticky", "epoch",
    "id", "modelsource", "readonly"
  ],
  "mutable": [ "capabilities", "entities", "model" ],
  "pagination": false,
  "shortself": true,
  "specversions": [ "1.0-rc4" ]
}
```

### Registry Model

#### `GET /model`

A server MUST support clients retrieving its full
[model definition](./model.md#registry-model) via an HTTP `GET` directed to
the stand-alone `model` entity.

The request MUST be of the form:

```yaml
GET /model
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Model definition excluded for brevity ... }
```

To retrieve the model as part of the response to [retrieving](#get-) the
[Registry entity](./spec.md#registry-entity), use the
[Inline Flag](./spec.md#inline-flag) with a value of `model`, if supported.

Note that the `/model` API is a read-only API.

#### `GET /modelsource`

A server MAY support clients retrieving the client-provided
[model definition](./model.md#registry-model) used to define the current
model via an HTTP `GET` directed to the stand-alone `modelsource` entity.

In cases where the Registry's model has never been specified via `modelsource`,
this operation MUST return `{}` not an empty HTTP body.

The request MUST be of the form:

```yaml
GET /modelsource
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Model definition excluded for brevity ... }
```

To retrieve the `modelsource` as part of the response to
[retrieving](#get-) the
[Registry entity](./spec.md#registry-entity), use the
[Inline Flag](./spec.md#inline-flag) with a value of `modelsource`, if
supported.

#### `PUT /modelsource`

A server MAY support clients updating its
[model definition](./model.md#registry-model) via an HTTP `PUT` directed to
the stand-alone `modelsource` entity.

The request MUST be of the form:

```yaml
PUT /modelsource
Content-Type: application/json; charset=utf-8

{ ... Model definition excluded for brevity ... }
```

To update the `modelsource` as part of a request to update the
[Registry entity](./spec.md#registry-entity), you can include the attribute
as part of the [`PUT /`](#patch-and-put-) request.

Note: the HTTP body MUST be a JSON object and an empty request MUST generate
an error ([missing_body](#missing_body)). To denote an empty model, `{}` SHOULD
be used instead.

### Group Entity

#### `GET /<GROUPS>`

A server MAY support clients retrieving a
[Group](./spec.md#group-entity) collection via an HTTP `GET` directed to the
Registry's `<GROUPS>` collection URL.

The request MUST be of the form:

```yaml
GET /<GROUPS>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <URL>;rel=next;count=<UINTEGER> ?

{
  "<KEY>": {                                       # <GROUP>id
    ... Group entity excluded for brevity ...
  } *
}
```

**Examples:**

Retrieve all entities in the `endpoints` Group collection:

```yaml
GET /endpoints
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <https://example.com/endpoints&page=2>;rel=next;count=100

{
  "ep1": {
    "endpointid": "ep1",
    "self": "https://example.com/endpoints/ep1",
    "xid": "/endpoints/ep1",
    "epoch": 1,
    "name": "A cool endpoint",
    "createdat": "2024-04-30T12:00:00Z",
    "modifiedat": "2024-04-30T12:00:01Z",

    "messagesurl": "https://example.com/endpoints/ep1/messages",
    "messagescount": 5
  },
  "ep2": {
    "endpointid": "ep2",
    "self": "https://example.com/endpoints/ep2",
    "xid": "/endpoints/ep2",
    "epoch": 3,
    "name": "Redis Queue",
    "createdat": "2024-04-30T12:00:00Z",
    "modifiedat": "2024-04-30T12:00:01Z",

    "messagesurl": "https://example.com/endpoints/ep2/messages",
    "messagescount": 1
  }
}
```

Notice that the `Link` HTTP header is present, indicating that there
is a second page of results that can be retrieved via the specified URL,
and that there are a total of 100 items in this collection.

#### `PATCH` and `POST /<GROUPS>`

A server MAY support clients creating/updating multiple
[Groups](./spec.md#group-entity) in a Group collection via an HTTP `PATCH` or
`POST` directed to the Registry's `<GROUPS>` collection URL.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The request MUST be of the form:

```yaml
PATCH /<GROUPS>
Content-Type: application/json; charset=utf-8
or
POST /<GROUPS>
Content-Type: application/json; charset=utf-8

{
  "<KEY>": {                                      # <GROUP>id
     ... Group entity excluded for brevity ...
  } *
}
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "<KEY>": {                                      # <GROUP>id
     ... Group entity excluded for brevity ...
  } *
}
```

**Examples:**

```yaml
POST /endpoints
Content-Type: application/json; charset=utf-8

{
  "ep1": {
    "endpointid": "ep1",
    ... remainder of ep1 definition excluded for brevity ...
  },
  "ep2": {
    "endpointid": "ep2",
    ... remainder of ep2 definition excluded for brevity ...
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "ep1": {
    "endpointid": "ep1",
    ... remainder of ep1 definition excluded for brevity ...
  },
  "ep2": {
    "endpointid": "ep2",
    ... remainder of ep2 definition excluded for brevity ...
  }
}
```

#### `DELETE /<GROUPS>`

A server MAY support clients deleting one or more
[Groups](./spec.md#group-entity) from a Group collection via an HTTP `DELETE`
directed to the Registry's `<GROUPS>` collection URL.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>

{
  "<KEY>": {                            # <GROUP>id
    "epoch": <UINTEGER> ?
  } *
} ?
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete multiple Groups:

```yaml
DELETE /endpoints

{
  "ep1": {
    "epoch": 5
  },
  "ep2": {}
}
```

```
HTTP/1.1 204 No Content
```

Notice that the `epoch` value for `ep1` will be verified prior to the
delete, but no such check will happen for `ep2`.

#### `GET /<GROUPS>/<GID>`

A server MAY support clients retrieving a
[Group](./spec.md#group-entity) via an HTTP `GET` directed to the Group entity.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  ... Group entity excluded for brevity ...
}
```

**Examples:**

Retrieve a single `endpoints` Group:

```yaml
GET /endpoints/ep1
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "endpointid": "ep1",
  "self": "https://example.com/endpoints/ep1",
  "xid": "/endpoints/ep1",
  "epoch": 1,
  "name": "myEndpoint",
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",

  "messagesurl": "https://example.com/endpoints/ep1/messages",
  "messagescount": 5
}
```

#### `PATCH` and `PUT /<GROUPS>/<GID>`

A server MAY support clients creating or updating a
[Group](./spec.md#group-entity) in a Group collection via an HTTP `PATCH` or
`PUT` directed to the Group entity.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>
Content-Type: application/json; charset=utf-8
or
PUT /<GROUPS>/<GID>
Content-Type: application/json; charset=utf-8

{ ... Group entity excluded for brevity ... }
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Group entity excluded for brevity ... }
```

**Examples:**

Create a new Endpoint:

```yaml
PUT /endpoints/ep1
Content-Type: application/json; charset=utf-8

{
  "endpointid": "ep1",
  ... remainder of Endpoint 'ep1' definition excluded for brevity ...
}
```

```yaml
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Location: https://example.com/endpoints/ep1

{
  "endpointid": "ep1",
  ... remainder of Endpoint 'ep1' definition excluded for brevity ...
}
```

#### `POST /<GROUPS>/<GID>`

A server MAY support clients creating/updating one or more
[Resources](./spec.md#resource-entity), of varying Resource types, within the
specified [Group](./spec.md#group-entity) via an HTTP `POST` to the owning
Group.

The processing of this API is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section - see the discussion of the
`POST <PATH-TO-ENTITY>` variant.

A request that isn't a map of Resource types (e.g. it contains other Group
level attributes) MUST generate an error
([resources_only](./spec.md#resources_only)).

The request MUST be of the form:

```yaml
POST /<GROUPS>/<GID>
Content-Type: application/json; charset=utf-8

{
  "<RESOURCES>": {
    "<KEY>": {                            # <RESOURCE>id
      ... Resource entity excluded for brevity ...
    } *
  } *
}
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "<RESOURCES>": {
    "<KEY>": {                            # <RESOURCE>id
      ... Resource entity excluded for brevity ...
    } *
  } *
}
```

**Examples:**

Create a Message and a Schema Resource under Group `g1`:

```yaml
POST /groups/g1
Content-Type: application/json; charset=utf-8

{
  "messages": {
    "messageid": "msg1",
    ... remainder of msg1 definition excluded for brevity ...
  },
  "schemas": {
    "schemaid": "schema1",
    ... remainder of schema1 definition excluded for brevity ...
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "messages": {
    "messageid": "msg1",
    ... remainder of msg1 definition excluded for brevity ...
  },
  "schemas": {
    "schemaid": "schema1",
    ... remainder of schema1 definition excluded for brevity ...
  }
}
```

#### `DELETE /<GROUPS>/<GID>`

A server MAY support clients deleting a
[Group](./spec.md#group-entity) via an HTTP `DELETE` directed to the Group
entity.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>/<GID>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete a Group:

```yaml
DELETE /endpoints/ep1
```

```
HTTP/1.1 204 No Content
```

Delete a Group, verifying its `epoch` value:

```yaml
DELETE /endpoints/ep1?epoch=5
```

```
HTTP/1.1 204 No Content
```

### Resource Entity

#### Resource Metadata vs Resource Document

The core specification's
[Resource Metadata vs Resource Document](./spec.md#resource-metadata-vs-resource-document)
section explains how Resource types might be defined to have a
domain-specific document associated with them via their
[`hasdocument` model aspect](./model.md#groupsstringresourcesstringhasdocument)
being set to `true`. For HTTP, clients indicate whether they want to interact
with the Resource's xRegistry metadata or the Resource's domain-specific
document by the use of a `$details` suffix on the `<RESOURCE>id` in its URL.
Presence of the `$details` suffix MUST be interpreted as a request to interact
with the xRegistry metadata of the Resource, while its absence MUST be
interpreted as a request to interact with the Resource's domain-specific
document.

Use of `$details` on a non-Resource entity MUST generate an error
([bad_details](./spec.md#bad_details)).

For example:

```yaml
http://registry.example.com/schemagroups/mygroup/schemas/myschema$details
```

references the xRegistry metadata of the `myschema` Resource, while:

```yaml
http://registry.example.com/schemagroups/mygroup/schemas/myschema
```

references the (domain-specific) schema document associated with the
`myschema` Resource.

If a Resource type does not support domain-specific documents (i.e.
[`hasdocument`](./model.md#groupsstringresourcesstringhasdocument)
is set to `false`), then use of the `$details` suffix in a request URL MUST
be treated the same as if it were absent and any URLs in server response
messages referencing that Resource (e.g. `self`) MUST NOT include it.

##### Serializing Resource Domain-Specific Documents

This section goes into more details concerning situations where a Resource
type is defined to support domain-specific documents (i.e.
[`hasdocument`](./model.md#groupsstringresourcesstringhasdocument)
is set to `true`).

When a Resource is serialized as its underlying domain-specific document,
in other words `$details` is not appended to its URL path, the HTTP body of
requests and responses MUST be the exact bytes of that document. If the
document is empty, then the HTTP body MUST be empty (zero length).

In this serialization mode, it might be useful for clients to also interact
with some of the Resource's xRegistry metadata. To support this, some of the
Resource's xRegistry metadata MAY appear as HTTP headers in messages.

On responses, unless otherwise stated, all top-level scalar attributes of the
Resource SHOULD appear as HTTP headers where the header name is the name of the
attribute prefixed with `xRegistry-`. Note, the optionality of this requirement
is not to allow for servers to decide whether or not to do so, rather it is to
allow for [No-Code Servers](#no-code-servers) that might not be
able to control the HTTP response headers.

The `<RESOURCE>` and `<RESOURCEbase64>` attributes MUST NOT be serialized as
HTTP headers, even if their values can be considered "scalar", because their
values will appear in the HTTP body.

Top-level map attributes whose values are of scalar types SHOULD also appear as
HTTP headers (each key having its own HTTP header) and in those cases the
HTTP header names will be of the form: `xRegistry-<MAPNAME>.<KEYNAME>`.
Note that map keys MAY contain the `.` character, so any `.` after the
`<MAPNAME>.` is part of the key name. See
[HTTP Header Values](#http-header-values) for additional information and
[`labels`](#labels-attribute) for an example of one such attribute.

Certain attributes do not follow this rule if a standard HTTP header name
is defined for that semantic purpose. See the
[HTTP-Specific Attribute Processing Rules](#http-specific-attribute-processing-rules)
section for more information.

Complex top-level attributes (e.g. arrays, objects, non-scalar maps) MUST NOT
appear as HTTP headers.

On update requests, similar serialization rules apply. However, rather than
these headers being REQUIRED, the client would only need to include those
top-level attributes that they would like to change. But, including unchanged
attributes MAY be done. Unless otherwise stated, any attributes not included
in request messages MUST be interpreted as a request to leave their values
unchanged. Using a value of `null` (case-sensitive) MUST be processed as a
request to delete that attribute.

Any top-level map attributes that appear as HTTP headers MUST be included
in their entirety and any missing keys MUST be interpreted as a request to
delete those keys from the map.

Since only some types of attributes can appear as HTTP headers, in order
to manage the full set of attributes, the xRegistry metadata view (via use
of the `$details` URL suffix) MUST be used instead.

When a Resource (not a Version) is serialized with the Resource document
in the HTTP body, it MUST adhere to this form:

```yaml
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>           # ID of Resource, not default Version
xRegistry-versionid: <STRING>              # ID of the default Version
xRegistry-self: <URL>                      # Resource URL, not default Version
xRegistry-xid: <URI>                       # Relative Resource URI
xRegistry-epoch: <UINTEGER>                # Start default Version's attributes
xRegistry-name: <STRING> ?
xRegistry-isdefault: true
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?           # End of default Version attributes
xRegistry-metaurl: <URL>                   # Resource-level attributes
xRegistry-versionsurl: <URL>
xRegistry-versionscount: <UINTEGER>
Location: <URL> ?
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Resource document excluded for brevity ... ?
```

Where:
- The `<RESOURCE>id` is the `<SINGULAR>id` of the Resource, not the default
  Version.
- The `versionid` attribute MUST be the ID of the Resource's default Version.
- The `xid` URI references the Resource, not the default Version.
- The `versionsurl` and `versionscount` Collection attributes are included,
  but not the `versions` collection itself.
- The `Location` header only appears in response to a create operation and
  MUST be the same as the `self` URL.
- The `Content-Location` header MAY appear, and if present, MUST reference
  the "default" Version.
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.

Version serialization will look similar, but without the Resource-level
attributes, and MUST be of the form:

```yaml
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>           # ID of Resource, not default Version
xRegistry-versionid: <STRING>              # ID of the default Version
xRegistry-self: <URL>                      # Version URL
xRegistry-xid: <URI>                       # Relative Version URI
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: <BOOLEAN>
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?           # End of default Version attributes
Location: <URL> ?
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Version document excluded for brevity ... ?
```

Where:
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.

Scalar default Version extension attributes MUST also appear as
`xRegistry-` HTTP headers.

Notice that for Resources, the `meta` and `versions` attributes are not
included since they are complex data types.

Note: HTTP header values can be empty strings but some client-side tooling
might make it challenging to produce them. For example, `curl` requires
the header to be specified as `-Hmyheader;` - notice the semicolon(`;`) is
used instead of colon(`:`). So, this might be something to consider when
choosing to use attributes, or labels, that can be empty strings.

#### `GET /<GROUPS>/<GID>/<RESOURCES>`

A server MAY support clients retrieving a
[Resource](./spec.md#resource-entity) collection from a
[Group](./spec.md#group-entity) via an HTTP `GET`
directed to the owning Group's `<RESOURCE>` collection URL.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>/<RESOURCES>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <URL>;rel=next;count=<UINTEGER> ?

{
  "<KEY>": {                                    # <RESOURCE>id
    ... Resource entity excluded for brevity ...
  } *
}
```

**Examples:**

Retrieve all `messages` of an `endpoint` whose `<GROUP>id` is `ep1`:

```yaml
GET /endpoints/ep1/messages
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <https://example.com/endpoints/ep1/messages&page=2>;rel=next;count=100

{
  "msg1": {
    "messageid": "msg1",
    "versionid": "1.0",
    "self": "https://example.com/endpoints/ep1/messages/msg1",
    "xid": "/endpoints/ep1/messages/msg1",
    "epoch": 1,
    "name": "Blob Created",
    "isdefault": true,
    "createdat": "2024-04-30T12:00:00Z",
    "modifiedat": "2024-04-30T12:00:01Z",
    "ancestorid": "1.0",

    "metaurl": "https://example.com/endpoints/ep1/messages/msg1/meta",

    "versionsurl": "https://example.com/endpoints/ep1/messages/msg1/versions",
    "versionscount": 1
  }
}
```

#### `PATCH` and `POST /<GROUPS>/<GID>/<RESOURCES>`

A server MAY support clients creating/updating one or more
[Resources](./spec.md#resource-entity) within a
[Group](./spec.md#group-entity) via an HTTP `PATCH` or
`POST` directed to the owning Group's `<RESOURCE>` collection URL.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section - see the discussion of the
`POST/PATCH <PATH-TO-COLLECTION>` variants.

The request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>/<RESOURCES>
Content-Type: application/json; charset=utf-8
or
POST /<GROUPS>/<GID>/<RESOURCES>
Content-Type: application/json; charset=utf-8

{
  "<KEY>": {                                      # <RESOURCE>id
     ... Resource entity excluded for brevity ...
  } *
}
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
{
  "<KEY>": {                                      # <RESOURCE>id
     ... Resource entity excluded for brevity ...
  } *
}
```

**Examples:**

```yaml
POST /endpoints/ep1/messages
Content-Type: application/json; charset=utf-8

{
  "msg1": {
    "messageid": "msg1",
    ... remainder of msg1 definition excluded for brevity ...
  },
  "msg2": {
    "messageid": "msg2",
    ... remainder of msg2 definition excluded for brevity ...
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "msg1": {
    "messageid": "msg1",
    ... remainder of msg1 definition excluded for brevity ...
  },
  "msg2": {
    "messageid": "msg2",
    ... remainder of msg2 definition excluded for brevity ...
  }
}
```

#### `DELETE /<GROUPS>/<GID>/<RESOURCES>`

A server MAY support clients deleting one or more
[Resources](./spec.md#resource-entity) within a
[Group](./spec.md#group-entity) via an HTTP `DELETE` directed to the owning
Group's `<RESOURCE>` collection URL.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>/<GID>/<RESOURCES>

{
  "<KEY>": {                            # <RESOURCE>id
    "epoch": <UINTEGER> ?
  } *
} ?
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete multiple Resources:

```yaml
DELETE /endpoints/ep1/messages

{
  "msg1": {
    "epoch": 5
  },
  "msg2": {}
}
```

```
HTTP/1.1 204 No Content
```

Notice that the `epoch` value for `msg1` will be verified prior to the
delete, but no such check will happen for `msg2`.

#### `GET /<GROUPS>/<GID>/<RESOURCES>/<RID>`

A server MAY support clients retrieving a
[Resource](./spec.md#resource-entity) within a
[Group](./spec.md#group-entity) via an HTTP `GET` directed to the Resource
entity.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>/<RESOURCES>/<RID>[$details]
```

Where the `$details` suffix controls whether the request is directed to the
Resource metadata or to the Resource domain-specific document. See
[Resource Metadata vs Resource Document](#resource-metadata-vs-resource-document)
for more information.

When `$details` is used, or the Resource type is not configured to have a
domain-specific document, then a successful response MUST be:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Location: <URL> ?

{
  ... Resource entity excluded for brevity ...
}
```

Where:
- If `Content-Location` is present then it MUST be a URL to the Version of the
  Resource in the `versions` collection - same as `meta.defaultversionurl`.

When `$details` is not used and the Resource type is configured to have a
domain-specific document, then a successful response MUST be either:
- `200 OK` with the Resource document in the HTTP body.
- `303 See Other` with the location of the Resource's document being
  returned in the HTTP `Location` header if the Resource has a `<RESOURCE>url`
  value, and the HTTP body MUST be empty.

For either response, the Resource's default Version attributes, along with the
`meta` and `versions` related scalar attributes, MUST be serialized as HTTP
`xRegistry-` headers.

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 303 See Other
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>
xRegistry-versionid: <STRING>
xRegistry-self: <URL>
xRegistry-xid: <XID>
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: true
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?       # If Resource is not in body
xRegistry-metaurl: <URL>
xRegistry-versionsurl: <URL>
xRegistry-versionscount: <UINTEGER>
Location: <URL> ?                      # If 303 is returned
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Resource document ...              # If <RESOURCE>url is not set
```

Where:
- If `<RESOURCE>url` is present then it MUST have the same value as `Location`.
- If `Content-Location` is present then it MUST be a URL to the Version of the
  Resource in the `versions` collection - same as `meta.defaultversionurl`.
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.

**Examples:**

Retrieve a `message` Resource as xRegistry metadata:

```yaml
GET /endpoints/ep1/messages/msg1$details
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/1

{
  "messageid": "msg1",
  "versionid": "1",
  "self": "https://example.com/endpoints/ep1/messages/msg1",
  "xid": "/endpoints/ep1/messages/msg1",
  "epoch": 1,
  "name": "Blob Created",
  "isdefault": true,
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "ancestorid": "1",

  "metaurl": "https://example.com/endpoints/ep1/messages/msg1/meta",

  "versionsurl": "https://example.com/endpoints/ep1/messages/msg1/versions",
  "versionscount": 1
}
```

#### `PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>`

A server MAY support clients creating, or updating, a
[Resource](./spec.md#resource-entity) within a
[Group](./spec.md#group-entity) via an HTTP `PATCH` or `PUT` directed to the
Resource entity.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The `$details` suffix controls whether the request is directed to the
Resource metadata or to the Resource domain-specific document. See
[Resource Metadata vs Resource Document](#resource-metadata-vs-resource-document)
for more information.

When directed to the Resource metadata, the request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>/<RESOURCES>/<RID>[$details]
Content-Type: application/json; charset=utf-8
or
PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>[$details]
Content-Type: application/json; charset=utf-8

{ ... Resource entity excluded for brevity ... }
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Resource entity excluded for brevity ... }
```

When directed to the Resource's domain-specific document, the request MUST be
of the form:

```yaml
PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>

Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING> ?
xRegistry-versionid: <STRING> ?         # Version-level attributes
xRegistry-epoch: <UINTEGER> ?
xRegistry-name: <STRING> ?
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP> ?
xRegistry-modifiedat: <TIMESTAMP> ?
xRegistry-ancestorid: <STRING> ?
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?

... Resource document excluded for brevity ... ?
```

Note that `PATCH` for Resources with domain-specific documents is not
supported.

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 201 Created
or
HTTP/1.1 303 See Other
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>
xRegistry-versionid: <STRING>
xRegistry-self: <URL>
xRegistry-xid: <XID>
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: true
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?       # If Resource is not in body
xRegistry-metaurl: <URL>
xRegistry-versionsurl: <URL>
xRegistry-versionscount: <UINTEGER>
Location: <URL> ?                      # If 201 or 303 is returned
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Resource document ...              # If <RESOURCE>url is not set
```

Where:
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.

**Examples:**

Create a new Resource:

```yaml
PUT /endpoints/ep1/messages/msg1
Content-Type: application/json; charset=utf-8
xRegistry-name: Blob Created

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

```yaml
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
xRegistry-messageid: msg1
xRegistry-versionid: 1
xRegistry-self: https://example.com/endpoints/ep1/messages/msg1
xRegistry-xid: /endpoints/ep1/messages/msg1
xRegistry-epoch: 1
xRegistry-name: Blob Created
xRegistry-isdefault: true
xRegistry-ancestorid: 1
xRegistry-metaurl: https://example.com/endpoints/ep1/messages/msg1/meta
xRegistry-versionsurl: https://example.com/endpoints/ep1/messages/msg1/versions
xRegistry-versionscount: 1
Location: https://example.com/endpoints/ep1/messages/msg1
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/1
Content-Disposition: msg1

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

Update the default Version of a Resource as xRegistry metadata:

```yaml
PUT /endpoints/ep1/messages/msg1$details
Content-Type: application/json; charset=utf-8

{
  "epoch": 1,
  "name": "Blob Created",
  "description": "a cool event",

  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/1

{
  "messageid": "msg1",
  "versionid": "1",
  "self": "https://example.com/endpoints/ep1/messages/msg1",
  "xid": "/endpoints/ep1/messages/msg1",
  "epoch": 2,
  "name": "Blob Created",
  "isdefault": true,
  "description": "a cool event",
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "ancestorid": "1",

  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  },

  "metaurl": "https://example.com/endpoints/ep1/messages/msg1/meta",

  "versionsurl": "https://example.com/endpoints/ep1/messages/msg1/versions",
  "versionscount": 1
}
```

#### `POST /<GROUPS>/<GID>/<RESOURCES>/<RID>`

A server MAY support clients creating, or updating, a single
[Version](./spec.md#version-entity) of a
[Resource](./spec.md#resource-entity) via an HTTP `POST` directed to the
Resource entity.

The processing of this API is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The `$details` suffix controls whether the request is directed to the
Version metadata or to the Version domain-specific document. See
[Resource Metadata vs Resource Document](#resource-metadata-vs-resource-document)
for more information.

When the `versionid` attribute is absent in the request then a new Version
MUST be created. When present, then the server MUST update the specified
Version rather than create a new one. If the specified Version does not
already exist then a new Version MUST be created.

When directed to the metadata of the Resource, the request MUST be of the form:

```yaml
POST /<GROUPS>/<GID>/<RESOURCES>/<RID>[$details]
Content-Type: application/json; charset=utf-8

{ ... Version entity excluded for brevity ... }
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Version entity excluded for brevity ... }
```

When directed to the Resource's domain-specific document, the request MUST be
of the form:

```yaml
POST /<GROUPS>/<GID>/<RESOURCES>/<RID>

Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING> ?
xRegistry-versionid: <STRING> ?         # Version-level attributes
xRegistry-epoch: <UINTEGER> ?
xRegistry-name: <STRING> ?
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP> ?
xRegistry-modifiedat: <TIMESTAMP> ?
xRegistry-ancestorid: <STRING> ?
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?

... Version document excluded for brevity ... ?
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 201 Created
or
HTTP/1.1 303 See Other
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>
xRegistry-versionid: <STRING>
xRegistry-self: <URL>
xRegistry-xid: <XID>
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: <BOOLEAN>
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?       # If Resource is not in body
Location: <URL> ?                      # If 201 or 303 is returned
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Version document excluded for brevity ...  # If <RESOURCE>url is not set
```

Where:
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.

**Examples:**

Create a new Version:

```yaml
POST /endpoints/ep1/messages/msg1
Content-Type: application/json; charset=utf-8
xRegistry-name: Blob Created

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

```yaml
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
xRegistry-messageid: msg1
xRegistry-versionid: 2
xRegistry-self: https://example.com/endpoints/ep1/messages/msg1/versions/2
xRegistry-xid: /endpoints/ep1/messages/msg1/versions/2
xRegistry-epoch: 1
xRegistry-name: Blob Created
xRegistry-isdefault: true
xRegistry-ancestorid: 1
Location: https://example.com/endpoints/ep1/messages/msg1/versions/2
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/2
Content-Disposition: msg1

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

Update a Version of a Resource as xRegistry metadata:

```yaml
POST /endpoints/ep1/messages/msg1$details
Content-Type: application/json; charset=utf-8

{
  "versionid": "1",
  "epoch": 1,
  "name": "Blob Created",
  "description": "a cool event",

  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/1

{
  "messageid": "msg1",
  "versionid": "1",
  "self": "https://example.com/endpoints/ep1/messages/msg1/versions/1",
  "xid": "/endpoints/ep1/messages/msg1/versions/1",
  "epoch": 2,
  "name": "Blob Created",
  "isdefault": true,
  "description": "a cool event",
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "ancestorid": "1",

  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  }
}
```

#### `DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>`

A server MAY support clients deleting a
[Resource](./spec.md#resource-entity) via an HTTP `DELETE` directed
to the Resource entity.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete a Resource:

```yaml
DELETE /endpoints/ep1/messages/msg1
```

```
HTTP/1.1 204 No Content
```

Delete a Resource, verifying its `epoch` value:

```yaml
DELETE /endpoints/ep1/messages/msg1?epoch=5
```

```
HTTP/1.1 204 No Content
```

### Meta Entity

#### `GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`

A server MAY support clients retrieving a
[Resource's Meta entity](./spec.md#meta-entity) via an HTTP `GET` directed
to the Resource's Meta entity.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Meta entity excluded for brevity ...  }
```

**Examples:**

Retrieve a Resource's Meta entity:

```yaml
GET /endpoints/ep1/messages/msg1/meta
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "messageid": "msg1",
  "self": "https://example.com/endpoints/ep1/messages/msg1/meta",
  "xid": "/endpoints/ep1/messages/msg1/meta",
  "epoch": 2,
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "compatibility": "none",
  "defaultversionid": "v2.0",
  "defaultversionurl": "https://example.com/endpoints/ep1/messages/msg1/versions/v2.0",
  "defaultversionsticky": false
}
```

#### `PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`

A server MAY support clients updating a
[Resource's Meta entity](./spec.md#meta-entity) via an HTTP `PATCH` or
`PUT` directed to the Resource's Meta entity.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta
Content-Type: application/json; charset=utf-8
or
PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta
Content-Type: application/json; charset=utf-8

{ ... Meta entity excluded for brevity ... }
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Meta entity excluded for brevity ... }
```

**Examples:**

Update a Resource's `defaultversionid` attribute:

```yaml
PATCH /endpoints/ep1/messages/msg1/meta
Content-Type: application/json; charset=utf-8

{
  "defaultversionid": "v1.0"
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "messageid": "msg1",
  "self": "https://example.com/endpoints/ep1/messages/msg1/meta",
  "xid": "/endpoints/ep1/messages/msg1/meta",
  "epoch": 2,
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "compatibility": "none",
  "defaultversionid": "v1.0",
  "defaultversionurl": "https://example.com/endpoints/ep1/messages/msg1/versions/v1.0",
  "defaultversionsticky": true
}
```

#### `DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/meta`

A `DELETE` directed to the Meta entity is not supported and MUST generate an
error ([action_not_supported](./spec.md#action_not_supported)).

### Version Entity

#### `GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`

A server MAY support clients retrieving the
[`versions` collection](./spec.md#versions-collection) of a
[Resource](./spec.md#resource-entity) via an HTTP `GET` directed to the
owning Resource's `versions` collection URL.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <URL>;rel=next;count=<UINTEGER> ?

{
  "<KEY>": {                                    # The versionid
    ... Version entity excluded for brevity ...
  } *
}
```

**Examples:**

Retrieve all Versions of a `message` Resource:

```yaml
GET /endpoints/ep1/messages/msg1/versions
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Link: <https://example.com/endpoints/ep1/messages/msg1/versions&page=2>;rel=next;count=100

{
  "1.0": {
    "messageid": "msg1",
    "versionid": "1.0",
    "self": "https://example.com/endpoints/ep1/messages/msg1/versions/1.0",
    "xid": "/endpoints/ep1/messages/msg1/versions/1.0",
    "epoch": 1,
    "name": "Blob Created",
    "isdefault": true,
    "createdat": "2024-04-30T12:00:00Z",
    "modifiedat": "2024-04-30T12:00:01Z",
    "ancestorid": "1.0"
  }
}
```

#### `PATCH` and `POST /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`

A server MAY support clients creating/updating one or more
[Versions](./spec.md#version-entity), of a
[Resource](./spec.md#resource-entity) via an HTTP `PATCH` or `POST` directed
to the owning Resource's
[`versions` collection](./spec.md#versions-collection) URL.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section - see the discussion of the
`POST/PATCH <PATH-TO-COLLECTION>` variants.

The request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions
Content-Type: application/json; charset=utf-8
or
POST /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions
Content-Type: application/json; charset=utf-8

{
  "<KEY>": {                                      # versionid
     ... Version entity excluded for brevity ...
  } *
}
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "<KEY>": {                                      # versionid
     ... Version entity excluded for brevity ...
  } *
}
```

**Examples:**

Update several Versions (adding a label):

```yaml
PATCH /endpoints/ep1/messages/msg1/versions
Content-Type: application/json; charset=utf-8

{
  "1": {
    "labels": { "customer": "abc" }
  },
  "2": {
    "labels": { "customer": "abc" }
  },
  "3": {
    "labels": { "customer": "abc" }
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "1": {
    "messageid": "msg1",
    "versionid": "1",
    "labels": { "customer": "abc" },
    # Remainder of Version entity excluded for brevity
  },
  "2": {
    "messageid": "msg1",
    "versionid": "2",
    "labels": { "customer": "abc" },
    # Remainder of Version entity excluded for brevity
  },
  "3": {
    "messageid": "msg1",
    "versionid": "3",
    "labels": { "customer": "abc" },
    # Remainder of Version entity excluded for brevity
  }
}
```

Note that in this case, the new "label" replaces all existing labels; it is
not a "merge" operation because all attributes need to be specified in their
entirety.

#### `DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions`

A server MAY support clients deleting one or more
[ Versions](./spec.md#version-entity) within a specified
[Resource](./spec.md#resource-entity) via an HTTP `DELETE` directed to the
owning Resource's [`versions` collection](./spec.md#versions-collection) URL.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions

{
  "<KEY>": {                            # versionid
    "epoch": <UINTEGER> ?
  } *
} ?
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete multiple Versions:

```yaml
DELETE /endpoints/ep1/messages/msg1/versions

{
  "v1.0": {
    "epoch": 5
  },
  "v2.0": {}
}
```

```
HTTP/1.1 204 No Content
```

Notice that the `epoch` value for `v1.0` will be verified prior to the
delete, but no such check will happen for `v2.0`.

#### `GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`

A server MAY support clients retrieving a
[ Version](./spec.md#version-entity) of a
[ Resource](./spec.md#resource-entity) via an HTTP `GET` directed to the
Version entity.

The request MUST be of the form:

```yaml
GET /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>[$details]
```

Where the `$details` suffix controls whether the request is directed to the
Version metadata or to the Version domain-specific document. See
[Resource Metadata vs Resource Document](#resource-metadata-vs-resource-document)
for more information.

When `$details` is used, or the Resource is not configured to have a
domain-specific document, then a successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  ... Version entity excluded for brevity ...
}
```

When `$details` is not used and the Resource is configured to have a
domain-specific document, then a successful response MUST either return the
Version's domain-specific document, or an HTTP redirect to
the `<RESOURCE>url` value if set.

In the case of returning the Version's domain-specific document, the response
MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 303 See Other
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>
xRegistry-versionid: <STRING>
xRegistry-self: <URL>
xRegistry-xid: <XID>
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: <BOOLEAN>
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
Location: <URL> ?                        # If 303 is returned
Content-Disposition: <STRING> ?

... Version document ...                 # If <RESOURCE>url is not set
```

Where:
- `Content-Disposition` SHOULD be present and if so, MUST be the `<RESOURCE>id`
  value. This allows for HTTP tooling that is not aware of xRegistry to know
  the desired filename to use if the HTTP body were to be written to a file.
- `Location`, if present, and `<RESOURCE>url` MUST have the same value.

**Examples:**

Retrieve a specific Version of a `schema` Resource as xRegistry metadata:

```yaml
GET /schemagroups/g1/schemas/myschema/versions/1.0$details
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "schemaid": "myschema",
  "versionid": "1.0",
  "self": "https://example.com/schemagroups/g1/schemas/myschema/versions/1.0",
  "xid": "/schemagroups/g1/schemas/myschema/versions/1.0",
  "epoch": 2,
  "isdefault": true,
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "ancestorid": "1.0"
}
```

Retrieve the domain-specific document of the same schema Resource:

```yaml
GET /schemagroups/g1/schemas/myschema/versions/1.0
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
xRegistry-schemaid: myschema
xRegistry-versionid: 1.0
xRegistry-self: https://example.com/schemagroups/g1/schemas/myschema/versions/1.0
xRegistry-xid: /schemagroups/g1/schemas/myschema/versions/1.0
xRegistry-epoch: 2
xRegistry-isdefault: true
xRegistry-createdat: 2024-04-30T12:00:00Z
xRegistry-modifiedat: 2024-04-30T12:00:01Z
xRegistry-ancestorid: 1.0
Content-Disposition: myschema

{ ... Contents of a schema doc excluded for brevity ...  }
```

#### `PATCH` and `PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`

A server MAY support clients creating or updating a
[Version](./spec.md#version-entity) of a
[Resource](./spec.md#resource-entity) via an HTTP `PATCH` or `PUT` directed
to the Version.

The processing of these APIs is defined in the [Creating or Updating
Entities](#creating-or-updating-entities) section.

The `$details` suffix controls whether the request is directed to the
Resource metadata or to the Resource domain-specific document. See
[Resource Metadata vs Resource Document](#resource-metadata-vs-resource-document)
for more information.

When directed to the Version metadata, the request MUST be of the form:

```yaml
PATCH /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>[$details]
Content-Type: application/json; charset=utf-8
or
PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>[$details]
Content-Type: application/json; charset=utf-8

{ ... Version entity excluded for brevity ... }
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{ ... Version entity excluded for brevity ... }
```

When directed to the Version's domain-specific document, the request MUST be
of the form:

```yaml
PUT /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>

Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING> ?
xRegistry-versionid: <STRING> ?         # Version-level attributes
xRegistry-epoch: <UINTEGER> ?
xRegistry-name: <STRING> ?
xRegistry-isdefault: <BOOLEAN>
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP> ?
xRegistry-modifiedat: <TIMESTAMP> ?
xRegistry-ancestorid: <STRING> ?
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?

... Version document excluded for brevity ... ?
```

Note that `PATCH` for Resources with domain-specific documents is not
supported.

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 201 Created
or
HTTP/1.1 303 See Other
Content-Type: <STRING> ?
xRegistry-<RESOURCE>id: <STRING>
xRegistry-versionid: <STRING>
xRegistry-self: <URL>
xRegistry-xid: <XID>
xRegistry-epoch: <UINTEGER>
xRegistry-name: <STRING> ?
xRegistry-isdefault: <BOOLEAN>
xRegistry-description: <STRING> ?
xRegistry-documentation: <URL> ?
xRegistry-icon: <URL> ?
xRegistry-labels.<KEY>: <STRING> *
xRegistry-createdat: <TIMESTAMP>
xRegistry-modifiedat: <TIMESTAMP>
xRegistry-ancestorid: <STRING>
xRegistry-format: <STRING> ?
xRegistry-formatvalidated: <BOOLEAN> ?
xRegistry-formatvalidatedreason: <STRING> ?
xRegistry-compatibilityvalidated: <BOOLEAN> ?
xRegistry-compatibilityvalidatedreason: <STRING> ?
xRegistry-<RESOURCE>url: <URL> ?       # If Resource is not in body
Location: <URL> ?                      # If 201 or 303 is returned
Content-Location: <URL> ?
Content-Disposition: <STRING> ?

... Version document ...               # If <RESOURCE>url is not set
```

**Examples:**

Create a new Version:

```yaml
PUT /endpoints/ep1/messages/msg1/versions/v2.0
Content-Type: application/json; charset=utf-8
xRegistry-name: Blob Created v2

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

```yaml
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
xRegistry-messageid: msg1
xRegistry-versionid: v2.0
xRegistry-self: https://example.com/endpoints/ep1/messages/msg1/versions/v2.0
xRegistry-xid: /endpoints/ep1/messages/msg1/versions/v2.0
xRegistry-epoch: 1
xRegistry-name: Blob Created v2
xRegistry-isdefault: true
xRegistry-ancestorid: v1.0
Location: https://example.com/endpoints/ep1/messages/msg1/versions/v2.0
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/v2.0
Content-Disposition: msg1

{ ... Definition of "Blob Created" event (document) excluded for brevity ... }
```

Update a Version of a Resource as metadata:

```yaml
PUT /endpoints/ep1/messages/msg1/versions/v2.0$details
Content-Type: application/json; charset=utf-8

{
  "name": "Blob Created v2",
  "description": "a cool event",
  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  }
}
```

```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Location: https://example.com/endpoints/ep1/messages/msg1/versions/v2.0

{
  "messageid": "msg1",
  "versionid": "v2.0",
  "self": "https://example.com/endpoints/ep1/messages/msg1/versions/v2.0",
  "xid": "/endpoints/ep1/messages/msg1/versions/v2.0",
  "epoch": 2,
  "name": "Blob Created v2",
  "isdefault": true,
  "description": "a cool event",
  "createdat": "2024-04-30T12:00:00Z",
  "modifiedat": "2024-04-30T12:00:01Z",
  "ancestorid": "v1.0",

  "message": {
    # Updated definition of a "Blob Created" event excluded for brevity
  }
}
```

#### `DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>`

A server MAY support clients deleting a
[Version](./spec.md#version-entity) of a
[Resource](./spec.md#resource-entity) via an HTTP `DELETE` directed to the
Version entity.

The processing of this API is defined in the
[Deleting Entities](./spec.md#deleting-entities) section of the
[core specification](./spec.md).

The request MUST be of the form:

```yaml
DELETE /<GROUPS>/<GID>/<RESOURCES>/<RID>/versions/<VID>
```

A successful response MUST be of the form:

```yaml
HTTP/1.1 200 OK
or
HTTP/1.1 204 No Content
```

**Examples:**

Delete a Version:

```yaml
DELETE /endpoints/ep1/messages/msg1/versions/1.0
```

```
HTTP/1.1 204 No Content
```

Delete a Version, verifying its `epoch` value:

```yaml
DELETE /endpoints/ep1/messages/msg1/versions/1.0?epoch=5
```

```
HTTP/1.1 204 No Content
```

## xRegistry Discovery

As defined by the [core specification](./spec.md#xregistry-discovery), clients
MAY query an xRegistry server for the list of additional xRegistry servers
that might be of interest. If supported, the Registry-based discovery file,
for an HTTP server, MUST be available at the root of the Registry (e.g. as a
sibling API to `/model`) via the `/.xregistry` API:

```yaml
GET /.xregistry
```

A successful response MUST be of the form:
```yaml
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "registries": [
    "URL", *
  ]
}
```

Note that unlike the [Host-based Discovery](./spec.md#host-based-discovery)
mechanism, this API includes a dot (`.`) before `xregistry` to avoid any
potential name collisions with the xRegistry's data.

## Request Flags / Query Parameters

The [core xRegistry specification](./spec.md) defines a set of
[request flags](./spec.md#request-flags) that MAY be used to control the
processing of requests as well as influence how response messages are
generated. Each flag is mapped to an HTTP query parameter per the following
rules:

- When the flag is a boolean type of flag then it MUST be serialized
  as `?FLAG_NAME`, all lower case.
- When the flag has a single value associated with it, then it MUST be
  serialized as `?FLAG_NAME=VALUE`, where the `FLAG_NAME` MUST be all
  lower case. The flag MUST NOT be specified more than once.
- When the flag allows for multiple values, then each value MUST be
  serialized as a separate query parameter per the previous bullets.

There are exceptions to these rules as specified by the following:

### `?filter` Flag

A server MAY support the `?filter` query parameter allowing clients to reduce
the response entities to just the ones that match certain criteria.

See [Filter Flag](./spec.md#filter-flag) for more information.

This query parameter MUST be serialized as:

```yaml
?filter=<EXPRESSION>[,...]*
```

Where:
- All `<EXPRESSION>` values within the scope of one `?filter` query parameter
  MUST be evaluated as a logical `AND` per the
  [core specification](./spec.md#filter-flag).
- The `?filter` query parameter MAY appear multiple times and if so MUST
  be evaluated as a logical `OR` with the other `?filter` query parameters that
  appear - per the [core specification](./spec.md#filter-flag).

The abstract processing logic would be:
- For each `?filter` query parameter, find all entities that satisfy all
  `<EXPRESSION>` values for that `?filter`. Each will result in a sub-tree of
  entities.
- After processing all individual `?filter` query parameters, combine those
  sub-trees into one result set and remove any duplicates - adjusting any
  collection `url` and `count` values as needed.

### `?ignore` Flag

A server MAY support the `?ignore` query parameter on any write operation
to indicate that certain aspects of the request message MUST be ignored
by the server.

See [Ignore Flag](./spec.md#ignore-flag) for more information.

This query parameter MUST be serialized as:
```yaml
?ignore[=<value>[,...]*]
```

Where:
- `<value>` indicates which aspect of the request message to ignore.
- A value of `*` is an alias for all server supported values.
- No value, or an empty string, is an alias for `*`.
- The `?ignore` query parameter MAY be specified more than once.

### `?inline` Flag

A server MAY support the `?inline` query parameter on any request to indicate
which nested collections/objects, or potentially large attributes, are to be
included in the response message.

See [Inline Flag](./spec.md#inline-flag) for more information.

This query parameter MUST be serialized as:

```yaml
?inline[=<PATH>[,...]*]
```

Where:
- `<PATH>` is as defined in [Inline Flag](./spec.md#inline-flag).
- The value portion of the `?inline` query parameter MAY Include a single
  `<PATH>` value or be a comma-separated list of `<PATH>` values.
- The `?inline` query parameter MAY be specified more than once.

### `?sort` Flag

A server MAY support the `?sort` query parameter on any request directed to
a collection of Groups, Resources or Versions.

See [Sort Flag](./spec.md#sort-flag) for more information.

This query parameter MUST be serialized as:

```yaml
?sort=<ATTRIBUTE>[=asc|desc]
```

## HTTP Header Values

Some attributes can contain arbitrary UTF-8 string content,
and per [RFC7230, section 3][rfc7230-section-3], HTTP headers MUST only use
printable characters from the US-ASCII character set, and are terminated by a
CRLF sequence with OPTIONAL whitespace around the header value.

When encoding an attribute's value as an HTTP header, it MUST be
percent-encoded as described below. This is compatible with [RFC3986, section
2.1][rfc3986-section-2-1] but is more specific about what needs
encoding. The resulting string SHOULD NOT be further encoded.
(Rationale: quoted string escaping is unnecessary when every space
and double-quote character is already percent-encoded.)

When decoding an HTTP header into an attribute's value, any HTTP header
value MUST first be unescaped with respect to double-quoted strings,
as described in [RFC7230, section 3.2.6][rfc7230-section-3-2-6]. A single
round of percent-decoding MUST then be performed as described
below. HTTP headers for attribute values do not support
parenthetical comments, so the initial unescaping only needs to handle
double-quoted values, including processing backslash escapes within
double-quoted values. Header values produced via the
percent-encoding described here will never include double-quoted
values, but they MUST be supported when receiving events, for
compatibility with older versions of this specification which did
not require double-quote and space characters to be percent-encoded.

Percent encoding is performed by considering each Unicode character
within the attribute's canonical string representation. Any
character represented in memory as a [Unicode surrogate
pair][surrogate-pair] MUST be treated as a single Unicode character.
The following characters MUST be percent-encoded:

- Space (U+0020).
- Double-quote (U+0022).
- Percent (U+0025).
- Any characters outside the printable ASCII range of U+0021-U+007E
  inclusive.

Space and double-quote are encoded to avoid requiring any further
quoting. Percent is encoded to avoid ambiguity with percent-encoding
itself.

Steps to encode a Unicode character:

- Encode the character using UTF-8, to obtain a byte sequence.
- Encode each byte within the sequence as `%xy` where `x` is a
  hexadecimal representation of the most significant 4 bits of the byte,
  and `y` is a hexadecimal representation of the least significant 4
  bits of the byte.

Percent-encoding SHOULD be performed using upper-case for values A-F,
but decoding MUST accept lowercase values.

When performing percent-decoding, values that have been unnecessarily
percent-encoded MUST be accepted, but encoded byte sequences which are invalid
in UTF-8 MUST generate an error ([header_error](#header_error)). For example,
"%C0%A0" is an overlong encoding of U+0020, and would be rejected.

Example: a header value of "Euro &#x20AC; &#x1F600;" SHOULD be encoded as
follows:

- The characters, 'E', 'u', 'r', 'o' do not require encoding.
- Space, the Euro symbol, and the grinning face emoji require encoding.
  They are characters U+0020, U+20AC and U+1F600 respectively.
- The encoded HTTP header value is therefore "Euro%20%E2%82%AC%20%F0%9F%98%80"
  where "%20" is the encoded form of space, "%E2%82%AC" is the encoded form
  of the Euro symbol, and "%F0%9F%98%80" is the encoded form of the
  grinning face emoji.

## Error Processing

When an error is transmitted back to clients, it SHOULD adhere to the format
specified in this section - which references the [Problem Details for HTTP
APIs](https://datatracker.ietf.org/doc/html/rfc9457) specification, and when
used, MUST be of the following form:

```yaml
HTTP/1.1 <CODE>
Content-Type: application/json; charset=utf-8

{
  "type": "<URI>",
  "title": "<STRING>",
  "detail": "<STRING>", ?
  "subject": "<STRING>", ?
  "args": {
    "<STRING>": "<STRING>", *    // arg name  -> arg value
  }, ?
  "instance": "<URL>", ?
  "source": "<STRING>", ?
  ... extension error fields ...
}
```

See the [Error Processing](./spec.md#error-processing) section in the
[core specification](./spec.md) for more information.

The following list of HTTP protocol-specific errors are defined:

<!-- start-err-def -->

### api_not_found

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#api_not_found`
* Code: `404 Not Found`
* Title: `The specified API is not supported: <subject>.`
* Subject: `<request_path>`

`request_path` MUST be the "Path" portion of the incoming request URL,
starting with `/`. E.g. `/export` if the "export" feature is not supported.

#### details_required

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#details_required`
* Code: `405 Method Not Allowed`
* Title: `$details suffix is needed when using PATCH for the entity: <subject>.`
* Subject: `<resource_xid>`

#### extra_xregistry_header

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#extra_xregistry_header`
* Code: `400 Bad Request`
* Title: `For "<subject>", xRegistry HTTP header "<name>" is not allowed on this request: <error_detail>.`
* Subject: `<request_path>`
* Args:
  - `name`: The invalid xRegistry HTTP header name.
  - `error_detail`: Specific details about the error.

#### header_error

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#header_error`
* Code: `400 Bad Request`
* Title: `For "<subject>", there was an error processing HTTP header "<name>": <error_detail>.`
* Subject: `<request_path>`
* Args:
  - `name`: The HTTP header name.
  - `error_detail`: Specific details about the error.

#### missing_body

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#missing_body`
* Code: `400 Bad Request`
* Title: `For "<subject>", the request is missing an HTTP body - try '{}'.`
* Subject: `<request_path>`

#### missing_versions

* Type: `https://github.com/xregistry/spec/blob/main/core/http.md#missing_versions`
* Code: `400 Bad Request`
* Title: `For "<subject>", at least one Version needs to be included in the request.`
* Subject: `<request_path>`

<!-- end-err-def -->

[rfc7230-section-3]: https://tools.ietf.org/html/rfc7230#section-3
[rfc7230-section-3-2-6]: https://tools.ietf.org/html/rfc7230#section-3.2.6
[rfc3986-section-2-1]: https://tools.ietf.org/html/rfc3986#section-2.1
