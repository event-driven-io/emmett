# xRegistry Service Model - Version 1.0-rc4

<!-- words: compat validatecompatibility validateformat strictvalidation -->
<!-- words: compatibilityvalidated formatvalidated -->
<!-- words: validators matchversions -->

## Abstract

This document describes the xRegistry model definition language that is used
to define custom Groups and Resources for use within an xRegistry.

Readers are strongly encouraged to read the [core xRegistry
specification](./spec.md) to learn about xRegistry itself prior to reading this
specification.

## Table of Contents

- [Overview](#overview)
- [Notations and Terminology](#notations-and-terminology)
  - [Notational Conventions](#notational-conventions)
  - [Terminology](#terminology)
- [Registry Model](#registry-model)
- [Retrieving the Registry Model](#retrieving-the-registry-model)
- [Creating or Updating the
  Registry Model](#creating-or-updating-the-registry-model)
  - [Reuse of Resource Definitions](#reuse-of-resource-definitions)
  - [Includes in the xRegistry Model Data](#includes-in-the-xregistry-model-data)

## Overview

This specification defines the format and features of the xRegistry model
language. The xRegistry model is used to define the custom
[Groups](./spec.md#group), [Resources](./spec.md#resource) and
[attributes](./spec.md#attributes-and-extensions) of the entities
managed within an xRegistry server. It will also define the
semantics, and constraints, of modifying an existing model.

## Notations and Terminology

### Notational Conventions

This specification adheres to the
[Notational Conventions](./spec.md#notational-conventions) defined in the
[core xRegistry specification](./spec.md).

### Terminology

This specification uses the following terms as defined in the
[core xRegistry specification](./spec.md):

- [Aspect](./spec.md#aspect)
- [Group](./spec.md#group)
- [Registry](./spec.md#registry)
- [Resource](./spec.md#resource)
- [Version](./spec.md#version)

## Registry Model

The Registry model defines the Groups, Resources, attributes and changes to
specification-defined attributes that define what a Registry instance supports.
This information is intended to be used by tooling that does not have
knowledge of the structure of the Registry in advance and therefore will need
to dynamically discover it.

The following sections will go into the details of how to create, retrieve
and edit the model of a Registry.

The overall format of a model definition is as follows:

```yaml
{
  "description": "<STRING>", ?
  "documentation": "<URL>", ?
  "labels": { "<STRING>": "<STRING>" * }, ?
  "attributes": {                      # Registry-level extensions
    "<STRING>": {                      # Attribute name
      "name": "<STRING>",              # Same as attribute's key
      "description": "<STRING>", ?
      "type": "<TYPE>",                # boolean, string, array, object, ...

      "enum": [ <VALUE> * ], ?         # Array of scalars of type "type"
      "strict": <BOOLEAN>, ?           # Just value in "enum"? Default=true
      "target": "<XIDTYPE>", ?         # If "type" is "xid" or "url"
      "namecharset": "<STRING>", ?     # If "type" is "object"

      "matchversions": <BOOLEAN>, ?    # Same for all Versions? Default=false
      "readonly": <BOOLEAN>, ?         # From client's POV. Default=false
      "immutable": <BOOLEAN>, ?        # Once set, can't change. Default=false
      "required": <BOOLEAN>, ?         # Default=false
      "default": <VALUE>, ?            # Scalar attribute's default value

      "attributes": { ... }, ?         # If "type" above is object
      "item": {                        # If "type" above is map,array
        "type": "<TYPE>", ?            # Map value type, or array type

        "enum": [ <VALUE> * ], ?       # Array of scalars of this item "type"
        "strict": <BOOLEAN>, ?         # Just value in "enum"? Default=true
        "target": "<XIDTYPE>", ?       # If this item "type" is xid/url
        "namecharset": "<STRING>", ?   # If this item "type" is object

        "attributes": { ... }, ?       # If this item "type" is object
        "item": { ... } ?              # If this item "type" is map,array
      }, ?

      "ifvalues": {                    # If "type" is scalar
        "<STRING>": {
          "siblingattributes": { ... } # Siblings to this "attribute"
        } *
      } ?
    } *
  },

  "groups": {
    "<STRING>": {                        # Key=plural name, e.g. "endpoints"
      "plural": "<STRING>",              # E.g. "endpoints"
      "singular": "<STRING>",            # E.g. "endpoint"
      "description": "<STRING>", ?
      "documentation": "<URL>", ?
      "icon": "<URL>", ?
      "labels": { "<STRING>": "<STRING>" * }, ?
      "modelversion": "<STRING>", ?      # Version of the group model
      "modelcompatiblewith": "<URI>", ?  # Statement of compatibility
      "attributes": { ... }, ?           # See "attributes" above
      "ximportresources": [ "<XIDTYPE>", * ], ?   # Include these Resources,
                                                  # only for "modelsource"
      "constraints": {
        "<RESOURCES>.<PATH>": {          # Resource-plural + attribute path
          "default": <VALUE>, ?          # Group specific default
          "enum": [ <VALUE> * ], ?       # Allowed subset of values
          "equals": "<PATH>" ?           # Matching Group attribute path
        } *
      }, ?

      "resources": {
        "<STRING>": {                    # Key=plural name, e.g. "messages"
          "plural": "<STRING>",          # E.g. "messages"
          "singular": "<STRING>",        # E.g. "message"
          "description": "<STRING>", ?
          "documentation": "<URL>", ?
          "icon": "<URL>", ?
          "labels": { "<STRING>": "<STRING>" * }, ?
          "modelversion": "<STRING>", ?     # Version of the resource model
          "modelcompatiblewith": "<URI>", ? # Statement of compatibility
          "maxversions": <UINTEGER>, ?   # Num Vers(>=0). Default=0, 0=unlimited
          "setversionid": <BOOLEAN>, ?   # vid settable? Default=true
          "hasdocument": <BOOLEAN>, ?       # Has separate document. Default=true
          "versionmode": "<STRING>", ?      # Ancestor processing algorithm
          "singleversionroot": <BOOLEAN>, ? # Enforce single root. Default=false
          "validateformat": <BOOLEAN>, ?    # Do Version format checks. Default=false
          "validatecompatibility": <BOOLEAN>, ? # Do Version compat checks. Default=false
          "strictvalidation": <BOOLEAN>, ?  # Block unknown format/compat. Default=false
          "typemap": <MAP>, ?               # ContentType mappings
          "attributes": { ... }, ?          # Version attributes/extensions
          "resourceattributes": { ... }, ?  # Resource attributes/extensions
          "metaattributes": { ... } ?       # Meta attributes/extensions
        } *
      } ?
    } *
  } ?
}
```

Also see the "[Includes in the xRegistry Model
Data](#includes-in-the-xregistry-model-data)" section for use of the
`$include(s)` directive in `modelsource`.

The following describes the attributes of the Registry model:

### `description`
- Type: String.
- OPTIONAL
- A human-readable description of the model.

### `labels`
- Type: Map of string-string.
- OPTIONAL.
- A set of name/value pairs that allows for additional metadata/tags to
  be associated with the model.
- If present, MUST be a map of zero or more name/value string pairs.
  See [Attributes and Extensions](./spec.md#attributes-and-extensions) for
  more information.
- Keys MUST be non-empty strings.
- Values MAY be empty strings.

### `attributes`
- Type: Map of attribute definitions where each attribute's name MUST match
  its key in the map.
- OPTIONAL.
- A set of zero or more attributes. This includes extensions and
  specification-defined/modified attributes.
- REQUIRED at specification-defined locations, otherwise OPTIONAL for
  extensions Objects.

### `attributes.<STRING>`
- Type: String.
- REQUIRED.
- The name of the attribute being defined. See `attributes.<STRING>.name`
  for more information.

### `attributes.<STRING>.name`
- Type: String.
- REQUIRED.
- The name of the attribute. MUST be the same as its key in the owning
  `attributes` map. A value of `*` indicates support for undefined
  extension names at runtime. Absence of a `*` attribute indicates lack of
  support for undefined extensions the presence of an unknown attribute at
  runtime MUST generate an ([unknown_attribute](./spec.md#unknown_attribute))
  error.

  Often `*` is used with a `type` of `any` to allow for any undefined
  extension name of any supported data type. By default, the model
  does not support undefined extensions. Note that undefined extensions, if
  supported, MUST adhere to the same rules as
  [defined extensions](./spec.md#attributes-and-extensions).

  An attribute of `*` MUST NOT use the `ifvalues` feature, but a non-`*`
  attribute MAY define an `ifvalues` attribute named `*` as long as there
  isn't already one defined for this level in the entity.

  An extension attribute MUST NOT use a name that conflicts with any
  specification-defined attribute, sub-object attribute or
  collection-related attribute names defined at the same level in the
  hierarchy. For Resource/Version attributes, this applies for both
  levels - e.g. a Version-level extension MUST NOT use a name that conflicts
  with its Resource-level attribute names.

### `attributes.<STRING>.description`
- Type: String.
- OPTIONAL.
- A human-readable description of the attribute.

### `attributes.<STRING>.type`
- Type: String.
- REQUIRED.
- The "TYPE" of the attribute being defined. MUST be one of the data types
  (in lower case) defined in [Attributes and
  Extensions](./spec.md#attributes-and-extensions).

### `attributes.<STRING>.enum`
- Type: Array of values of type `attributes.<STRING>.type`.
- OPTIONAL.
- A list of possible values for this attribute. Each item in the array MUST
  be of the type defined by `type`. When not specified, or an empty array, there
  are no restrictions on the value set of this attribute. This MUST only be
  used when the `type` is a scalar. See the `strict` attribute below.

  When specified without `strict` being `true`, this list is just a
  suggested set of values and the attribute is NOT REQUIRED to use one of
  them.

### `attributes.<STRING>.strict`
- Type: Boolean.
- OPTIONAL.
- Indicates whether the attribute restricts its values to just the array of
  values specified in `enum` or not. A value of `true` means that any
  values used that are not part of the `enum` set MUST generate an error
  ([invalid_attribute](./spec.md#invalid_attribute)).
  This attribute has no impact when `enum` is absent or an empty array.
- When not specified, the default value MUST be `true`.

### `attributes.<STRING>.target`
- Type: String.
- OPTIONAL.
- The type of entity that this attribute points to when `type` is set to `url`,
  `uri` or `xid`. `target` MUST NOT be used for any other type of attribute.
- The value of this model attribute MUST be an "xid template" of one of the
  following forms:
  - `/<GROUPS>` - a plural Group type name. An entity attribute of this
    type/target MUST reference an instance of this Group type.
  - `/<GROUPS>/<RESOURCES>` - a plural Resource type name. An entity
    attribute of this type/target MUST reference an instance of this
    Resource type, not a specific Version of the Resource.
  - `/<GROUPS>/<RESOURCES>[/versions]`. An entity attribute of this
    type/target MUST reference either an instance of this Resource type or
    an instance of a Version of this Resource type. Note the `[/versions]`
    portion of the `target` value is that exact string, including the
    square brackets.
  - `/GROUPS/<RESOURCES>/versions` - a Version of a Resource type. An entity
    attribute of this type/target MUST reference an instance of a Version
    of this Resource type, not the Resource itself.
- An `xid` entity attribute that includes a `target` value as part of
  its model definition MUST match the `target` entity type specified. An
  `xid` attribute that does not include a `target` definition has no
  such restriction and MAY be any valid `xid` value.
- A URI/URL entity attribute MAY include `target` as part of its
  definition. If so, then any runtime value that is a relative URI/URL
  (begins with `/`) MUST be an `xid` and MUST adhere to the `target` entity
  type specified, if specified. Absolute URIs/URLs are not constrained by
  the presence of a `target` value.
- Example: `/endpoints/messages`

### `attributes.<STRING>.namecharset`
- Type: String.
- OPTIONAL, and MUST only be used when `type` is `object`.
- Specifies the name of the character set that defines the allowable
  characters that can be used for the object's top-level attribute names.
  Any attempt to define a top-level attribute for this object that does
  not adhere to the characters defined by the character set name MUST
  generate an error ([invalid_attribute](./spec.md#invalid_attribute)).
- Per the [Attributes and Extensions](./spec.md#attributes-and-extensions)
  section, attribute names are normally limited to just the set of characters
  that ensure they can reliably be used in cases such as code variable names
  without the need for some escaping mechanism. However, there are
  situations where object-typed attribute names need to support additional
  characters, such as a dash (`-`), and it is known that they will never be
  used in those restricted character set situations. By setting the
  `namecharset` aspect to `extended` the server MUST allow for an extended
  set of valid characters in attribute names for this object.

  The allowed character set for attribute names within an `object` MUST also
  apply to the top-level `siblingattributes` of any `ifvalues` defined
  for those attributes.
- This specification defines two character sets:
  - `strict` - this character set is the same as the set of characters
    defined for all attribute names - see [Attributes and
    Extensions](./spec.md#attributes-and-extensions).
  - `extended` - this character set is the same as the set of characters
    defined for all map key names - see [Attributes and
    Extensions](./spec.md#attributes-and-extensions).
- When not specified, the default value MUST be `strict`.
- The value of this attribute MUST be case-insensitive.
- Implementations MAY define additional character sets, however, an attempt
  to define a model that uses an unknown character set name MUST generate an
  error ([model_error](./spec.md#model_error)). There is currently no
  mechanism defined by this specification to discover the list (or
  definition) of additional `namecharset` values supported by an
  implementation. Implementations SHOULD use their documentation to
  advertise this extension.

### `attributes.<STRING>.matchversions`
- Type: Boolean.
- OPTIONAL.
- Indicates whether all Versions of a Resource instance MUST have the same
  value for this attribute (or MUST be missing from all Versions). If an
  inconsistency is found then an error
  ([mismatched_version_attribute](spec.md#mismatched_version_attribute)) MUST
  be generated.
- This aspect MUST only be `true` for attribute definitions that:
  - Are within a [Resource type's versioned
    attributes](#groupsstringresourcesstringattributes) section.
  - Are for scalar typed attributes.
  - Are statically defined. Meaning, not defined as part of an `ifvalues` clause
    or via a `*` extension definition
  - Are not defined within an array or map. Within an object is allowed.
- When not specified, the default value MUST be `false`.

### `attributes.<STRING>.readonly`
- Type: Boolean.
- OPTIONAL.
- Indicates whether this attribute is modifiable by a client. Unless otherwise
  stated, during creation, or update, of an entity if this attribute is
  specified, then its value MUST be silently ignored by the server even if the
  value is invalid. Note that there are some readonly attributes that are
  examined by a server during a write operation (e.g. `epoch` and IDs).

  Typically, attributes that are completely under the server's control
  will be `readonly` - e.g. `self`.

- When not specified, the default value MUST be `false`.
- When the attribute name is `*` then `readonly` MUST NOT be set to `true`.

### `attributes.<STRING>.immutable`
- Type: Boolean.
- OPTIONAL.
- Indicates whether this attribute's value can be changed once it is set.
  This MUST ONLY be used for server-controlled specification-defined
  attributes, such as `specversion` and `<SINGULAR>id`, and MUST NOT be used
  for extension attributes. As such, it is only for informational purposes
  for clients.

  Once set, any attempt to update the value MUST be silently ignored by
  the server.

- When not specified, the default value MUST be `false`.

### `attributes.<STRING>.required`
- Type: Boolean
- OPTIONAL.
- Indicates whether this attribute is REQUIRED to have a non-null value.
- When set to `true`, this specification does not mandate how this
  attribute's value is populated (i.e. by a client, the server or via a
  default value), just that by the end of the server's processing of any request
  it MUST have a non-null value, and generate an error
  ([invalid_attribute](./spec.md#invalid_attribute)) if not. Note that this
  implies that a REQUIRED attribute does not mean that clients are mandated to
  include that attribute in their requests. If the attribute will automatically
  be populated by the server (e.g. it has a default value defined) the client
  MAY omit it.
- A `true` value also implies that this attribute MUST be serialized in any
  response from the server - with the exception of the optimizations
  specified for [document view](./spec.md#registry-model).
- When not specified the default value MUST be `false`.
- When the attribute name is `*` then `required` MUST NOT be set to `true`.
- When a default value (`attributes.<STRING>.default`) is defined, then this
  aspect MUST be `true`, otherwise an error
  ([model_required_true](./spec.md#model_required_true)) MUST be generated.

### `attributes.<STRING>.default`
- Type: MUST be a non-`null` value of the type specified by the
  `attributes.<STRING>.type` model attribute and MUST only be used for
  scalar types. Attempts to define a `default` value for a non-scalar type
  MUST generate an error
  ([model_scalar_default](./spec.md#model_scalar_default)).
- OPTIONAL.
- This value MUST be used to populate this attribute's value if one was
  not provided by a client. An attribute with a default value does not mean
  that its owning Object is mandated to be present; rather the attribute
  would only appear when the owning Object is present. By default,
  attributes have no default values.
- When not specified, this attribute has no default value and has the same
  semantic meaning as being absent or set to `null`.
- When a default value is specified, this attribute MUST be serialized in
  responses from servers as part of its owning entity, even if it is set to
  its default value. This means that any attribute that has a default value
  defined MUST also have its `required` aspect set to `true`.
- If the default value of an attribute changes over time, all existing
  instances of that attribute MUST retain their current values and not
  be automatically changed to the new default value. In other words, a new
  default value MUST only apply to new or subsequent updates (when set to
  `null`, which would reset it to the current default value) of existing
  instances of the attribute.
- If the attribute is defined to have an `enum` list, and its `strict` aspect
  is `true`, then if a `default` value is specified it MUST be one of those
  `enum` values.

### `attributes.<STRING>.attributes`
- Type: Object, see [`attributes`](#attributes) above.
- OPTIONAL.
- This contains the list of attributes defined as part of a nested entity.
- MAY be present when the owning attribute's `type` is `object`, otherwise it
  MUST NOT be present. It MAY be absent or an empty list if there are no
  defined attributes for the nested `object`.

### `attributes.<STRING>.item`
- Type: Object.
- REQUIRED when owning attribute's `type` is `map` or `array`.
- Defines the nested entity that this attribute references. This
  attribute MUST only be used when the owning attribute's `type` value is
  `map` or `array`.

### `attributes.<STRING>.item.type`
- Type: String.
- REQUIRED.
- The ["TYPE"](#attributesstringtype) of this nested entity.

### `attributes.<STRING>.item.enum`
- Type: Array of values of type `attributes.<STRING>.type`.
- OPTIONAL, and MUST only be used when `item.type` is a scalar.
- See [`attributes.<STRING>.enum`](#attributesstringenum) above.

### `attributes.<STRING>.item.strict`
- Type: Boolean.
- OPTIONAL, and this attribute has no impact when `item.enum` is absent or an
  empty array.
- See [`attributes.<STRING>.strict`](#attributesstringstrict) above.

### `attributes.<STRING>.item.target`
- Type: String.
- OPTIONAL, and MUST only be used when `item.type` is `url`, `uri` or `xid`.
- See [`attributes.<STRING>.target`](#attributesstringtarget) above.

### `attributes.<STRING>.item.namecharset`
- See [`namecharset`](#attributesstringnamecharset) above.
- OPTIONAL, and MUST only be used when `item.type` is `object`.

### `attributes.<STRING>.item.attributes`
- See [`attributes`](#attributes) above.
- OPTIONAL, and MUST ONLY be used when `item.type` is `object`.

### `attributes.<STRING>.item.item`
- See [`attributes.<STRING>.item`](#attributesstringitem) above.
- REQUIRED when `item.type` is `map` or `array`.

### `attributes.<STRING>.ifvalues`
- Type: Map where potential runtime values of the attribute are the keys of
  the map.
- OPTIONAL.
- This map can be used to conditionally include additional
  attribute definitions based on the runtime value of the current attribute.
  If the string serialization of the runtime value of this attribute matches
  the `ifvalues` key (case-insensitive), then the `siblingattributes` MUST be
  included in the model as siblings to this attribute.

  While maps will automatically prevent two entries
  with the same key, they will not prevent two entries that only differ
  in case. Therefore, during a model update, servers MUST ensure that no
  two entries are the same irrespective of case, otherwise an
  error ([model_error](./spec.md#model_error)) MUST be generated.

  If attribute's `enum` aspect is not empty and its `strict` aspect is `true`
  then this map MUST NOT contain any value that is not specified in the `enum`
  array.

  This aspect MUST only be used for scalar attributes.

  All attributes defined for this `ifvalues` MUST be unique within the scope
  of this `ifvalues` and MUST NOT match a named attribute defined at this
  level of the entity. If multiple `ifvalues` sections, at the same entity
  level, are active at the same time then there MUST NOT be duplicate
  `ifvalues` attribute names between those `ifvalues` sections and a runtime
  error ([invalid_attribute](./spec.md#invalid_attribute)) MUST be generated.
- `ifvalues` `<STRING>` MUST NOT be an empty string.
- `ifvalues` `<STRING>` MUST NOT start with the `^` (caret) character as
  its presence at the beginning of `<STRING>` is reserved for future use.
- `ifvalues` `siblingattributes` MAY include additional `ifvalues`
  definitions.

### `groups`
- Type: Map where the key MUST be the plural name (`groups.plural`) of the
  Group type (`<GROUPS>`) being defined.
- REQUIRED if there are any Group types defined for the Registry.
- A set of zero or more Group types supported by the Registry.

### `groups.<STRING>`
- Type: String.
- REQUIRED.
- The name of the Group being defined. See `groups.<STRING>.plural`
  for more information.

### `groups.<STRING>.plural`
- Type: String.
- REQUIRED.
- MUST be immutable.
- The plural name of the Group type e.g. `endpoints` (`<GROUPS>`).
- MUST be unique across all Group types (plural and singular names) in the
  Registry.
- MUST be non-empty and MUST be a valid attribute name with the exception
  that it MUST NOT exceed 57 characters (not 63).

### `groups.<STRING>.singular`
- Type: String.
- REQUIRED.
- MUST be immutable.
- The singular name of a Group type e.g. `endpoint` (`<GROUP>`).
- MUST be unique across all Group types (plural and singular names) in the
  Registry.
- MUST be non-empty and MUST be a valid attribute name. For clarity, it
  MUST NOT exceed 63 characters.

### `groups.<STRING>.description`
- Type: String.
- OPTIONAL
- A human-readable description of the Group type.

### `groups.<STRING>.icon`
- Type: URL.
- OPTIONAL
- A URL to the icon for the Group type.
- See [`icon`](./spec.md#icon-attribute) for more information.

### `groups.<STRING>.labels`
- See [`labels`](#labels) above.
- OPTIONAL.

### `groups.<STRING>.modelversion`
- Type: String.
- OPTIONAL.
- The version of the model of the Group type.
- It is common to use a combination of major and minor version numbers.
- Example: `1.2`

### `groups.<STRING>.modelcompatiblewith`
- Type: URI.
- OPTIONAL.
- References / represents an xRegistry model definition that
  the Group type is compatible with. This is meant to express
  interoperability between models in different xRegistries via a
  shared compatible model.
- Does not imply runtime validation of the claim.
- Example: `https://xregistry.io/xreg/xregistryspecs/schema-v1/docs/model.json`

### `groups.<STRING>.attributes`
- See [`attributes`](#attributes) above.
- OPTIONAL.

### `groups.<STRING>.ximportresources`
- OPTIONAL.
- See [Reuse of Resource Definitions](#reuse-of-resource-definitions) for
  more information.

### `groups.<STRING>.constraints`

The `constraints` map defines a set of rules that can be used to govern
the attribute values in Resource instances within instances of this Group type.

These restrictions are designed to only allow subsetting of the constraints
specified by the Resource type model. They MUST NOT be used to extend the
allowable values of the attributes being constrained.

The format of a constraint map MUST adhere to the following:

```yaml
"constraints": {
  "<RESOURCES>.<PATH>": {          # Resource-plural + attribute path
    "default": <VALUE>, ?          # Group specific default
    "enum": [ <VALUE> * ], ?       # Allowed subset of values
    "equals": "<PATH>" ?           # Matching Group attribute path
  }
}
```

More details about each part of the constraints are defined in the following
sections.

These constraints MUST be applied to all instances of this Group type. Group
instances MAY choose to add additional entries, or further restrict the ones
defined here, via use of the Group instance's
[`constraints` attribute](./spec.md#constraints-attribute).

The constraints MUST be applied to all Versions of all Resources in the Group
instances, and generate an error
([constraint_failure](./spec.md#constraint_failure)) if a violation is
detected.

When possible these constraints are best described when defining the Resource
attributes in question, rather than here. However, there are cases where this
might not be possible, such as when Resources are added to a Group type via the
`ximportresources` feature, Resources are added to Groups via the `xref`
features, or defining a relationship between Group and Resource attributes -
such is the case for the `equals` constraint defined below.

Inclusion of a Resource in a Group instance via the
[`meta.xref`](./spec.md#cross-referencing-resources) mechanism introduces
some special considerations. The following describes how the aspects of
a constraint are applied to such xref'd Resources:
- The `enum` and `equals` constraints, if specified, MUST be adhered to by the
  Resource. Note that this includes changes to the Resource in its original
  location that would then violate any of the Groups' constraints that xref
  that Resource.
- The `default` values specified MUST NOT be applied to the Resource since
  its presence in the Group is just a "reference" (or "read-only"). Write
  operations on the Resource need to be done in its original location.

### `groups.<STRING>.constraints.<RESOURCES>.<PATH>`

This map key MUST reference the Resource attribute that is to be constrained.
It MUST reference a scalar attribute (top-level, or nested within objects) but
MUST NOT reference items in arrays or maps. It MUST only reference
statically-defined attributes, not ones that are dynamically added via an
`ifvalues` clause or via a `*` extension definition.

The `<RESOURCES>` portion of the map key MUST be the plural name of the
Resource type being referenced.

The `<PATH>` portion of the map key MUST be a
[dot (`.`) notation](spec.md#xregistry-dot--notation) traversal to
the Resource attribute being constrained.

### `groups.<STRING>.constraints.<RESOURCES>.<PATH>.default`

This aspect defines the default value that MUST be used for the referenced
Resource attribute. This Group type value MUST override any default value
specified in the model for that attribute.

See the [attribute `default` aspect](#attributesstringdefault) for additional
information concerning default value processing, as they apply here as well
with one exception: adding a default value here does not mandate that the
referenced Resource attribute's `required` aspect be set to `true`.
However, it would have the same net effect at runtime because a value would
always be defined for that attribute.

Note, if the constraint does not define a new `enum` set, but a `default` value
is defined, then if the referenced attribute has an `enum` set and has its
`strict` aspect set to `true` then this `default` value MUST be one of those
`enum` values.

### `groups.<STRING>.constraints.<RESOURCES>.<PATH>.enum`

This aspect defines the set of values that the referenced Resource attribute
MUST be restricted to regardless of whether the Resource's
[`strict`](#attributesstringstrict) attribute is set to `true` or not. The
list's values MUST be valid per the Resource attribute's model definition
(i.e. a proper subset of any `enum` defined if the Resource's `enum` is
[`strict`](#attributesstringstrict), and of the same type).

As with the [`enum` attribute](#attributesstringenum) defined for attributes,
an empty `enum` list in a constraint MUST be treated the same as no `enum`
aspect at all and no further constraints on the allowable attribute values are
applied beyond what the attribute itself defines.

If an `enum` set is defined, but a constraint `default` value is not, then
any `default` value specified in the attribute itself MUST be part of the
`enum` set.

### `groups.<STRING>.constraints.<RESOURCES>.<PATH>.equals`

Use of this aspect within a constraint MAY be used to ensure that the specified
attribute in all Versions of all Resources within a Group instance is present
with the same value as the specified `equals` attribute in the Group instance.

When specified with an empty string, it MUST be treated as if it were not
specified at all.

When present, this aspect MUST contain the
[dot (`.`) notation](spec.md#xregistry-dot--notation) path in the
Group instance that the referenced Resource attribute MUST match.

If the Group and Resource attributes are not of the same scalar `type` then
an error ([model_error])(./spec.md#model_error) MUST be generated.

If the referenced Group attribute does not have a value at runtime, then the
`equals` constraint enforcement for the Resource attribute MUST be silently
ignored.

This attribute MUST reference a statically defined Group attribute. In other
words, it can not reference an attribute defined by an `ifvalues` clause or a
`*` extension definition. Nor can it reference an attribute within an array.

If the Group attribute is not defined at part of the the model, then an error
([model_error])(./spec.md#model_error) MUST be generated.

Note that this feature has similar results to setting the Resource attribute's
`matchversions` aspect to `true`.
`matchversions` aspect to `true`.

### `groups.<STRING>.resources`
- Type: Map where the key MUST be the plural name (`groups.resources.plural`)
  of the Resource type (`<RESOURCES>`) being defined.
- REQUIRED if there are any Resource types defined for the Group type.
- A set of zero or more Resource types defined for the Group type.

### `groups.<STRING>`.resources.<STRING>`
- Type: String.
- REQUIRED.
- The name of the Resource being defined. See
  `groups.<STRING>.resources.<STRING>.plural` for more information.

### `groups.<STRING>.resources.<STRING>.plural`
- Type: String.
- REQUIRED.
- MUST be immutable.
- The plural name of the Resource type e.g. `messages` (`<RESOURCES>`).
- MUST be non-empty and MUST be a valid attribute name with the exception
  that it MUST NOT exceed 57 characters (not 63).
- MUST be unique across all Resources (plural and singular names) within the
  scope of its owning Group type.

### `groups.<STRING>.resources.<STRING>.singular`
- Type: String.
- REQUIRED.
- MUST be immutable.
- The singular name of the Resource type e.g. `message` (`<RESOURCE>`).
- MUST be non-empty and MUST be a valid attribute name with the exception
  that it MUST NOT exceed 57 characters (not 63).
- MUST be unique across all Resources (plural and singular names) within the
  scope of its owning Group type.
- When `hasdocument` is `true`, the derived `<RESOURCE>`, `<RESOURCE>base64`,
  and `<RESOURCE>url` Version attribute names MUST NOT collide with Version
  attributes defined by the Core specification or an extension specification.
  For example, a Schema Registry Resource named `format` would collide with
  the Schema specification's `format` Version attribute.

### `groups.<STRING>.resources.<STRING>.description`
- Type: String.
- OPTIONAL
- A human-readable description of the Resource type.

### `groups.<STRING>.resources.<STRING>.icon`
- Type: URL.
- OPTIONAL
- A URL to the icon for the Resource type.
- See [`icon`](./spec.md#icon-attribute) for more information.

### `groups.<STRING>.resources.<STRING>.labels`
- See [`labels`](#labels) above.
- OPTIONAL.

### `groups.<STRING>.resources.<STRING>.modelversion`
- See [`modelversion`](#groupsstringmodelversion) above.
- OPTIONAL.

### `groups.<STRING>.resources.<STRING>.modelcompatiblewith`
- See [`modelversion`](#groupsstringmodelcompatiblewith) above.
- OPTIONAL.

### `groups.<STRING>.resources.<STRING>.maxversions`
- Type: Unsigned Integer.
- OPTIONAL.
- Number of Versions that will be stored in the Registry for this Resource
  type.
- When not specified, the default value MUST be zero (`0`).
- A value of zero (`0`) indicates there is no stated limit, and
  implementations MAY prune non-default Versions at any time. This means
  it is valid for an implementation to only support one (`1`) Version when
  `maxversions` is set to `0`.
- When the limit is exceeded, implementations MUST prune Versions by
  deleting the oldest root Version first (see the
  [`versionmode`](#groupsstringresourcesstringversionmode) section for how
  oldest is determined). If the chosen Version is the current default Version,
  then for the purposes of determining which to delete, the default Version is
  removed from the collection of Versions, the list of "root" ancestors is
  recalculated and the "oldest root Version" algorithm is reapplied.
- A special case for the pruning rules is that if `maxversions` is set to
  one (1), then the "default" Version is not skipped, which means it will be
  deleted and the new Version will become "default".
- An attempt to change `maxversions` to `1` when there are existing Resource
  instances that have their `defaultversionsticky` attribute set to `true` MUST
  generate an error
  ([setdefaultversionsticky_false](spec.md#setdefaultversionsticky_false)).
  See
  [`defaultversionsticky` Attribute](spec.md#defaultversionsticky-attribute)
  for additional information.

### `groups.<STRING>.resources.<STRING>.setversionid`
- Type: Boolean (`true` or `false`, case-sensitive).
- OPTIONAL.
- Indicates whether support for client-side setting of a Version's
  `versionid` is supported.
- When not specified, the default value MUST be `true`.
- A value of `true` indicates the client MAY specify the `versionid` of a
  Version during its creation process.
- A value of `false` indicates that the server MUST choose an appropriate
  `versionid` value during creation of the Version.
- During the creation of a new Version, if `setversionid` is `false` and
  a `versionid` is provided then the server MUST generate an error
  ([versionid_not_allowed](./spec.md#versionid_not_allowed)).

### `groups.<STRING>.resources.<STRING>.hasdocument`
- Type: Boolean (`true` or `false`, case-sensitive).
- OPTIONAL.
- Indicates whether or not each Resource of this type has a domain-specific
  document associated with it. If `false` then the xRegistry metadata becomes
  "the document". Meaning, a query to the Resource's URL will return the
  xRegistry metadata and not a domain-specific document.

  A value of `true` does not mean that these Resources are guaranteed to
  have a non-empty document, and a query to the Resource MAY return an
  empty document. However, it does mean that each Resource of this type MUST
  have a separate document associated with it, even if it's empty.

  Attempts to change this value from `true` to `false` when there are existing
  Versions with domain-specific documents MUST generate an error
  ([hasdocument_violation](./spec.md#hasdocument_violation)).

  See
  [Document Resources vs Metadata-Only Resources](./spec.md#document-resources-vs-metadata-only-resources)
  for more information.

- When not specified, the default value MUST be `true`.

### `groups.<STRING>.resources.<STRING>.versionmode`
- Type: String
- OPTIONAL.
- Indicates the algorithm that MUST be used when determining how Version's
  `ancestorid` attribute is managed (or calculated).
- Implementations MAY define additional algorithms and MAY define
  additional aspects that they control, as long as those aspects do not
  conflict with specification-defined semantics.
- Regardless of the algorithm used, implementations MUST ensure that
  the `ancestorid` attribute of all Versions of a Resource accurately
  represents the relationship of the Versions prior to the completion of
  any operation that created, modifies or deletes Versions. For example, when
  the `createdat` algorithm is used and the `createdat` timestamp of a Version
  is modified, this might cause a reordering of the Versions and the
  `ancestorid` attributes might need to be changed accordingly. Similarly, the
  `defaultversionid` of the Resource might change if its
  `defaultversionsticky` attribute is `false`.
- When not specified, the default value MUST be `manual`.
- Implementations MUST support at least `manual`.
- The value of this attribute MUST be case-insensitive.

- Regardless of which algorithm is used, the following rules apply with
  respect to choosing the "newest" or "oldest" Version:
  - The "newest" Version MUST be determined by finding all "leaf" Versions
    (ones that are not referenced as an ancestor of any other Version), and
    choosing the one with the newest `createdat` timestamp. If there is more
    than one, then the one with the highest alphabetically case-insensitive
    `versionid` value MUST be chosen.
  - The "oldest" Version MUST be determined by finding all "root" Versions
    (ones that have an `ancestorid` value that points to itself), and then
    choosing the one with the oldest `createdat` timestamp. If there is more
    than one, then the one with the lowest alphabetically case-insensitive
    `versionid` value MUST be chosen.

- This specification defines the following `versionmode` algorithms:
  - `manual`
    - Ancestor Processing: typically provided by clients. During a "create"
      operation, all new Versions that do not have an `ancestorid` value
      provided MUST be sorted/processed by `versionid` (in case-insensitive
      ascending order) and the `ancestorid` value of each MUST be set to the
      current "newest Version" per the above semantics. Note that as
      each new Version is processed, it will likely become the "newest" but
      it might not if its `createdat` timestamp is in the past. If there
      is no existing Version then the new Version becomes a root and its
      `ancestorid` value MUST be its own `versionid` attribute value.
    - Deleted Ancestor: if a Version's ancestor is deleted, then it MUST become
      a root, and its `ancestorid` MUST be set to its own `versionid` value.
    - The name of this versionmode is a bit of a misnomer in that it is not
      100% "manual". As stated above, as a convenience, by default new
      Versions will point to the "newest" Version as their ancestor. If this
      behavior is not desired, then during the "create" operation, the
      `ancestorid` can be set to point to itself (or any other Version).

  - `createdat`
    - Ancestor Processing: The `ancestorid` value of each Version MUST be
      determined via examination of the `createdat` timestamp of each
      Version and the Versions sorted in ascending order, where the first
      one will be the "root" (oldest) Version and its `ancestorid` value
      MUST be its `versionid`. If there is more than one Version with the
      same `createdat` timestamp then those MUST be ordered in ascending
      case-insensitive order based on their `versionid` values.
    - When this `versionmode` is used, the `singleversionroot` aspect
      MUST be set to `true`.

  - `modifiedat`
    - This is the same as the `createdat` algorithm except that the
      `modifiedat` attribute of each Version MUST be used instead of the
      `createdat` attribute.

  - `semver`
    - Ancestor Processing: The `ancestorid` value of each Version MUST either
      be its `versionid` value (if it is the oldest Version), or the
      `versionid` of the next oldest Version per the
      [Semantic Versioning](https://semver.org/) specification's
      "precedence" ordering rules.
    - When this `versionmode` is used, the `singleversionroot` aspect
      MUST be set to `true`.

### `groups.<STRING>.resources.<STRING>.singleversionroot`
- Type: Boolean (`true` or `false`, case-sensitive).
- OPTIONAL.
- Indicates whether Resources of this type can have multiple Versions
  that represent roots of an ancestor tree, as indicated by the
  Version's `ancestorid` attribute value being the same as its own `versionid`
  attribute.
- When not specified, the default value MUST be `false`.
- A value of `true` indicates that only one Version of the Resource can
  be a root, and the server MUST generate an error
  ([multiple_roots](./spec.md#multiple_roots)) if any request results in a
  state where more than one Version of a Resource is a root of an ancestor
  tree.
- Note that the Resource's `versionmode` value might influence the permissible
  values of this aspect.
- See the
  [`singleversionroot` Policy
  Enforcement](./primer.md#1119-singleversionroot-policy-enforcement) section of
  the Primer for more information.

### `groups.<STRING>.resources.<STRING>.validateformat`
- Type: Boolean (`true` or `false`, case-sensitive).
- OPTIONAL.
- Indicates whether the server MUST validate that all Versions of this
  Resource type adhere to the rules as defined by the Version's `format`
  value.
- When not specified, the default value MUST be `false`.
- The following rules clarify the "format" validation logic:
  - When the validator is checking the Version's domain-specific document,
    it is a format-specific decision as to whether an empty document is
    valid or not.
  - Validators MUST treat a Resource with its `hasdocument` model attribute
    set to `false`, a Version with no domain-specific document even though
    `hasdocument` is `true`, and a Version with an empty domain-specific
    document as 3 variants of "the domain-specific document is
    empty (zero bytes in length)" and MUST yield the same semantic results.
  - When `hasdocument` is `true`, and a Version uses the `<RESOURCE>url`
    attribute to reference the document in an external datastore, the
    resulting [`formatvalidated`](spec.md#format-attribute) attribute on the
    Version MUST be `"false"`.
- A value of `true` indicates that the server MUST generate an error
  ([format_violation](spec.md#format_violation)) if any Version of a Resource
  instance of this Resource type does not adhere to the `format` value of that
  Version. An absent `format` value on a Version MUST be treated as a request
  to disable both "format" and "compatibility" verification logic for that
  Version.
- A value of `false` indicates that the server MUST NOT perform any `format`
  checking for Versions of Resources of this Resource type.

### `groups.<STRING>.resources.<STRING>.validatecompatibility`
- Type: Boolean (`true` or `false`, case-sensitive).
- OPTIONAL.
- Indicates whether the server MUST validate that all Versions of this
  Resource type adhere to its owning Resource's `meta.compatibility` value.
- When not specified, the default value MUST be `false`.
- A value of `true` indicates that the server MUST generate an error
  ([compatibility_violation](spec.md#compatibility_violation)) if any Version
  of a Resource instance of this Resource type does not adhere to the rules of
  the `meta.compatibility` value for that Resource's `format` value.
  See [`strictvalidation`](#groupsstringresourcesstringstrictvalidation) for
  exceptions to this requirement.
- When a Version does not have a `format` value then compatibility verification
  MUST NOT be done.
- When this model attribute is `true` then its sibling `validateformat`
  attribute MUST also be `true`.
- A value of `false` indicates that the server MUST NOT perform any
  `compatibility` checking for instances of this Resource type.
- In cases where this attribute is `false`, but there is a desire to advertise
  the external entity that has performed the validation, a `label` MAY be
  added to the Resource's model or to the Resource instance itself with this
  information.

### `groups.<STRING>.resources.<STRING>.strictvalidation`
- Type: Boolean (`true` or `false`, case-sensitive)
- OPTIONAL
- Indicates whether an unsupported Resource `meta.compatibility` or Version
  `format` values are to be treated as errors or ignored.
- This attribute only impacts server semantics when either `validateformat` or
  `validatecompatibility` are `true`. Otherwise, this attribute's value is
  ignored by the server.
- When not specified, the default value MUST be `false`.
- A value of `true` indicates that:
  - The `format` validation logic MUST generate an error
    ([format_violation](spec.md#format_violation)) if the Version's `format`
    is an unsupported value.
  - The `compatibility` validation logic MUST generate an error
    ([compatibility_violation](spec.md#compatibility_violation)) if the
    Resource's `meta.compatibility` value is an unsupported value.
- A value of `false` indicates that:
  - If the Version's `format` value is absent, then format and compatibility
    validation logic MUST NOT be performed for that Version.
  - If the Version's `format` value is not supported, then the `format`
    validation logic MUST NOT generate an error. Instead, the Version's
    `formatvalidated` and `compatibilityvalidated` attributes MUST be set to
    `false`.
  - If the Resource's `meta.compatibility` value is unsupported, then
    the Version's `compatibilityvalidated` attribute MUST be set to `false`.
- Regardless of the value of this aspect, if the Version's `format` value is
  absent, then format and compatibility validation logic MUST NOT be performed
  for that Version.

### `groups.<STRING>.resources.<STRING>.typemap`
- Type: Map where the keys and values MUST be non-empty strings.
- OPTIONAL.
- When a Resource's metadata is serialized in a response and the
  `?inline=<RESOURCE>` feature is enabled, the server will attempt to
  serialize the Resource's "document" under the `<RESOURCE>` attribute.
  However, this can only happen in two situations:<br>
  1 - The Resource document's bytes are already in the same format as
      the xRegistry metadata - in other words JSON, or<br>
  2 - The Resource's document can be considered a "string" and therefore
      can be serialized as a "string", possibly with some escaping.<br>

  For some well-known `contenttype` values (e.g. `application/json`), the
  first case can be easily determined by the server. However, for custom
  `contenttype` values the server will need to be explicitly told how to
  interpret its value (e.g. to know if it is a string or JSON).
  The `typemap` attribute allows for this by defining a mapping of
  `contenttype` values to well-known xRegistry format types.

  Since the `contenttype` value is a "media-type" per
  [RFC9110](https://datatracker.ietf.org/doc/html/rfc9110#media.type),
  for purposes of looking it up in the `typemap`, just the `type/subtype`
  portion of the value (case-insensitively) MUST be used. Meaning, any
  `parameters` MUST be excluded.

  If more than one entry in the `typemap` matches the `contenttype`, but
  they all have the same value, then that value MUST be used. If they are
  not all the same, then `binary` MUST be used.

- The key MAY include at most one `*` to act as a wildcard to mean zero or
  more instances of any character at that position in the string - similar to
  a `.*` in a regular expression. The key MUST be a case-insensitive string.

- This specification defines the following values (case-insensitive):
  - `binary`
  - `json`
  - `string`

  Implementations MAY define additional values.

  A value of `binary` indicates that the Resource's document is to be treated
  as an array of bytes and serialized under the `<RESOURCE>base64` attribute,
  even if the `contenttype` is of the same type as the xRegistry metadata
  (e.g. `application/json`). This is useful when it is desirable to not
  have the server potentially modify the document (e.g. "pretty-print" it).

  A value of `json` indicates that the Resource's document is JSON and MUST
  be serialized under the `<RESOURCE>` attribute if it is valid JSON. Note
  that if there is a syntax error in the JSON then the server MUST treat the
  document as `binary` to avoid sending invalid JSON to the client. The
  server MAY choose to modify the formatting of the document (e.g. to
  "pretty-print" it).

  A value of `string` indicates that the Resource's document is to be treated
  as a string and serialized using the default string serialization rules
  for the format being used to serialize the Resource's metadata. For
  example, when using JSON, this means escaping all non-printable characters.

  Specifying an unknown (or unsupported) value MUST generate an error
  ([model_error](./spec.md#model_error)) during the update of the xRegistry
  model.

  By default, the following
  [RFC9110](https://datatracker.ietf.org/doc/html/rfc9110#media.type)
  `typemap` keys MUST be implicitly defined as follows, unless overridden
  by an explicit `typemap` entry:
  - `application/json`: mapped to `json`
  - `*+json`: mapped to `json`
  - `text/plain`: mapped to `string`

- Example:<br>
  ```yaml
  "typemap": {
    "text/*": "string",
    "text/mine": "json"
  }
  ```

### `groups.<STRING>.resources.<STRING>.attributes`
- See [`attributes`](#attributes) above, as well as
  [`resourceattributes`](#groupsstringresourcesstringresourceattributes)
  and [`metaattributes`](#groupsstringresourcesstringmetaattributes) below.
- OPTIONAL.
- The list of attributes associated with each Version of the Resource.
- Extension attribute names at this level MUST NOT overlap with extension
  attributes defined at the `groups.resources.resourceattributes` level.
  The only duplicate names allowed are specification-defined attributes
  such as `self` and `xid`, and the Version-specific values MUST be
  overridden by the Resource-level values when serialized.

### `groups.<STRING>.resources.<STRING>.resourceattributes`
- See [`attributes`](#attributes) above.
- OPTIONAL.
- The list of attributes associated with the Resource, not its Versions,
  that will appear in the Resource itself (as siblings to the "default"
  Version attributes).
- These attributes are reserved for system-managed attributes, such as
  `metaurl`, that exist to help in the navigation of the entities. Users
  MUST NOT define additional attributes for this list. Extension
  Resource-level attributes would appear in the `metaattributes` list, while
  Version-level extensions would appear in the `attributes` list.
- While it is NOT RECOMMENDED, implementations MAY add additional attributes
  to this list if they are necessary to help with model traversal. Otherwise
  the other 2 attribute lists SHOULD be used. The goal is to make the
  Resource entity look as much like the `default` Version as possible;
  adding additional attributes at the Resource level violates that goal.

### `groups.<STRING>.resources.<STRING>.metaattributes`
- See [`attributes`](#attributes) above.
- OPTIONAL.
- The list of attributes associated with the Resource, not its Versions,
  that will appear in the `meta` sub-object of the Resource.

---

Clarifying the  usage of the `attributes`, `resourceattributes` and
`metaattributes`:
- The serialization of the Resource is meant to be (almost) interchangeable
  with the serialization of a Version of that Resource. This will allow users
  to process either entity without needing to know if they were provided the
  Resource itself or a specific Version in most cases.
- To enable this, most of the Resource-specific data (e.g. its
  `defaultversionid`), is serialized under the `meta` sub-object. This avoids
  potential name conflicts between Version and Resource-level attributes, as
  well as avoids making the serialization of the Resource too verbose/noisy.
- However, there are some Resource-level attributes, that if placed in the
  `meta` sub-object, would appear to be misplaced. For example, the `versions`
  collection attributes could be confusing to users since `meta` is not
  the direct parent/owner of the "versions" collection, the Resource is.
  Especially when considering the URL path to the "versions" collection would
  not have `/meta/` in it.
- Additionally, some common attributes (e.g. `self`) need to appear on both
  Resources as well as Versions but the values need to be different in each
  case. This is why the same attribute names can appear in both the
  `resourceattributes` and `attributes` lists, but only specification-defined
  attributes are allowed to have this naming conflict. Extensions are not, as
  that could lead to confusion for users.
- Finally, in the vast majority of cases it is expected that models will only
  need to define Version-level attributes, leaving the more advanced uses of
  Resource and Meta-level attributes to default to the specification-defined
  sets. For this reason, the Version-level attributes use a list called
  `attributes` in order to make user creation of the model easier, leaving
  the edge cases of Resource or Meta-level extension attributes to use more
  verbosely named lists.

## Retrieving the Registry Model

The Registry model is available in two forms:
- The full "model" with all possible aspects of the model defined. This
  includes user-defined model extensions as well as specification-defined
  model aspects.
- The "modelsource" form represents just the model aspects as specified when
  the model was defined or last updated by authorized users.

The full "model" view can be thought of as a full schema definition of what the
message exchanges with the server might look like. As such, it MUST include:
- Registry top-level and Group `<COLLECTION>*` attributes. While the `model`
  and `modelsource` attributes MUST appear, their definitions MAY be shallow -
  meaning, they can be defined as just `object` with one attribute (`*`) of
  type "any".
- All Group definitions, including Resource `<COLLECTION>*` attributes.
- All Resource definitions, including Version `<COLLECTION>*`, `meta` and
  `metaurl` attributes. Note that the `<RESOURCE>*` attribute would only appear
  if the
  [`hasdocument` aspect](#groupsstringresourcesstringhasdocument)
  is `true`.

The "modelsource" view of the model is just what was provided by the user when
the model was defined, or last edited. It is expected that this view of the
model is much smaller than the full model and only includes
domain-specific information. While specification-defined attributes MAY appear
in this document, they are NOT RECOMMENDED since the server will automatically
add them so users do not need to concern themselves with those details.

The modelsource document is always a semantic subset of the full model
document.

xRegistry protocol binding specifications will typically define a way to
retrieve these two model views as both stand-alone entities and
[inlined](./spec.md#inline-flag) as part of the
[Registry entity](./spec.md#registry-entity).

For the sake of brevity, this specification doesn't include the full definition
of the specification-defined attributes as part of the snippets of output.
However, an example of a full model definition of a Registry can be
found in this sample [sample-model-full.json](sample-model-full.json).

When retrieving the `modelsource`, the response MUST only include what
was specified in the request to define the model - it MUST NOT include
any auto-added specification defined metadata that will appear under `model`.

## Creating or Updating the Registry Model

A server MAY support updating the model of a Registry via:
- A direct update of the `modelsource` entity, if the protocol binding
  supports exposing it as a stand-alone entity.
- Including the [`modelsource` attribute](./spec.md#modelsource-attribute)
  on a request to update the [Registry entity](./spec.md#registry-entity).

To enable support for a wide range of use cases, but to also ensure
interoperability across implementations, the following rules have been defined
with respect to how models are defined or updated:
- Changes to specification-defined attributes MAY be included in the model but
  MUST NOT change them such that they become incompatible with the
  specification. For example, changes to further constrain the allowable values
  of an attribute are typically allowed, but changing its `type` from `string`
  to `integer` is not.
- Specification-defined attributes that are `required` MUST NOT have this
  aspect changed to `false`.
- Specification-defined attributes that are `readonly` MUST NOT have this
  aspect changed to `false`.
- Specification-defined attributes that define a `default` value MUST always
  include a `default` value in their definitions.

Any specification attributes not included in a request to define, or update,
a model MUST be included in the resulting full model. In other words, the full
Registry's model consists of the specification-defined attributes overlaid
with the attributes that are explicitly-defined as part of a `modelsource`
update request.

Note: there is no mechanism defined to delete specification-defined attributes
from the model.

Registries MAY support extension attributes to the model language (meaning,
new attributes within the model definitions themselves), but only if
the server supports them. Servers MUST generate an error
([model_error](./spec.md#model_error)) if a model definition includes unknown
model language attributes.

Once a Registry has been created, changes to the model MAY be supported by
server implementations. This specification makes no statement as to what types
of changes are allowed beyond the following requirements:
- Any model change MUST result in a specification compliant model definition.
- Servers MUST ensure that the representation of all entities within the
  Registry adheres to the new model prior to completing the model update
  request.

Any request to update the model that does not adhere to those requirements
MUST generate an error
([model_compliance_error](./spec.md#model_compliance_error)).

How the server guarantees that all entities in the Registry are compliant with
the model is an implementation detail. For example, while it is
NOT RECOMMENDED, it is valid for an implementation to modify (or even delete)
existing entities to ensure model compliance. Instead, it is RECOMMENDED that
the model update requests generate an error
([model_compliance_error](./spec.md#model_compliance_error)) if existing
entities are not compliant.

For the purposes of validating that the existing entities in the Registry are
compliant with the model, the mechanisms used to define the model (e.g.
`$include` vs `ximportresources` vs defined locally) MUST NOT impact that
analysis. In other words, model updates that have no semantic changes but
rather switch between one of those 3 mechanisms MUST NOT invalidate any
existing entities in the Registry.

Additionally, it is STRONGLY RECOMMENDED that model updates be limited to
backwards compatible changes.

Implementations MAY choose to limit the types of changes made to the model,
or not support model updates at all.

The xRegistry model definition used to create a sample xRegistry can be found
[here](./sample-model.json), while the resulting "full" model (with all of the
system-defined aspects added) can be found [here](./sample-model-full.json).

### Reuse of Resource Definitions

When a Resource type definition is to be shared between Groups, rather than
creating a duplicate Resource definition, the `ximportresources` mechanism MAY
be used instead. The `ximportresources` attribute on a Group definition
allows for a list of `<XIDTYPE>` references to other Resource types to be
included within this Group.

For example, the following abbreviated model definition defines
one Resource type (`messages`) under the `messagegroups` Group, that is
also used by the `endpoints` Group.

```yaml
"modelsource": {
  "groups": {
    "messagegroups": {
      "singular": "messagegroup",
      "resources": {
        "messages": {
          "singular": "message"
        }
      }
    },
    "endpoints": {
      "singular": "endpoint",
      "ximportresources": [ "/messagegroups/messages" ]
    }
  }
}
```

The format of the `ximportresources` specification is:

```yaml
"ximportresources": [ "<XIDTYPE>", * ]
```

where:
- Each array value MUST be an `<XIDTYPE>` reference to another Group/Resource
  combination defined within the same Registry. It MUST NOT reference the
  same Group under which the `ximportresources` resides.
- An empty array MAY be specified, implying no Resources are imported.
- The definition of a Group MAY include an `ximportresources` directive
  that references a Resource from another Group that itself is defined
  via an `ximportresources`. However, transitive definitions of Resources
  MUST NOT result in a circular import chain.

Locally defined Resources MAY be defined within a Group that uses the
`ximportresources` feature; however, Resource `plural` and `singular` values
MUST be unique across all imported and locally defined Resources.

This attribute, while listed in the schema definition of `model`, and
`modelsource` for ease of reading the specification, is only available for
`modelsource`. Similar to the `$include` directive, servers MUST process any
`ximportresources` found in the `modelsource` data and the results MUST be
reflected in the `model`, but the `ximportresources` directive MUST NOT appear
in the `model` serialization.

See [Cross Referencing Resources](./spec.md#cross-referencing-resources) for
additional information.

### Includes in the xRegistry Model Data

There might be times when it is necessary for an xRegistry model to reuse
portions of another xRegistry model defined elsewhere. Rather than forcing
the duplication of the model definitions, an "include" type of JSON directive
MAY be used.

The general formats of the include are:
```yaml
"$include": "<PATH-TO-DOCUMENT>#<JSON-POINTER-IN-DOC>"
```
or
```yaml
"$includes": [ "<PATH-TO-DOCUMENT>#<JSON-POINTER-IN-DOC>" * ]
```
where the first form specifies a single reference to be included, and the
second form specifies multiple. The fragment (`#...`) portion is OPTIONAL.

For example:
```yaml
"$include": "http://example.com/xreg-model.json#/groups/mygroup/attributes"
```
is asking for the attributes of a Group called `mygroup` to be included at
this location of the current model definition.

These directives MAY be used in any JSON Object or Map entity in an
xRegistry model definition. The following rules apply to how the include
directive is processed:
- The include path reference value MUST be compatible with the environment in
  which the `include` is being evaluated. For example, in an xRegistry server it
  would most likely always be a URL. However, in an external tool the reference
  might be to a local file on disk or a URL.
- The include MUST reference a JSON Object or Map that is consistent with
  the model definition of where the include appears, and the target attributes,
  or keys, are processed in place of the `$include` attribute.
- Any attributes already present (as siblings to the include) MUST take
  precedence over an included attribute - matching is done via comparing
  the `name` of the attributes.
- When `$includes` is used, the references MUST be processed in order and
  earlier attributes included take precedence over subsequently included
  attributes.
- Both `$include` and `$includes` MUST NOT be present at the same time at the
  same level in the model.
- Included model definitions MAY use `include` directives, but MUST NOT result
  in a circular include chain.
- Resolution of the include path MUST follow standard path resolution.
  Meaning, relative paths are relative to the document with the include
  directive.
- If present, the fragment (`#...`) part of the reference MUST adhere to the
  [JSON Pointer](https://datatracker.ietf.org/doc/html/rfc6901) specification.

When the directives are used in a request to update the model, the server MUST
resolve all includes prior to updating the model. The original (source)
model definition, with any "include" directives, MUST be available via
the `modelsource` attribute/entity. The expanded model (after the resolution
of any includes, and after all specification-defined attributes have been
added), MUST be available via the `model` attribute/entity. The directives MUST
only be processed during the initial update of the model. In order to have
them re-evaluated, a subsequent model update request (with those directives)
MUST be sent.

When there is tooling used outside of the server, e.g. in an xRegistry
client, if that tooling resolves the "include" directives prior to sending
the model to the server, then the directives will not appear in the
`modelsource` view of the model. Ideally, tooling SHOULD allow users
to choose whether the resolution of the directives is done locally or by
the server.

**Examples:**

A model definition that includes xRegistry attributes from a file on a remote
server, and adds the definition of one attribute to a Group named `mygroups`
from an external Group named `group1` in another xRegistry.

```yaml
{
  "attributes": {
    "$include": "http://example.com/someattributes",
    "myattribute": {
      "name": "myattribute",
      "type": "string"
    }
  }
  "groups": {
    "mygroups": {
      "singular": "mygroup",
      "attributes": {
        "attr1": {
          "$include": "http://example.com/model#/groups/group1/attributes/attr1"
        }
        ... remainder of model excluded for brevity ...
      }
    }
  }
}
```

where `http://example.com/someattributes` might look like:

```yaml
{
  "myattr": {
    "name": "myattr",
    "type": "string"
  }
}
```

and the second include target might look like:

```yaml
{
  "name": "attr1",
  "type": "string"
}
```
