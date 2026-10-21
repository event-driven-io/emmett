// Package registry - JSON Schema format compatibility checker.
//
// IsValid verifies that a version's document is a syntactically valid
// JSON Schema.
//
// IsCompatible checks whether two JSON Schema versions are compatible
// in the given direction. The rules below follow the closed-world
// assumption standard for schema registries (producers only emit
// fields defined in their schema):
//
//	"backward" — consumers using the NEW schema can read messages
//	             produced with the OLD schema.
//	             Permitted changes to the schema:
//	               • Delete any field (required or optional).
//	               • Add an optional field (not in required).
//	               • Widen constraints on existing fields.
//	             Forbidden changes:
//	               • Add a required field (old messages lack it).
//	               • Narrow constraints on existing fields.
//	             Implemented as: old ⊆ new
//
//	"forward"  — consumers using the OLD schema can read messages
//	             produced with the NEW schema.
//	             Permitted changes to the schema:
//	               • Add any field.
//	               • Delete an optional field (old doesn't require it).
//	               • Narrow constraints on existing fields.
//	             Forbidden changes:
//	               • Delete a required field (new messages lack it;
//	                 old schema requires it).
//	               • Widen constraints on existing fields.
//	             Implemented as: new ⊆ old
//	             (forward compat = backward compat with args swapped)
//
// Compatibility checks – status per keyword:
//
// Meta / top-level
//   - [supported]     boolean schemas (true / false)
//   - [supported]     type (single and array forms)
//   - [supported]     enum
//   - [supported]     const
//   - [not supported] $ref (only absolute HTTP/HTTPS URLs are resolved;
//     relative and JSON-Pointer $refs such as "#/$defs/Foo" are not
//     supported)
//   - [not supported] $defs / definitions (inlined only after $ref
//     resolution)
//   - [not supported] $schema / $id / $anchor / $dynamicRef /
//     $dynamicAnchor
//   - [not supported] title / description / $comment / examples /
//     default / readOnly / writeOnly / deprecated (informational;
//     not used for compat)
//
// Combinators
//   - [supported]     allOf  (conservative structural check)
//   - [supported]     anyOf  (conservative: old must satisfy at least
//     one new sub)
//   - [supported]     oneOf  (conservative: old must satisfy at least
//     one new sub)
//   - [supported]     not
//   - [supported]     if / then / else  (conservative structural check)
//
// Object keywords
//   - [supported]     properties
//   - [supported]     additionalProperties
//   - [supported]     patternProperties
//   - [supported]     unevaluatedProperties
//   - [supported]     propertyNames
//   - [supported]     required
//   - [supported]     dependentRequired
//   - [supported]     dependentSchemas
//   - [supported]     minProperties / maxProperties
//
// Array keywords
//   - [supported]     items (uniform schema form)
//   - [supported]     prefixItems / tuple items (array form)
//   - [supported]     additionalItems
//   - [supported]     unevaluatedItems
//   - [supported]     contains
//   - [supported]     minContains / maxContains
//   - [supported]     minItems / maxItems
//   - [supported]     uniqueItems
//
// String keywords
//   - [supported]     minLength / maxLength
//   - [supported]     pattern  (exact string match only; semantic
//     equivalence not checked)
//   - [supported]     format   (exact string match only; semantic
//     equivalence not checked)
//   - [supported]     contentEncoding
//   - [supported]     contentMediaType
//   - [supported]     contentSchema
//
// Number / integer keywords
//   - [supported]     minimum / exclusiveMinimum
//   - [supported]     maximum / exclusiveMaximum
//   - [supported]     multipleOf
//
// Known limitations / not yet implemented
//   - Multi-type schemas: when "type" is an array, only the first
//     element is used for type-specific sub-checks.
//   - Semantic pattern equivalence: two different regexes that match
//     the same language are treated as incompatible.
//   - Precise anyOf / oneOf compatibility: the current check is
//     conservative and may report false positives.
//   - Full if/then/else semantic analysis.
//   - Cross-type widening (e.g. integer → number when "type" is
//     absent).

package registry

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"reflect"
	"regexp"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	. "github.com/xregistry/server/common"
)

const JSON_FORMAT = "jsonschema*"

func init() {
	RegisterFormat(JSON_FORMAT, FormatJson{})
}

type FormatJson struct{}

func (fj FormatJson) IsValid(ver *Version) (bool, string, *XRError) {
	format := ver.GetAsString("format")
	if ok, _ := regexp.MatchString("(?i)"+JSON_FORMAT, format); !ok {
		return true, "", NewXRError("bad_request", ver.XID,
			"error_detail="+
				fmt.Sprintf(`Version %q has a "format" value of %q, was `+
					`expecting %q`, ver.XID, format, JSON_FORMAT))
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
				"valid json schema file.", ver.XID)
	}

	if err := IsValidJson(buf); err != nil {
		return true, "", NewXRError("bad_request", ver.XID,
			"error_detail="+ver.XID+" is not a valid json-schema file: "+
				err.Error())
	}
	return true, "", nil
}

func (fj FormatJson) IsCompatible(
	direction string,
	oldVersion *Version,
	newVersion *Version,
) (bool, string, *XRError) {
	oldBuf, newBuf := []byte(nil), []byte(nil)

	checked, reason, xErr := fj.IsValid(oldVersion)
	if xErr != nil {
		return checked, reason, xErr
	}

	checked, reason, xErr = fj.IsValid(newVersion)
	if xErr != nil {
		return checked, reason, xErr
	}

	if bufAny := oldVersion.Get(oldVersion.Resource.Singular); !IsNil(bufAny) {
		oldBuf = bufAny.([]byte)
	}
	if bufAny := newVersion.Get(newVersion.Resource.Singular); !IsNil(bufAny) {
		newBuf = bufAny.([]byte)
	}

	var oldMap, newMap map[string]interface{}

	if err := json.Unmarshal(oldBuf, &oldMap); err != nil {
		return true, "", NewXRError("bad_request", oldVersion.XID,
			"error_detail="+oldVersion.XID+" is not a valid json-schema file: "+
				err.Error())
	}
	if err := json.Unmarshal(newBuf, &newMap); err != nil {
		return true, "", NewXRError("bad_request", newVersion.XID,
			"error_detail="+newVersion.XID+" is not a valid json-schema file: "+
				err.Error())
	}

	cache := make(map[string]map[string]interface{})

	var err error
	oldMap, err = resolveSchema(oldMap, cache)
	if err != nil {
		return true, "", NewXRError("bad_request", oldVersion.XID,
			"error_detail="+oldVersion.XID+" is not a valid json-schema file: "+
				err.Error())
	}

	newMap, err = resolveSchema(newMap, cache)
	if err != nil {
		return true, "", NewXRError("bad_request", newVersion.XID,
			"error_detail="+newVersion.XID+" is not a valid json-schema file: "+
				err.Error())
	}

	err = checkCompat(direction, oldMap, newMap)
	if err != nil {
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

func IsValidJson(buf []byte) error {
	schema, err := jsonschema.UnmarshalJSON(bytes.NewReader(buf))
	if err == nil {
		c := jsonschema.NewCompiler()
		err = c.AddResource("temp.json", schema)

		if err != nil {
			_, err = c.Compile("temp.json")
		}
	}
	return err
}

// resolveSchema resolves $ref for absolute URLs only, recursively.
func resolveSchema(
	s map[string]interface{},
	cache map[string]map[string]interface{},
) (map[string]interface{}, error) {
	if ref, ok := s["$ref"].(string); ok {
		if cached, ok := cache[ref]; ok {
			return cached, nil
		}
		if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") {
			resp, err := http.Get(ref)
			if err != nil {
				return nil, fmt.Errorf("failed to fetch $ref %s: %v", ref, err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return nil, fmt.Errorf("failed to read $ref %s: %v", ref, err)
			}
			var m map[string]interface{}
			if err := json.Unmarshal(body, &m); err != nil {
				return nil, fmt.Errorf("failed to unmarshal $ref %s: %v", ref, err)
			}
			m, err = resolveSchema(m, cache)
			if err != nil {
				return nil, err
			}
			cache[ref] = m
			return m, nil
		}
		return nil, fmt.Errorf("only absolute URL $ref supported, got %s", ref)
	}

	// Recurse on subschemas
	subKeys := []string{
		"additionalProperties", "additionalItems", "contains",
		"propertyNames", "not", "if", "then", "else",
		"unevaluatedProperties", "unevaluatedItems", "contentSchema",
	}
	for _, k := range subKeys {
		if sub, ok := s[k].(map[string]interface{}); ok {
			res, err := resolveSchema(sub, cache)
			if err != nil {
				return nil, err
			}
			s[k] = res
		}
	}

	// items can be array
	arrKeys := []string{
		"allOf", "anyOf", "oneOf", "prefixItems", "items",
	}
	for _, k := range arrKeys {
		if arr, ok := s[k].([]interface{}); ok {
			for i := range arr {
				sub, ok := arr[i].(map[string]interface{})
				if !ok {
					continue
				}
				res, err := resolveSchema(sub, cache)
				if err != nil {
					return nil, err
				}
				arr[i] = res
			}
		}
	}

	mapKeys := []string{
		"properties", "patternProperties",
		"dependentSchemas", "definitions", "$defs",
	}
	for _, k := range mapKeys {
		if m, ok := s[k].(map[string]interface{}); ok {
			for pk := range m {
				sub, ok := m[pk].(map[string]interface{})
				if !ok {
					continue
				}
				res, err := resolveSchema(sub, cache)
				if err != nil {
					return nil, err
				}
				m[pk] = res
			}
		}
	}

	return s, nil
}

// checkCompat is the top-level dispatcher.
//
// "backward": verifies old ⊆ new (every old-valid doc is also
// new-valid). Allowed: delete fields, add optional fields, widen
// constraints.
//
// "forward": verifies new ⊆ old (every new-valid doc is also
// old-valid). Allowed: add fields, delete optional fields, narrow
// constraints. Implemented by swapping the arguments and running the
// backward check, which gives the correct A ⊆ B relationship.
func checkCompat(direction string, old, new interface{}) error {
	if direction == "forward" {
		old, new = new, old
	}
	return checkBackwardCompat(old, new)
}

// checkBackwardCompat checks that schema A (first arg) is a subset of
// schema B (second arg) under the closed-world assumption: producers
// only emit fields explicitly defined in their schema, so a field
// absent from A never appears in A's documents. This means:
//   - A property present in B but absent from A is skipped unless A
//     has an explicit (non-permissive) additionalProperties/items
//     restriction, because A documents never carry that property.
//   - The required-field checks enforce the real constraints for both
//     directions.
func checkBackwardCompat(old, new interface{}) error {
	if oldB, ok := old.(bool); ok {
		if newB, ok := new.(bool); ok {
			if oldB && !newB {
				return fmt.Errorf("old true, new false not compatible")
			}
			return nil
		}
		if oldB {
			if !isTrueSchema(new) {
				return fmt.Errorf("old true, new not true")
			}
			return nil
		}
		return nil // old false compatible with anything
	}

	if newB, ok := new.(bool); ok {
		if newB {
			return nil // anything <: true
		}
		if isFalseSchema(old) {
			return nil
		}
		return fmt.Errorf("new false, old not false")
	}

	oldM, okO := old.(map[string]interface{})
	newM, okN := new.(map[string]interface{})
	if !okO || !okN {
		return fmt.Errorf("unexpected schema type")
	}

	// Handle combinators
	if err := handleCombinators(oldM, newM); err != nil {
		return err
	}

	// Types
	oldTypes := getTypes(oldM)
	newTypes := getTypes(newM)
	if !typesSubsumed(oldTypes, newTypes) {
		return fmt.Errorf("types not compatible: old %v, new %v", oldTypes, newTypes)
	}

	// Enum
	if err := checkEnum(oldM, newM); err != nil {
		return err
	}

	// Const
	if err := checkConst(oldM, newM); err != nil {
		return err
	}

	if len(oldTypes) == 0 || len(newTypes) == 0 {
		return nil // no type, skip type-specific
	}

	typeName := oldTypes[0] // assume single for simplicity
	switch typeName {
	case "object":
		if err := checkObjectCompat(oldM, newM); err != nil {
			return err
		}
	case "array":
		if err := checkArrayCompat(oldM, newM); err != nil {
			return err
		}
	case "string":
		if err := checkStringCompat(oldM, newM); err != nil {
			return err
		}
	case "number", "integer":
		if err := checkNumberCompat(oldM, newM); err != nil {
			return err
		}
	}

	return nil
}

// handleCombinators handles allOf, anyOf, oneOf, not, if/then/else
func handleCombinators(oldM, newM map[string]interface{}) error {
	// allOf
	if all, ok := oldM["allOf"].([]interface{}); ok {
		for _, sub := range all {
			if err := checkBackwardCompat(sub, newM); err != nil {
				return fmt.Errorf("old allOf sub not compatible: %v", err)
			}
		}
	}
	if all, ok := newM["allOf"].([]interface{}); ok {
		for _, sub := range all {
			if err := checkBackwardCompat(oldM, sub); err != nil {
				return fmt.Errorf("new allOf sub not compatible: %v", err)
			}
		}
	}

	// anyOf
	if any, ok := oldM["anyOf"].([]interface{}); ok {
		for _, sub := range any {
			if err := checkBackwardCompat(sub, newM); err != nil {
				return fmt.Errorf("old anyOf sub not compatible: %v", err)
			}
		}
	}
	if any, ok := newM["anyOf"].([]interface{}); ok {
		found := false
		for _, sub := range any {
			if checkBackwardCompat(oldM, sub) == nil {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf(
				"old not compatible with any new anyOf sub " +
					"(conservative check)",
			)
		}
	}

	// oneOf
	if one, ok := oldM["oneOf"].([]interface{}); ok {
		for _, sub := range one {
			if err := checkBackwardCompat(sub, newM); err != nil {
				return fmt.Errorf("old oneOf sub not compatible: %v", err)
			}
		}
	}
	if one, ok := newM["oneOf"].([]interface{}); ok {
		found := false
		for _, sub := range one {
			if checkBackwardCompat(oldM, sub) == nil {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf(
				"old not compatible with any new oneOf sub " +
					"(conservative check)",
			)
		}
	}

	// not
	if n, ok := oldM["not"]; ok {
		temp := map[string]interface{}{"allOf": []interface{}{n, newM}}
		if !isFalseSchema(temp) {
			return fmt.Errorf("old not compatible with new (not false intersection)")
		}
	}
	if n, ok := newM["not"]; ok {
		temp := map[string]interface{}{"allOf": []interface{}{oldM, n}}
		if isFalseSchema(temp) {
			return nil
		}
		return fmt.Errorf("old not compatible with new not (intersection not false)")
	}

	// if/then/else
	if _, hasOld := oldM["if"]; hasOld {
		oldIf := oldM["if"]
		oldThen := oldM["then"]
		oldElse := oldM["else"]
		newIf, hasNew := newM["if"]
		if hasNew {
			// Conservative: check ifs compatible, then recurse
			if err := checkBackwardCompat(oldIf, newIf); err != nil {
				return fmt.Errorf("if not compatible: %v", err)
			}
		}
		if oldThen != nil {
			if newThen, ok := newM["then"]; ok {
				if err := checkBackwardCompat(oldThen, newThen); err != nil {
					return fmt.Errorf("then not compatible: %v", err)
				}
			}
		}
		if oldElse != nil {
			if newElse, ok := newM["else"]; ok {
				if err := checkBackwardCompat(oldElse, newElse); err != nil {
					return fmt.Errorf("else not compatible: %v", err)
				}
			}
		}
	} else if _, hasNew := newM["if"]; hasNew {
		return fmt.Errorf("new adds if/then/else restriction")
	}

	return nil
}

// checkEnum checks enum compatibility
func checkEnum(oldM, newM map[string]interface{}) error {
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

// checkConst checks const compatibility
func checkConst(oldM, newM map[string]interface{}) error {
	oldConst, hasOld := oldM["const"]
	if hasOld {
		newConst, hasNew := newM["const"]
		if hasNew {
			if !reflect.DeepEqual(oldConst, newConst) {
				return fmt.Errorf("const changed")
			}
		}
	} else if _, hasNew := newM["const"]; hasNew {
		return fmt.Errorf("new adds const restriction")
	}
	return nil
}

// checkObjectCompat checks object-specific compatibility
func checkObjectCompat(oldM, newM map[string]interface{}) error {
	// Required
	oldReq := getRequired(oldM)
	newReq := getRequired(newM)
	for r := range newReq {
		if _, has := oldReq[r]; !has {
			return fmt.Errorf("new requires extra field %s not required in old", r)
		}
	}

	// Properties
	oldProps := getMap(oldM["properties"])
	newProps := getMap(newM["properties"])
	for name, oldP := range oldProps {
		if newP, has := newProps[name]; has {
			if err := checkBackwardCompat(oldP, newP); err != nil {
				return fmt.Errorf("property %s not compatible: %v", name, err)
			}
		} else {
			effectiveNew := getEffectiveAdditional(newM, name)
			if err := checkBackwardCompat(oldP, effectiveNew); err != nil {
				return fmt.Errorf(
					"removed property %s not compatible "+
						"with new additional/pattern: %v",
					name, err,
				)
			}
		}
	}
	for name, newP := range newProps {
		if _, has := oldProps[name]; !has {
			// Under the closed-world assumption, documents produced
			// under "old" never carry this property, so there is
			// nothing to check — the required-field check above
			// already rejects it if "new" makes it mandatory.
			// We only need to check when old explicitly restricts
			// additionalProperties, because then old documents
			// could carry the field with a constrained type.
			effectiveOld := getEffectiveAdditional(oldM, name)
			if !isTrueSchema(effectiveOld) {
				if err := checkBackwardCompat(
					effectiveOld, newP,
				); err != nil {
					return fmt.Errorf(
						"added property %s not compatible "+
							"with old additional/pattern: %v",
						name, err,
					)
				}
			}
		}
	}

	// patternProperties
	oldPatProps := getMap(oldM["patternProperties"])
	newPatProps := getMap(newM["patternProperties"])
	for pat, oldP := range oldPatProps {
		if newP, has := newPatProps[pat]; has {
			if err := checkBackwardCompat(oldP, newP); err != nil {
				return fmt.Errorf("patternProperty %s not compatible: %v", pat, err)
			}
		} else {
			// Removed pattern, check with additional
			if err := checkBackwardCompat(
				oldP, newM["additionalProperties"],
			); err != nil {
				return fmt.Errorf(
					"removed patternProperty %s not "+
						"compatible with new additional: %v",
					pat, err,
				)
			}
		}
	}
	for pat, newP := range newPatProps {
		if _, has := oldPatProps[pat]; !has {
			// Same closed-world reasoning as for plain properties:
			// skip schema check unless old has an explicit
			// additionalProperties restriction.
			effectiveOld := oldM["additionalProperties"]
			if !isTrueSchema(effectiveOld) {
				if err := checkBackwardCompat(
					effectiveOld, newP,
				); err != nil {
					return fmt.Errorf(
						"added patternProperty %s not "+
							"compatible with old additional: %v",
						pat, err,
					)
				}
			}
		}
	}

	// additionalProperties
	oldAdd := getEffectiveAdditional(oldM, "")
	newAdd := getEffectiveAdditional(newM, "")
	if err := checkBackwardCompat(oldAdd, newAdd); err != nil {
		return fmt.Errorf("additionalProperties not compatible: %v", err)
	}

	// unevaluatedProperties
	if oldU, hasOld := oldM["unevaluatedProperties"]; hasOld {
		if newU, hasNew := newM["unevaluatedProperties"]; hasNew {
			if err := checkBackwardCompat(oldU, newU); err != nil {
				return fmt.Errorf("unevaluatedProperties not compatible: %v", err)
			}
		}
	} else if _, hasNew := newM["unevaluatedProperties"]; hasNew {
		return fmt.Errorf("new adds unevaluatedProperties restriction")
	}

	// propertyNames
	if oldPN, hasOld := oldM["propertyNames"]; hasOld {
		if newPN, hasNew := newM["propertyNames"]; hasNew {
			if err := checkBackwardCompat(oldPN, newPN); err != nil {
				return fmt.Errorf("propertyNames not compatible: %v", err)
			}
		}
	} else if _, hasNew := newM["propertyNames"]; hasNew {
		return fmt.Errorf("new adds propertyNames restriction")
	}

	// dependentRequired
	oldDepReq := getMap(oldM["dependentRequired"])
	newDepReq := getMap(newM["dependentRequired"])
	for key, newList := range newDepReq {
		oldList, has := oldDepReq[key]
		if !has {
			return fmt.Errorf("new adds dependentRequired for %s", key)
		}
		oldSet := make(map[string]struct{})
		for _, r := range oldList.([]interface{}) {
			oldSet[r.(string)] = struct{}{}
		}
		for _, r := range newList.([]interface{}) {
			if _, has := oldSet[r.(string)]; !has {
				return fmt.Errorf(
					"new dependentRequired for %s adds extra %s",
					key, r,
				)
			}
		}
	}

	// dependentSchemas
	oldDepSch := getMap(oldM["dependentSchemas"])
	newDepSch := getMap(newM["dependentSchemas"])
	for key, newS := range newDepSch {
		oldS, has := oldDepSch[key]
		if !has {
			return fmt.Errorf("new adds dependentSchemas for %s", key)
		}
		if err := checkBackwardCompat(oldS, newS); err != nil {
			return fmt.Errorf("dependentSchemas for %s not compatible: %v", key, err)
		}
	}

	// minProperties, maxProperties
	if err := checkMinMax(
		oldM["minProperties"], newM["minProperties"], true,
	); err != nil {
		return fmt.Errorf("minProperties: %v", err)
	}
	if err := checkMinMax(
		oldM["maxProperties"], newM["maxProperties"], false,
	); err != nil {
		return fmt.Errorf("maxProperties: %v", err)
	}

	return nil
}

// checkArrayCompat checks array-specific compatibility
func checkArrayCompat(oldM, newM map[string]interface{}) error {
	// items
	oldItems := oldM["items"]
	newItems := newM["items"]
	oldPrefix := oldM["prefixItems"]
	newPrefix := newM["prefixItems"]
	oldIsArray := false
	if oldItemsArr, ok := oldItems.([]interface{}); ok {
		oldIsArray = true
		oldPrefix = oldItemsArr // treat as prefix
	}
	newIsArray := false
	if newItemsArr, ok := newItems.([]interface{}); ok {
		newIsArray = true
		newPrefix = newItemsArr
	}
	oldPrefixArr, oldIsPrefix := oldPrefix.([]interface{})
	newPrefixArr, newIsPrefix := newPrefix.([]interface{})
	if oldIsPrefix || oldIsArray {
		if newIsPrefix || newIsArray {
			minLen := math.Min(float64(len(oldPrefixArr)), float64(len(newPrefixArr)))
			for i := 0; i < int(minLen); i++ {
				if err := checkBackwardCompat(
					oldPrefixArr[i], newPrefixArr[i],
				); err != nil {
					return fmt.Errorf(
						"prefixItems [%d] not compatible: %v",
						i, err,
					)
				}
			}
			if len(oldPrefixArr) > len(newPrefixArr) {
				for i := len(newPrefixArr); i < len(oldPrefixArr); i++ {
					effectiveNew := getEffectiveAdditionalItems(newM)
					if err := checkBackwardCompat(
						oldPrefixArr[i], effectiveNew,
					); err != nil {
						return fmt.Errorf(
							"old extra prefixItem [%d] not "+
								"compatible with new "+
								"additionalItems: %v",
							i, err,
						)
					}
				}
			} else if len(newPrefixArr) > len(oldPrefixArr) {
				// Under closed-world, "old" documents only have
				// as many positional items as old schema defines.
				// Extra positions added in "new" are irrelevant
				// unless old restricts additionalItems, in which
				// case those extra elements may appear with a
				// constrained type.
				effectiveOld := getEffectiveAdditionalItems(oldM)
				if !isTrueSchema(effectiveOld) {
					for i := len(oldPrefixArr); i < len(newPrefixArr); i++ {
						if err := checkBackwardCompat(
							effectiveOld, newPrefixArr[i],
						); err != nil {
							return fmt.Errorf(
								"new extra prefixItem [%d] not "+
									"compatible with old "+
									"additionalItems: %v",
								i, err,
							)
						}
					}
				}
			}
		} else {
			// New is uniform items, check each old prefix with new items
			newUniform, ok := newItems.(map[string]interface{})
			if ok {
				for _, oldSub := range oldPrefixArr {
					if err := checkBackwardCompat(oldSub, newUniform); err != nil {
						return err
					}
				}
			}
		}
	} else if newIsPrefix || newIsArray {
		return fmt.Errorf("new adds prefixItems/tuple restriction")
	} else {
		oldUniform, okO := oldItems.(map[string]interface{})
		newUniform, okN := newItems.(map[string]interface{})
		if okO && okN {
			if err := checkBackwardCompat(oldUniform, newUniform); err != nil {
				return err
			}
		} else if okO && !okN {
			// New no items, ok (more permissive)
		} else if !okO && okN {
			return fmt.Errorf("new adds items restriction")
		}
	}

	// additionalItems
	oldAddItems := getEffectiveAdditionalItems(oldM)
	newAddItems := getEffectiveAdditionalItems(newM)
	if err := checkBackwardCompat(oldAddItems, newAddItems); err != nil {
		return fmt.Errorf("additionalItems not compatible: %v", err)
	}

	// unevaluatedItems
	if oldU, hasOld := oldM["unevaluatedItems"]; hasOld {
		if newU, hasNew := newM["unevaluatedItems"]; hasNew {
			if err := checkBackwardCompat(oldU, newU); err != nil {
				return fmt.Errorf("unevaluatedItems not compatible: %v", err)
			}
		}
	} else if _, hasNew := newM["unevaluatedItems"]; hasNew {
		return fmt.Errorf("new adds unevaluatedItems restriction")
	}

	// contains
	if oldC, hasOld := oldM["contains"]; hasOld {
		if newC, hasNew := newM["contains"]; hasNew {
			if err := checkBackwardCompat(oldC, newC); err != nil {
				return fmt.Errorf("contains not compatible: %v", err)
			}
		}
	} else if _, hasNew := newM["contains"]; hasNew {
		return fmt.Errorf("new adds contains restriction")
	}

	// minContains, maxContains
	if err := checkMinMax(
		oldM["minContains"], newM["minContains"], true,
	); err != nil {
		return fmt.Errorf("minContains: %v", err)
	}
	if err := checkMinMax(
		oldM["maxContains"], newM["maxContains"], false,
	); err != nil {
		return fmt.Errorf("maxContains: %v", err)
	}

	// minItems, maxItems
	if err := checkMinMax(oldM["minItems"], newM["minItems"], true); err != nil {
		return fmt.Errorf("minItems: %v", err)
	}
	if err := checkMinMax(oldM["maxItems"], newM["maxItems"], false); err != nil {
		return fmt.Errorf("maxItems: %v", err)
	}

	// uniqueItems
	oldUnique, hasOld := oldM["uniqueItems"].(bool)
	newUnique, hasNew := newM["uniqueItems"].(bool)
	if hasOld && oldUnique {
		// New can be anything, since old data has unique, new if false ok, if true ok
	} else if hasNew && newUnique {
		return fmt.Errorf("new adds uniqueItems restriction")
	}

	return nil
}

// checkStringCompat checks string-specific compatibility
func checkStringCompat(oldM, newM map[string]interface{}) error {
	// minLength, maxLength
	if err := checkMinMax(
		oldM["minLength"], newM["minLength"], true,
	); err != nil {
		return fmt.Errorf("minLength: %v", err)
	}
	if err := checkMinMax(
		oldM["maxLength"], newM["maxLength"], false,
	); err != nil {
		return fmt.Errorf("maxLength: %v", err)
	}

	// pattern
	oldPat, hasOld := oldM["pattern"].(string)
	newPat, hasNew := newM["pattern"].(string)
	if hasOld {
		if hasNew {
			if oldPat != newPat {
				return fmt.Errorf("pattern changed")
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds pattern restriction")
	}

	// format
	oldFmt, hasOld := oldM["format"].(string)
	newFmt, hasNew := newM["format"].(string)
	if hasOld {
		if hasNew {
			if oldFmt != newFmt {
				return fmt.Errorf("format changed")
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds format restriction")
	}

	// contentEncoding
	oldEnc, hasOld := oldM["contentEncoding"].(string)
	newEnc, hasNew := newM["contentEncoding"].(string)
	if hasOld {
		if hasNew {
			if oldEnc != newEnc {
				return fmt.Errorf("contentEncoding changed")
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds contentEncoding restriction")
	}

	// contentMediaType
	oldMedia, hasOld := oldM["contentMediaType"].(string)
	newMedia, hasNew := newM["contentMediaType"].(string)
	if hasOld {
		if hasNew {
			if oldMedia != newMedia {
				return fmt.Errorf("contentMediaType changed")
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds contentMediaType restriction")
	}

	// contentSchema
	if oldCS, hasOld := oldM["contentSchema"]; hasOld {
		if newCS, hasNew := newM["contentSchema"]; hasNew {
			if err := checkBackwardCompat(oldCS, newCS); err != nil {
				return fmt.Errorf("contentSchema not compatible: %v", err)
			}
		}
	} else if _, hasNew := newM["contentSchema"]; hasNew {
		return fmt.Errorf("new adds contentSchema restriction")
	}

	return nil
}

// checkNumberCompat checks number/integer-specific compatibility
func checkNumberCompat(oldM, newM map[string]interface{}) error {
	// multipleOf
	oldMult, hasOld := getFloat(oldM["multipleOf"])
	newMult, hasNew := getFloat(newM["multipleOf"])
	if hasOld {
		if hasNew {
			if math.Mod(oldMult, newMult) != 0 {
				return fmt.Errorf(
					"new multipleOf %f does not divide old %f",
					newMult, oldMult,
				)
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds multipleOf restriction")
	}

	// minimum, maximum, exclusive
	oldMin, oldMinExc, hasOldMin := getLowerBound(oldM)
	newMin, newMinExc, hasNewMin := getLowerBound(newM)
	if hasOldMin {
		if hasNewMin {
			if newMin > oldMin {
				return fmt.Errorf("new min > old min")
			}
			if newMin == oldMin && newMinExc && !oldMinExc {
				return fmt.Errorf("new exclusive min stricter than old inclusive")
			}
		}
	} else if hasNewMin {
		return fmt.Errorf("new adds min restriction")
	}

	oldMax, oldMaxExc, hasOldMax := getUpperBound(oldM)
	newMax, newMaxExc, hasNewMax := getUpperBound(newM)
	if hasOldMax {
		if hasNewMax {
			if newMax < oldMax {
				return fmt.Errorf("new max < old max")
			}
			if newMax == oldMax && newMaxExc && !oldMaxExc {
				return fmt.Errorf("new exclusive max stricter than old inclusive")
			}
		}
	} else if hasNewMax {
		return fmt.Errorf("new adds max restriction")
	}

	return nil
}

// getRequired returns set of required fields
func getRequired(s map[string]interface{}) map[string]struct{} {
	req := make(map[string]struct{})
	if r, ok := s["required"].([]interface{}); ok {
		for _, v := range r {
			req[v.(string)] = struct{}{}
		}
	}
	return req
}

// getEffectiveAdditional returns the effective schema for additional
// properties, considering patternProperties for a specific name.
func getEffectiveAdditional(
	s map[string]interface{}, name string,
) interface{} {
	if name != "" {
		patProps, ok := s["patternProperties"].(map[string]interface{})
		if ok {
			for pat, sch := range patProps {
				re, err := regexp.Compile(pat)
				if err == nil && re.MatchString(name) {
					return sch
				}
			}
		}
	}
	if add, has := s["additionalProperties"]; has {
		return add
	}
	return true // default
}

// getEffectiveAdditionalItems returns effective schema for additional items
func getEffectiveAdditionalItems(s map[string]interface{}) interface{} {
	if add, has := s["additionalItems"]; has {
		return add
	}
	return true // default
}

// typesSubsumed checks if old types are subsumed by new types
func typesSubsumed(oldT, newT []string) bool {
	if len(oldT) == 0 {
		return true // unrestricted
	}
	for _, ot := range oldT {
		found := false
		for _, nt := range newT {
			if ot == nt || (ot == "integer" && nt == "number") {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// isTrueSchema checks if schema is always true
func isTrueSchema(s interface{}) bool {
	b, ok := s.(bool)
	if ok {
		return b
	}
	m, ok := s.(map[string]interface{})
	if !ok {
		return false
	}
	if len(m) == 0 {
		return true
	}
	if not, ok := m["not"]; ok && len(m) == 1 {
		return isFalseSchema(not)
	}
	// Check if no restricting keywords
	restricting := []string{
		"type", "enum", "const",
		"multipleOf",
		"maximum", "exclusiveMaximum",
		"minimum", "exclusiveMinimum",
		"maxLength", "minLength", "pattern", "format",
		"maxItems", "minItems", "uniqueItems",
		"maxContains", "minContains",
		"maxProperties", "minProperties",
		"required", "dependentRequired",
		"properties", "patternProperties",
		"additionalProperties", "propertyNames",
		"contains",
		"contentMediaType", "contentEncoding", "contentSchema",
		"allOf", "anyOf", "oneOf", "not", "if",
	}
	for _, k := range restricting {
		if _, has := m[k]; has {
			return false
		}
	}
	return true
}

// isFalseSchema checks if schema is always false
func isFalseSchema(s interface{}) bool {
	b, ok := s.(bool)
	if ok {
		return !b
	}
	m, ok := s.(map[string]interface{})
	if !ok {
		return false
	}
	if not, ok := m["not"]; ok && len(m) == 1 {
		return isTrueSchema(not)
	}
	if all, ok := m["allOf"].([]interface{}); ok {
		for _, sub := range all {
			if isFalseSchema(sub) {
				return true
			}
		}
	}
	if any, ok := m["anyOf"].([]interface{}); ok {
		allFalse := true
		for _, sub := range any {
			if !isFalseSchema(sub) {
				allFalse = false
				break
			}
		}
		if allFalse {
			return true
		}
	}
	if e, ok := m["enum"].([]interface{}); ok {
		return len(e) == 0
	}
	if t, ok := m["type"].([]interface{}); ok {
		return len(t) == 0
	}
	// min > max checks
	if min, hasMin := getFloat(m["minimum"]); hasMin {
		if max, hasMax := getFloat(m["maximum"]); hasMax {
			if min > max {
				return true
			}
		}
	}
	if min, hasMin := getFloat(m["minLength"]); hasMin {
		if max, hasMax := getFloat(m["maxLength"]); hasMax {
			if min > max {
				return true
			}
		}
	}
	if min, hasMin := getFloat(m["minItems"]); hasMin {
		if max, hasMax := getFloat(m["maxItems"]); hasMax {
			if min > max {
				return true
			}
		}
	}
	if min, hasMin := getFloat(m["minProperties"]); hasMin {
		if max, hasMax := getFloat(m["maxProperties"]); hasMax {
			if min > max {
				return true
			}
		}
	}
	// Add more
	return false
}

// getLowerBound returns min, exclusive
func getLowerBound(s map[string]interface{}) (float64, bool, bool) {
	if exc, ok := s["exclusiveMinimum"].(float64); ok {
		return exc, true, true
	}
	if min, ok := s["minimum"].(float64); ok {
		return min, false, true
	}
	return 0, false, false
}

// getUpperBound returns max, exclusive
func getUpperBound(s map[string]interface{}) (float64, bool, bool) {
	if exc, ok := s["exclusiveMaximum"].(float64); ok {
		return exc, true, true
	}
	if max, ok := s["maximum"].(float64); ok {
		return max, false, true
	}
	return 0, false, false
}

// checkMinMax checks min/max compatibility
func checkMinMax(oldV, newV interface{}, isMin bool) error {
	oldF, hasOld := getFloat(oldV)
	newF, hasNew := getFloat(newV)
	if hasOld {
		if hasNew {
			if isMin && newF > oldF {
				return fmt.Errorf("new > old")
			}
			if !isMin && newF < oldF {
				return fmt.Errorf("new < old")
			}
		}
	} else if hasNew {
		return fmt.Errorf("new adds restriction")
	}
	return nil
}

// getTypes returns the type list
func getTypes(s map[string]interface{}) []string {
	t := s["type"]
	if t == nil {
		return []string{}
	}
	if str, ok := t.(string); ok {
		return []string{str}
	}
	arr, ok := t.([]interface{})
	if !ok {
		return []string{}
	}
	res := []string{}
	for _, v := range arr {
		str, ok := v.(string)
		if ok {
			res = append(res, str)
		}
	}
	return res
}

// getMap returns map or empty
func getMap(v interface{}) map[string]interface{} {
	m, ok := v.(map[string]interface{})
	if ok {
		return m
	}
	return make(map[string]interface{})
}

// getFloat returns float or false
func getFloat(v interface{}) (float64, bool) {
	f, ok := v.(float64)
	return f, ok
}
