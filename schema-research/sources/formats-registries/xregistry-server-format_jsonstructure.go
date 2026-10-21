// Package registry - JSON Structure format compatibility checker.
//
// Spec: https://json-structure.github.io/core/draft-vasters-json-structure-core.html
//
// IsValid verifies that a version's document is a syntactically and
// structurally valid JSON Structure schema document (there is no
// off-the-shelf Go validator for JSON Structure, so this is a
// hand-written structural validator, similar in spirit to how
// format_avro.go and format_proto.go validate their own IDLs rather
// than delegating to a 3rd-party compiler).
//
// IsCompatible checks whether two JSON Structure schema versions are
// compatible in the given direction. JSON Structure's core spec does
// not itself define "backward"/"forward" compatibility semantics (the
// same is true of JSON Schema/Avro/Protobuf before this codebase
// added its own), so the same closed-world convention used by the
// other 3 checkers is applied here:
//
//	"backward" — consumers using the NEW schema can read messages
//	             produced with the OLD schema.
//	             Permitted changes: delete any field, add an optional
//	             field, widen a numeric type within its family
//	             (e.g. int16→int32), grow a string/binary maxLength
//	             or a decimal's precision/scale, add a choice.
//	             Forbidden changes: add a required field, narrow a
//	             constraint, remove a choice, change a tuple's length.
//	             Implemented as: old ⊆ new
//
//	"forward"  — consumers using the OLD schema can read messages
//	             produced with the NEW schema.
//	             Implemented by swapping the arguments and running the
//	             backward check (forward compat = backward compat with
//	             args swapped), same convention as the other 3 files.
//
// Compatibility/validation support, by keyword:
//
// Document structure
//   - [supported]     $schema / $id / name (presence/type checked)
//   - [supported]     type / $root (mutually exclusive at the root)
//   - [supported]     definitions (namespace tree walk, reusable
//     types indexed by JSON Pointer)
//   - [supported]     $ref (JSON Pointer only - unlike JSON Schema,
//     the core spec doesn't allow external/HTTP $ref, which makes
//     resolution simpler here than in format_jsonschema.go)
//   - [supported]     $extends / abstract (object & tuple types;
//     flattened - base properties/required merged into the subtype
//     before comparison)
//   - [not supported] $offers / $uses (add-ins are an opt-in,
//     instance-document-level mechanism, not part of the base
//     schema's own type declarations - out of scope for schema-vs-
//     schema compat checking)
//
// Primitive types
//   - [supported]     string, number, integer(=int32 alias), boolean,
//     null
//   - [supported]     int8/16/32/64/128, uint8/16/32/64/128,
//     float8/float/double, decimal, date, datetime, time, duration,
//     uuid, uri, jsonpointer, binary
//   - [supported]     numeric widening within the same family/
//     signedness only (int8→int16→int32→int64→int128,
//     uint8→...→uint128, float8→float→double), plus widening any
//     numeric extended type to the unconstrained "number" type.
//     Cross-family promotion (e.g. int32→float) is NOT supported -
//     the spec doesn't define one, unlike Avro.
//   - [supported]     maxLength (string/binary) growth/shrink
//   - [supported]     precision/scale (decimal) growth/shrink
//   - [supported]     enum / const (same subset semantics as
//     format_jsonschema.go)
//   - [not supported] contentEncoding / contentCompression /
//     contentMediaType (informational; not used for compat)
//
// Compound types
//   - [supported]     object (properties add/remove, required,
//     additionalProperties)
//   - [supported]     array / set (items, recursive)
//   - [supported]     map (values, recursive)
//   - [supported]     tuple (position-based comparison - tuples
//     serialize positionally and all elements are implicitly
//     required, so only same-length tuples with per-position
//     compatible types are considered compatible; this is more
//     conservative than object's add/remove flexibility, but is
//     correct for a positionally-encoded structure)
//   - [supported]     choice, both tagged and inline-union forms
//     (choice add/remove by tag name, analogous to Avro union-branch/
//     enum-symbol handling)
//   - [supported]     any (matches anything, like JSON Schema's
//     `true` schema)
//   - [supported]     non-discriminated unions (`type` as an array) -
//     conservative "any branch must match" checks, same style as
//     format_jsonschema.go's anyOf handling
//
// Known limitations
//   - `required` as an array-of-arrays (alternative required sets):
//     handled conservatively - only verified for compat when old and
//     new are byte-for-byte identical; otherwise treated as
//     "cannot verify", which is reported as an incompatibility.
//   - Field/property renames are not detected in `object`/`choice`
//     (only exact name matches are treated as "the same field").
//   - `$offers`/`$uses` add-ins are not applied before comparison.

package registry

import (
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"

	. "github.com/xregistry/server/common"
)

const JSON_STRUCTURE_FORMAT = "jsonstructure*"

func init() {
	RegisterFormat(JSON_STRUCTURE_FORMAT, FormatJsonStructure{})
}

type FormatJsonStructure struct{}

var jsIdentifierRegex = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// jsJSONPrimitives are the base JSON primitive type names.
var jsJSONPrimitives = map[string]bool{
	"string": true, "number": true, "integer": true,
	"boolean": true, "null": true,
}

// jsExtendedPrimitives are JSON Structure's extended primitive type names.
var jsExtendedPrimitives = map[string]bool{
	"binary": true,
	"int8":   true, "uint8": true,
	"int16": true, "uint16": true,
	"int32": true, "uint32": true,
	"int64": true, "uint64": true,
	"int128": true, "uint128": true,
	"float8": true, "float": true, "double": true,
	"decimal": true, "date": true, "datetime": true, "time": true,
	"duration": true, "uuid": true, "uri": true, "jsonpointer": true,
}

// jsCompoundTypes are JSON Structure's compound type names.
var jsCompoundTypes = map[string]bool{
	"object": true, "array": true, "set": true, "map": true,
	"tuple": true, "any": true, "choice": true,
}

const jsKindUnion = "__union__"
const jsKindInvalid = "__invalid__"

func isJSPrimitiveName(t string) bool {
	return jsJSONPrimitives[t] || jsExtendedPrimitives[t]
}

func (fjs FormatJsonStructure) IsValid(ver *Version) (bool, string, *XRError) {
	format := ver.GetAsString("format")
	if ok, _ := regexp.MatchString("(?i)"+JSON_STRUCTURE_FORMAT, format); !ok {
		return true, "", NewXRError("bad_request", ver.XID,
			"error_detail="+
				fmt.Sprintf(`Version %q has a "format" value of %q, was `+
					`expecting %q`, ver.XID, format, JSON_STRUCTURE_FORMAT))
	}

	if ver.Resource.ResourceModel.GetHasDocument() == false {
		return true, "", NewXRError("format_violation", ver.XID,
			"format="+format).
			SetDetailf(`The Resource (%s) for Version %q does not have `+
				`"hasdocument" in its resource model set to "true", and an `+
				`empty/missing document is not compliant.`,
				ver.Resource.XID, ver.XID)
	}

	if resURL := ver.Get(ver.Resource.Singular + "url"); !IsNil(resURL) {
		return false, "Data stored externally",
			NewXRError("format_external", ver.XID)
	}

	buf := []byte(nil)
	if bufAny := ver.Get(ver.Resource.Singular); !IsNil(bufAny) {
		buf = bufAny.([]byte)
	}

	if len(buf) == 0 {
		return true, "", NewXRError("format_violation", ver.XID,
			"format="+ver.GetAsString("format")).
			SetDetailf("Version %q is empty and therefore not a "+
				"valid JSON Structure file.", ver.XID)
	}

	if err := IsValidJsonStructure(buf); err != nil {
		return true, "", NewXRError("bad_request", ver.XID,
			"error_detail="+ver.XID+" is not a valid JSON Structure file: "+
				err.Error())
	}
	return true, "", nil
}

func (fjs FormatJsonStructure) IsCompatible(
	direction string,
	oldVersion *Version,
	newVersion *Version,
) (bool, string, *XRError) {
	checked, reason, xErr := fjs.IsValid(oldVersion)
	if xErr != nil {
		return checked, reason, xErr
	}

	checked, reason, xErr = fjs.IsValid(newVersion)
	if xErr != nil {
		return checked, reason, xErr
	}

	oldBuf, newBuf := []byte(nil), []byte(nil)
	if bufAny := oldVersion.Get(oldVersion.Resource.Singular); !IsNil(bufAny) {
		oldBuf = bufAny.([]byte)
	}
	if bufAny := newVersion.Get(newVersion.Resource.Singular); !IsNil(bufAny) {
		newBuf = bufAny.([]byte)
	}

	oldDoc, err := parseJSDoc(oldBuf)
	if err != nil {
		return true, "", NewXRError("bad_request", oldVersion.XID,
			"error_detail="+oldVersion.XID+
				" is not a valid JSON Structure file: "+err.Error())
	}
	newDoc, err := parseJSDoc(newBuf)
	if err != nil {
		return true, "", NewXRError("bad_request", newVersion.XID,
			"error_detail="+newVersion.XID+
				" is not a valid JSON Structure file: "+err.Error())
	}

	if err := checkJSCompat(direction, oldDoc, newDoc); err != nil {
		compat := newVersion.
			Resource.
			MustFindMeta(false).
			GetAsString("compatibility")

		return true, "", NewXRError("bad_request", newVersion.XID,
			"error_detail="+
				fmt.Sprintf("Version %q isn't %q compatible with %q: %s",
					newVersion.XID, compat, oldVersion.XID, err.Error()))
	}

	return true, "", nil
}

// ────────────────────────────────────────────────────────────────
// IsValid - structural validation
// ────────────────────────────────────────────────────────────────

// IsValidJsonStructure validates that buf is a syntactically and
// structurally valid JSON Structure schema document.
func IsValidJsonStructure(buf []byte) error {
	var doc map[string]interface{}
	if err := json.Unmarshal(buf, &doc); err != nil {
		return err
	}
	return validateJSDocument(doc)
}

func validateJSDocument(doc map[string]interface{}) error {
	if _, ok := doc["$schema"].(string); !ok {
		return fmt.Errorf(`missing/invalid required "$schema" keyword`)
	}
	if _, ok := doc["$id"].(string); !ok {
		return fmt.Errorf(`missing/invalid required "$id" keyword`)
	}
	if _, ok := doc["name"].(string); !ok {
		return fmt.Errorf(`missing/invalid required "name" keyword`)
	}

	_, hasType := doc["type"]
	rootPtr, hasRoot := doc["$root"]

	if hasType && hasRoot {
		return fmt.Errorf(`"type" and "$root" are mutually exclusive at ` +
			`the document root`)
	}

	defs := map[string]map[string]interface{}{}
	if rawDefs, ok := doc["definitions"]; ok {
		defsMap, ok := rawDefs.(map[string]interface{})
		if !ok {
			return fmt.Errorf(`"definitions" must be an object`)
		}
		if err := jsCollectDefinitions(defsMap, "#/definitions", defs); err != nil {
			return err
		}
	}

	// Validate every reusable type declaration now that the full index
	// exists (so forward-referencing $ref/$extends values resolve).
	for path, node := range defs {
		if err := validateJSSchemaNode(defs, node); err != nil {
			return fmt.Errorf("%s: %v", path, err)
		}
	}

	if hasRoot {
		ptr, ok := rootPtr.(string)
		if !ok {
			return fmt.Errorf(`"$root" must be a string JSON Pointer`)
		}
		if _, found := defs[ptr]; !found {
			return fmt.Errorf(`"$root" points to unknown definition: %s`, ptr)
		}
	} else if hasType {
		if err := validateJSSchemaNode(defs, doc); err != nil {
			return fmt.Errorf("root: %v", err)
		}
	} else {
		return fmt.Errorf(`document must have either "type" or "$root"`)
	}

	return nil
}

// jsCollectDefinitions walks the "definitions" namespace tree,
// recording every type declaration (an object containing a "type"
// keyword) at its JSON Pointer path. Anything else is a namespace and
// is recursed into.
func jsCollectDefinitions(
	ns map[string]interface{},
	path string,
	defs map[string]map[string]interface{},
) error {
	for key, val := range ns {
		if !jsIdentifierRegex.MatchString(key) {
			return fmt.Errorf("%s: invalid identifier %q", path, key)
		}
		valMap, ok := val.(map[string]interface{})
		if !ok {
			return fmt.Errorf("%s/%s: must be an object", path, key)
		}
		p := path + "/" + key
		if _, hasType := valMap["type"]; hasType {
			defs[p] = valMap
		} else {
			if err := jsCollectDefinitions(valMap, p, defs); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateJSSchemaNode(
	defs map[string]map[string]interface{},
	node map[string]interface{},
) error {
	raw, hasType := node["type"]
	if !hasType {
		return fmt.Errorf(`missing required "type" keyword`)
	}

	switch t := raw.(type) {
	case string:
		return validateJSTypeName(defs, node, t)

	case map[string]interface{}:
		ref, ok := t["$ref"].(string)
		if !ok || len(t) != 1 {
			return fmt.Errorf(`"type" object must contain only "$ref"`)
		}
		if _, found := defs[ref]; !found {
			return fmt.Errorf("$ref does not resolve: %s", ref)
		}
		return nil

	case []interface{}:
		if len(t) < 2 {
			return fmt.Errorf(`type union must have at least 2 entries`)
		}
		if _, hasEnum := node["enum"]; hasEnum {
			return fmt.Errorf(`"enum" is not permitted with a type union`)
		}
		seen := map[string]bool{}
		for _, elem := range t {
			switch e := elem.(type) {
			case string:
				if !isJSPrimitiveName(e) {
					return fmt.Errorf("union element %q must be a "+
						"primitive type (inline compound types are not "+
						"permitted in unions)", e)
				}
				if seen[e] {
					return fmt.Errorf("duplicate union type %q", e)
				}
				seen[e] = true
			case map[string]interface{}:
				ref, ok := e["$ref"].(string)
				if !ok || len(e) != 1 {
					return fmt.Errorf(`union element object must contain ` +
						`only "$ref"`)
				}
				if _, found := defs[ref]; !found {
					return fmt.Errorf("union $ref does not resolve: %s", ref)
				}
			default:
				return fmt.Errorf("invalid union element")
			}
		}
		return nil

	default:
		return fmt.Errorf(`"type" must be a string, {"$ref":...}, or array`)
	}
}

func validateJSTypeName(
	defs map[string]map[string]interface{},
	node map[string]interface{},
	t string,
) error {
	if ab, hasAb := node["abstract"]; hasAb {
		if _, ok := ab.(bool); !ok {
			return fmt.Errorf(`"abstract" must be a boolean`)
		}
		if t != "object" && t != "tuple" {
			return fmt.Errorf(`"abstract" is only valid on "object"/"tuple"`)
		}
	}

	if isJSPrimitiveName(t) {
		return validateJSPrimitiveAnnotations(node, t)
	}

	switch t {
	case "object":
		return validateJSObjectNode(defs, node)
	case "array", "set":
		items, ok := node["items"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("%q requires an \"items\" schema", t)
		}
		return validateJSSchemaNode(defs, items)
	case "map":
		values, ok := node["values"].(map[string]interface{})
		if !ok {
			return fmt.Errorf(`"map" requires a "values" schema`)
		}
		return validateJSSchemaNode(defs, values)
	case "tuple":
		return validateJSTupleNode(defs, node)
	case "choice":
		return validateJSChoiceNode(defs, node)
	case "any":
		return nil
	default:
		return fmt.Errorf("unknown type %q", t)
	}
}

func validateJSPrimitiveAnnotations(
	node map[string]interface{}, t string,
) error {
	if _, ok := node["maxLength"]; ok && t != "string" && t != "binary" {
		return fmt.Errorf(`"maxLength" is only valid on "string"/"binary"`)
	}
	if _, ok := node["precision"]; ok && t != "decimal" && t != "number" {
		return fmt.Errorf(`"precision" is only valid on "decimal"/"number"`)
	}
	if _, ok := node["scale"]; ok && t != "decimal" && t != "number" {
		return fmt.Errorf(`"scale" is only valid on "decimal"/"number"`)
	}
	if _, ok := node["contentEncoding"]; ok && t != "binary" {
		return fmt.Errorf(`"contentEncoding" is only valid on "binary"`)
	}
	if _, hasConst := node["const"]; hasConst {
		if _, hasEnum := node["enum"]; hasEnum {
			return fmt.Errorf(`"const" and "enum" should not both be used`)
		}
	}
	return nil
}

func validateJSObjectNode(
	defs map[string]map[string]interface{},
	node map[string]interface{},
) error {
	propsRaw, ok := node["properties"].(map[string]interface{})
	if !ok || len(propsRaw) == 0 {
		return fmt.Errorf(`"object" requires a non-empty "properties" map`)
	}
	for name, p := range propsRaw {
		if !jsIdentifierRegex.MatchString(name) {
			return fmt.Errorf("invalid property name %q", name)
		}
		pm, ok := p.(map[string]interface{})
		if !ok {
			return fmt.Errorf("property %q schema must be an object", name)
		}
		if err := validateJSSchemaNode(defs, pm); err != nil {
			return fmt.Errorf("property %q: %v", name, err)
		}
	}
	if req, ok := node["required"]; ok {
		if err := validateJSRequired(req, propsRaw); err != nil {
			return err
		}
	}
	if ap, ok := node["additionalProperties"]; ok {
		switch v := ap.(type) {
		case bool:
		case map[string]interface{}:
			if err := validateJSSchemaNode(defs, v); err != nil {
				return fmt.Errorf(`"additionalProperties": %v`, err)
			}
		default:
			return fmt.Errorf(`"additionalProperties" must be a boolean ` +
				`or a schema`)
		}
	}
	if ext, hasExt := node["$extends"]; hasExt {
		if err := validateJSExtends(defs, ext); err != nil {
			return err
		}
	}
	return nil
}

func validateJSRequired(req interface{}, props map[string]interface{}) error {
	arr, ok := req.([]interface{})
	if !ok {
		return fmt.Errorf(`"required" must be an array`)
	}
	if len(arr) == 0 {
		return nil
	}
	checkNames := func(set []interface{}) error {
		for _, nm := range set {
			s, ok := nm.(string)
			if !ok {
				return fmt.Errorf(`"required" entries must be strings`)
			}
			if _, exists := props[s]; !exists {
				return fmt.Errorf(`"required" references unknown `+
					`property %q`, s)
			}
		}
		return nil
	}
	if _, isNested := arr[0].([]interface{}); isNested {
		for _, set := range arr {
			s, ok := set.([]interface{})
			if !ok {
				return fmt.Errorf(`"required" alternative-set entries ` +
					`must be arrays`)
			}
			if err := checkNames(s); err != nil {
				return err
			}
		}
		return nil
	}
	return checkNames(arr)
}

func validateJSExtends(
	defs map[string]map[string]interface{}, ext interface{},
) error {
	ptrs := []string{}
	switch e := ext.(type) {
	case string:
		ptrs = []string{e}
	case []interface{}:
		for _, v := range e {
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf(`"$extends" array entries must be strings`)
			}
			ptrs = append(ptrs, s)
		}
	default:
		return fmt.Errorf(`"$extends" must be a string or array of strings`)
	}
	for _, p := range ptrs {
		target, ok := defs[p]
		if !ok {
			return fmt.Errorf(`"$extends" target not found: %s`, p)
		}
		if ab, _ := target["abstract"].(bool); !ab {
			return fmt.Errorf(`"$extends" target %s must be "abstract"`, p)
		}
	}
	return nil
}

func validateJSTupleNode(
	defs map[string]map[string]interface{},
	node map[string]interface{},
) error {
	props, ok := node["properties"].(map[string]interface{})
	if !ok || len(props) == 0 {
		return fmt.Errorf(`"tuple" requires a non-empty "properties" map`)
	}
	order, ok := node["tuple"].([]interface{})
	if !ok || len(order) == 0 {
		return fmt.Errorf(`"tuple" requires a non-empty "tuple" keyword array`)
	}
	if len(order) != len(props) {
		return fmt.Errorf(`"tuple" keyword length (%d) must match `+
			`"properties" count (%d)`, len(order), len(props))
	}
	seen := map[string]bool{}
	for _, o := range order {
		s, ok := o.(string)
		if !ok {
			return fmt.Errorf(`"tuple" entries must be strings`)
		}
		if _, exists := props[s]; !exists {
			return fmt.Errorf(`"tuple" references unknown property %q`, s)
		}
		if seen[s] {
			return fmt.Errorf(`duplicate "tuple" entry %q`, s)
		}
		seen[s] = true
	}
	for name, p := range props {
		pm, ok := p.(map[string]interface{})
		if !ok {
			return fmt.Errorf("tuple property %q schema must be an object",
				name)
		}
		if err := validateJSSchemaNode(defs, pm); err != nil {
			return fmt.Errorf("tuple property %q: %v", name, err)
		}
	}
	return nil
}

func validateJSChoiceNode(
	defs map[string]map[string]interface{},
	node map[string]interface{},
) error {
	choices, ok := node["choices"].(map[string]interface{})
	if !ok || len(choices) == 0 {
		return fmt.Errorf(`"choice" requires a non-empty "choices" map`)
	}
	for tag, c := range choices {
		cm, ok := c.(map[string]interface{})
		if !ok {
			return fmt.Errorf("choice %q schema must be an object", tag)
		}
		if err := validateJSSchemaNode(defs, cm); err != nil {
			return fmt.Errorf("choice %q: %v", tag, err)
		}
	}
	if ext, hasExt := node["$extends"]; hasExt {
		if err := validateJSExtends(defs, ext); err != nil {
			return err
		}
		if _, ok := node["selector"].(string); !ok {
			return fmt.Errorf(`inline "choice" ($extends) requires a ` +
				`string "selector"`)
		}
	}
	return nil
}

// ────────────────────────────────────────────────────────────────
// IsCompatible - schema document parsing + resolution
// ────────────────────────────────────────────────────────────────

// jsDoc holds a parsed JSON Structure document plus its reusable-type
// index and effective root schema node, ready for compatibility
// comparison against another jsDoc.
type jsDoc struct {
	Root     map[string]interface{}
	Defs     map[string]map[string]interface{}
	RootNode map[string]interface{}
}

func parseJSDoc(buf []byte) (*jsDoc, error) {
	var doc map[string]interface{}
	if err := json.Unmarshal(buf, &doc); err != nil {
		return nil, err
	}

	defs := map[string]map[string]interface{}{}
	if rawDefs, ok := doc["definitions"].(map[string]interface{}); ok {
		if err := jsCollectDefinitions(rawDefs, "#/definitions", defs); err != nil {
			return nil, err
		}
	}

	var rootNode map[string]interface{}
	if rp, ok := doc["$root"].(string); ok {
		target, found := defs[rp]
		if !found {
			return nil, fmt.Errorf(`"$root" points to unknown definition: %s`,
				rp)
		}
		rootNode = target
	} else if _, hasType := doc["type"]; hasType {
		rootNode = doc
	} else {
		return nil, fmt.Errorf(`document has neither "type" nor "$root"`)
	}

	return &jsDoc{Root: doc, Defs: defs, RootNode: rootNode}, nil
}

// jsGetRequiredList returns the flat-array form of "required", or nil
// if absent or in the alternative-sets form (which isn't merged by
// $extends flattening - callers should keep the raw value around if
// they need to detect/compare the alt-sets form themselves).
func jsGetRequiredList(node map[string]interface{}) []string {
	arr, ok := node["required"].([]interface{})
	if !ok || len(arr) == 0 {
		return nil
	}
	if _, isNested := arr[0].([]interface{}); isNested {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// resolveJSNode flattens $extends (merging abstract base properties/
// required into a copy of node) and resolves a $ref "type" value to
// its target definition (recursively, with cycle protection). The
// result is a node ready for getKind()/comparison - its "type" value
// is either a primitive/compound name string or a union array; it is
// never a bare {"$ref":...} object.
func resolveJSNode(
	doc *jsDoc, node map[string]interface{}, visited map[string]bool,
) (map[string]interface{}, error) {
	result := node

	if ext, hasExt := node["$extends"]; hasExt {
		merged := map[string]interface{}{}
		for k, v := range node {
			merged[k] = v
		}
		delete(merged, "$extends")

		ptrs := []string{}
		switch e := ext.(type) {
		case string:
			ptrs = []string{e}
		case []interface{}:
			for _, v := range e {
				if s, ok := v.(string); ok {
					ptrs = append(ptrs, s)
				}
			}
		}

		mergedProps := map[string]interface{}{}
		requiredSet := map[string]bool{}
		for _, p := range ptrs {
			base, found := doc.Defs[p]
			if !found {
				continue
			}
			rb, err := resolveJSNode(doc, base, visited)
			if err != nil {
				return nil, err
			}
			if bp, ok := rb["properties"].(map[string]interface{}); ok {
				for k, v := range bp {
					if _, exists := mergedProps[k]; !exists {
						mergedProps[k] = v
					}
				}
			}
			for _, rq := range jsGetRequiredList(rb) {
				requiredSet[rq] = true
			}
		}
		if op, ok := node["properties"].(map[string]interface{}); ok {
			for k, v := range op {
				mergedProps[k] = v
			}
		}
		for _, rq := range jsGetRequiredList(node) {
			requiredSet[rq] = true
		}

		if len(mergedProps) > 0 {
			merged["properties"] = mergedProps
		}
		if len(requiredSet) > 0 {
			reqList := make([]interface{}, 0, len(requiredSet))
			for k := range requiredSet {
				reqList = append(reqList, k)
			}
			merged["required"] = reqList
		}
		result = merged
	}

	if tm, ok := result["type"].(map[string]interface{}); ok {
		ref, _ := tm["$ref"].(string)
		if visited[ref] {
			return nil, fmt.Errorf("cyclic $ref: %s", ref)
		}
		target, found := doc.Defs[ref]
		if !found {
			return nil, fmt.Errorf("$ref not found: %s", ref)
		}
		nv := map[string]bool{}
		for k, v := range visited {
			nv[k] = v
		}
		nv[ref] = true
		return resolveJSNode(doc, target, nv)
	}

	return result, nil
}

func jsGetKind(node map[string]interface{}) string {
	switch t := node["type"].(type) {
	case string:
		return t
	case []interface{}:
		return jsKindUnion
	default:
		return jsKindInvalid
	}
}

func jsBranchRawNode(b interface{}) (map[string]interface{}, error) {
	switch b.(type) {
	case string, map[string]interface{}:
		return map[string]interface{}{"type": b}, nil
	default:
		return nil, fmt.Errorf("invalid union branch")
	}
}

// ────────────────────────────────────────────────────────────────
// IsCompatible - top-level dispatcher
// ────────────────────────────────────────────────────────────────

// checkJSCompat is the top-level dispatcher, mirroring checkCompat()
// in format_jsonschema.go: "forward" is implemented as "backward"
// with the two documents swapped.
func checkJSCompat(direction string, oldDoc, newDoc *jsDoc) error {
	if direction == "forward" {
		oldDoc, newDoc = newDoc, oldDoc
	}
	return checkJSCompatNode(oldDoc, oldDoc.RootNode, newDoc, newDoc.RootNode)
}

// checkJSCompatNode checks that documents produced under oldRaw's
// schema (in oldDoc) remain valid under newRaw's schema (in newDoc),
// i.e. old ⊆ new.
func checkJSCompatNode(
	oldDoc *jsDoc, oldRaw map[string]interface{},
	newDoc *jsDoc, newRaw map[string]interface{},
) error {
	oldNode, err := resolveJSNode(oldDoc, oldRaw, map[string]bool{})
	if err != nil {
		return err
	}
	newNode, err := resolveJSNode(newDoc, newRaw, map[string]bool{})
	if err != nil {
		return err
	}

	oldKind := jsGetKind(oldNode)
	newKind := jsGetKind(newNode)

	if newKind == "any" {
		return nil
	}
	if oldKind == "any" {
		return fmt.Errorf("old type is \"any\" but new restricts to %q",
			newKind)
	}

	if oldKind == jsKindUnion {
		for _, b := range oldNode["type"].([]interface{}) {
			bRaw, err := jsBranchRawNode(b)
			if err != nil {
				return err
			}
			if err := checkJSCompatNode(oldDoc, bRaw, newDoc, newNode); err != nil {
				return fmt.Errorf("union branch not compatible: %v", err)
			}
		}
		return nil
	}
	if newKind == jsKindUnion {
		var lastErr error
		for _, b := range newNode["type"].([]interface{}) {
			bRaw, err := jsBranchRawNode(b)
			if err != nil {
				return err
			}
			if err := checkJSCompatNode(oldDoc, oldNode, newDoc, bRaw); err == nil {
				return nil
			} else {
				lastErr = err
			}
		}
		return fmt.Errorf("old not compatible with any new union branch "+
			"(conservative check): %v", lastErr)
	}

	if isJSPrimitiveName(oldKind) && isJSPrimitiveName(newKind) {
		return checkJSPrimitiveCompat(oldNode, newNode, oldKind, newKind)
	}

	if oldKind != newKind {
		return fmt.Errorf("type changed from %q to %q", oldKind, newKind)
	}

	switch oldKind {
	case "object":
		return checkJSObjectCompat(oldDoc, oldNode, newDoc, newNode)
	case "array", "set":
		return checkJSItemsCompat(oldDoc, oldNode, newDoc, newNode)
	case "map":
		return checkJSValuesCompat(oldDoc, oldNode, newDoc, newNode)
	case "tuple":
		return checkJSTupleCompat(oldDoc, oldNode, newDoc, newNode)
	case "choice":
		return checkJSChoiceCompat(oldDoc, oldNode, newDoc, newNode)
	}
	return nil
}

// jsNumericFamilies defines the widening chains (index = width rank).
var jsNumericFamilies = [][]string{
	{"int8", "int16", "int32", "int64", "int128"},
	{"uint8", "uint16", "uint32", "uint64", "uint128"},
	{"float8", "float", "double"},
}

func jsIsNumericPrimitive(t string) bool {
	switch t {
	case "number", "decimal":
		return true
	}
	for _, fam := range jsNumericFamilies {
		for _, m := range fam {
			if m == t {
				return true
			}
		}
	}
	return false
}

func jsSameFamilyWidening(oldT, newT string) bool {
	for _, fam := range jsNumericFamilies {
		oi, ni := -1, -1
		for i, m := range fam {
			if m == oldT {
				oi = i
			}
			if m == newT {
				ni = i
			}
		}
		if oi >= 0 && ni >= 0 {
			return ni >= oi
		}
	}
	return false
}

func checkJSPrimitiveCompat(
	oldNode, newNode map[string]interface{}, oldType, newType string,
) error {
	if oldType == "integer" {
		oldType = "int32"
	}
	if newType == "integer" {
		newType = "int32"
	}

	switch {
	case oldType == newType:
		// exact match, fine
	case newType == "number" && jsIsNumericPrimitive(oldType):
		// any numeric type may widen to the unconstrained "number" type
	case jsSameFamilyWidening(oldType, newType):
		// same-family widening
	default:
		return fmt.Errorf("primitive type %q not compatible with %q",
			oldType, newType)
	}

	if err := checkJSEnum(oldNode, newNode); err != nil {
		return err
	}
	if err := checkJSConst(oldNode, newNode); err != nil {
		return err
	}
	if oldType == "string" || oldType == "binary" {
		if err := checkJSMaxLength(oldNode, newNode); err != nil {
			return err
		}
	}
	if oldType == "decimal" {
		if err := checkJSDecimal(oldNode, newNode); err != nil {
			return err
		}
	}
	return nil
}

func checkJSEnum(oldM, newM map[string]interface{}) error {
	if oe, ok := oldM["enum"].([]interface{}); ok {
		ne, okN := newM["enum"].([]interface{})
		if !okN {
			return fmt.Errorf("old has enum, new does not")
		}
		oldSet := make(map[interface{}]struct{})
		for _, v := range oe {
			oldSet[v] = struct{}{}
		}
		for _, v := range ne {
			delete(oldSet, v)
		}
		if len(oldSet) > 0 {
			return fmt.Errorf("new enum misses old values")
		}
	} else if _, ok := newM["enum"]; ok {
		return fmt.Errorf("new adds enum restriction")
	}
	return nil
}

func checkJSConst(oldM, newM map[string]interface{}) error {
	oldConst, hasOld := oldM["const"]
	if hasOld {
		newConst, hasNew := newM["const"]
		if hasNew && !reflect.DeepEqual(oldConst, newConst) {
			return fmt.Errorf("const changed")
		}
	} else if _, hasNew := newM["const"]; hasNew {
		return fmt.Errorf("new adds const restriction")
	}
	return nil
}

func checkJSMaxLength(oldM, newM map[string]interface{}) error {
	oldMax, hasOld := getFloat(oldM["maxLength"])
	newMax, hasNew := getFloat(newM["maxLength"])
	if !hasNew {
		return nil // new unrestricted
	}
	if !hasOld {
		return fmt.Errorf("new adds a maxLength restriction")
	}
	if newMax < oldMax {
		return fmt.Errorf("maxLength narrowed from %v to %v", oldMax, newMax)
	}
	return nil
}

func checkJSDecimal(oldM, newM map[string]interface{}) error {
	if oldP, hasOld := getFloat(oldM["precision"]); hasOld {
		if newP, hasNew := getFloat(newM["precision"]); hasNew {
			if newP < oldP {
				return fmt.Errorf("precision narrowed from %v to %v",
					oldP, newP)
			}
		} else {
			return fmt.Errorf("new adds a precision restriction")
		}
	}
	if oldS, hasOld := getFloat(oldM["scale"]); hasOld {
		if newS, hasNew := getFloat(newM["scale"]); hasNew {
			if newS < oldS {
				return fmt.Errorf("scale narrowed from %v to %v", oldS, newS)
			}
		} else {
			return fmt.Errorf("new adds a scale restriction")
		}
	}
	return nil
}

type jsAdditionalSpec struct {
	allowed    bool
	anyAllowed bool
	schema     map[string]interface{}
}

func jsGetAdditionalSpec(m map[string]interface{}) jsAdditionalSpec {
	v, ok := m["additionalProperties"]
	if !ok {
		return jsAdditionalSpec{allowed: true, anyAllowed: true}
	}
	switch t := v.(type) {
	case bool:
		return jsAdditionalSpec{allowed: t, anyAllowed: t}
	case map[string]interface{}:
		return jsAdditionalSpec{allowed: true, schema: t}
	}
	return jsAdditionalSpec{allowed: true, anyAllowed: true}
}

func jsIsAltRequiredForm(v interface{}) bool {
	arr, ok := v.([]interface{})
	if !ok || len(arr) == 0 {
		return false
	}
	_, ok = arr[0].([]interface{})
	return ok
}

func checkJSObjectCompat(
	oldDoc *jsDoc, oldM map[string]interface{},
	newDoc *jsDoc, newM map[string]interface{},
) error {
	oldReqRaw := oldM["required"]
	newReqRaw := newM["required"]

	if jsIsAltRequiredForm(oldReqRaw) || jsIsAltRequiredForm(newReqRaw) {
		if !reflect.DeepEqual(oldReqRaw, newReqRaw) {
			return fmt.Errorf(`alternative "required" sets changed - ` +
				"not verified for compatibility (conservative check)")
		}
	} else {
		oldReq := map[string]struct{}{}
		for _, r := range jsGetRequiredList(oldM) {
			oldReq[r] = struct{}{}
		}
		for _, r := range jsGetRequiredList(newM) {
			if _, has := oldReq[r]; !has {
				return fmt.Errorf("new requires extra field %q not "+
					"required in old", r)
			}
		}
	}

	oldProps := getMap(oldM["properties"])
	newProps := getMap(newM["properties"])

	for name, oldP := range oldProps {
		oldPM, _ := oldP.(map[string]interface{})
		if newP, has := newProps[name]; has {
			newPM, _ := newP.(map[string]interface{})
			if err := checkJSCompatNode(oldDoc, oldPM, newDoc, newPM); err != nil {
				return fmt.Errorf("property %q not compatible: %v",
					name, err)
			}
		} else {
			newAdd := jsGetAdditionalSpec(newM)
			if !newAdd.allowed {
				return fmt.Errorf("removed property %q not permitted "+
					"by new additionalProperties:false", name)
			}
			if !newAdd.anyAllowed {
				if err := checkJSCompatNode(oldDoc, oldPM, newDoc, newAdd.schema); err != nil {
					return fmt.Errorf("removed property %q not "+
						"compatible with new additionalProperties "+
						"schema: %v", name, err)
				}
			}
		}
	}
	for name, newP := range newProps {
		if _, has := oldProps[name]; has {
			continue
		}
		oldAdd := jsGetAdditionalSpec(oldM)
		if oldAdd.allowed && !oldAdd.anyAllowed {
			newPM, _ := newP.(map[string]interface{})
			if err := checkJSCompatNode(oldDoc, oldAdd.schema, newDoc, newPM); err != nil {
				return fmt.Errorf("added property %q not compatible "+
					"with old additionalProperties schema: %v", name, err)
			}
		}
	}

	return nil
}

func checkJSItemsCompat(
	oldDoc *jsDoc, oldM map[string]interface{},
	newDoc *jsDoc, newM map[string]interface{},
) error {
	oldItems, _ := oldM["items"].(map[string]interface{})
	newItems, _ := newM["items"].(map[string]interface{})
	if err := checkJSCompatNode(oldDoc, oldItems, newDoc, newItems); err != nil {
		return fmt.Errorf("items not compatible: %v", err)
	}
	return nil
}

func checkJSValuesCompat(
	oldDoc *jsDoc, oldM map[string]interface{},
	newDoc *jsDoc, newM map[string]interface{},
) error {
	oldValues, _ := oldM["values"].(map[string]interface{})
	newValues, _ := newM["values"].(map[string]interface{})
	if err := checkJSCompatNode(oldDoc, oldValues, newDoc, newValues); err != nil {
		return fmt.Errorf("values not compatible: %v", err)
	}
	return nil
}

func jsToStringSlice(v interface{}) []string {
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func checkJSTupleCompat(
	oldDoc *jsDoc, oldM map[string]interface{},
	newDoc *jsDoc, newM map[string]interface{},
) error {
	oldOrder := jsToStringSlice(oldM["tuple"])
	newOrder := jsToStringSlice(newM["tuple"])
	if len(oldOrder) != len(newOrder) {
		return fmt.Errorf("tuple length changed from %d to %d",
			len(oldOrder), len(newOrder))
	}
	oldProps := getMap(oldM["properties"])
	newProps := getMap(newM["properties"])
	for i := range oldOrder {
		oldPM, _ := oldProps[oldOrder[i]].(map[string]interface{})
		newPM, _ := newProps[newOrder[i]].(map[string]interface{})
		if err := checkJSCompatNode(oldDoc, oldPM, newDoc, newPM); err != nil {
			return fmt.Errorf("tuple element %d (%s -> %s) not "+
				"compatible: %v", i, oldOrder[i], newOrder[i], err)
		}
	}
	return nil
}

func checkJSChoiceCompat(
	oldDoc *jsDoc, oldM map[string]interface{},
	newDoc *jsDoc, newM map[string]interface{},
) error {
	oldChoices := getMap(oldM["choices"])
	newChoices := getMap(newM["choices"])
	for tag, oldC := range oldChoices {
		newC, has := newChoices[tag]
		if !has {
			return fmt.Errorf("choice %q removed in new", tag)
		}
		oldCM, _ := oldC.(map[string]interface{})
		newCM, _ := newC.(map[string]interface{})
		if err := checkJSCompatNode(oldDoc, oldCM, newDoc, newCM); err != nil {
			return fmt.Errorf("choice %q not compatible: %v", tag, err)
		}
	}
	return nil
}
