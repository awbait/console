package views

import (
	"fmt"
	"strconv"
	"strings"
)

// What a stamped value has to be, and what to do when it is not.
//
// A template always renders to text - that is what a template is. Chart fields
// are not all text: a port is an integer, a switch is a boolean, and a document
// that writes "8080" into an integer field breaks the order at the schema check,
// blaming a field the person filling the form never touched.
//
// So the value is converted to what the field declares before it is written,
// and a value that cannot be converted ("abc" into a port) fails the stamp with
// a sentence naming the field and what it takes. The alternative - letting the
// chart schema refuse it later - says the same thing in the validator's words,
// pinned to the customer's form.

// Field types this cares about. Everything else (string, object, array, or a
// field the schema does not describe) is left exactly as rendered.
const (
	typeInteger = "integer"
	typeNumber  = "number"
	typeBoolean = "boolean"
	typeString  = "string"
)

// schemaTypeAt returns the type values.schema.json declares for a pointer, or
// "" when the schema says nothing about it (an unknown field, a schema the
// portal cannot walk, or a union of types, where guessing would be worse than
// leaving the value alone).
func schemaTypeAt(ptr string, schema map[string]any) string {
	if schema == nil {
		return ""
	}
	node := resolvePointerNode(ptr, schema, schema)
	if node == nil {
		return ""
	}
	t, _ := node["type"].(string)
	return t
}

// coerce converts a rendered value to what the field declares. It only ever
// converts text: a document that wrote a real number stays as it was written.
func coerce(val any, kind string) (any, error) {
	s, ok := val.(string)
	if !ok {
		return val, nil
	}
	switch kind {
	case typeInteger:
		n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil {
			return val, fmt.Errorf("здесь ждут целое число, а получилось «%s»", s)
		}
		return n, nil
	case typeNumber:
		f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return val, fmt.Errorf("здесь ждут число, а получилось «%s»", s)
		}
		return f, nil
	case typeBoolean:
		b, err := strconv.ParseBool(strings.TrimSpace(s))
		if err != nil {
			return val, fmt.Errorf("здесь ждут «да» или «нет» (true или false), а получилось «%s»", s)
		}
		return b, nil
	}
	return val, nil
}

// checkValueType is the same rule, applied where a document is written instead
// of where an order is saved: it says what a value will do before anybody
// orders the service.
//
// What it can prove depends on the value. A literal is checked outright. A whole
// value that is one reference is checked through the reference: the order's own
// fields (team, author) are always text, a platform variable is checked against
// the value it holds right now. A reference sitting inside text always renders
// to text. Everything it cannot prove is left alone: a complaint about a
// document that would work is worse than none.
func checkValueType(val any, kind string, known KnownVars) error {
	if kind == "" {
		return nil
	}
	s, isText := val.(string)
	if !isText {
		// A real number or boolean in the document: the schema check on the
		// order will say whatever is left to say.
		return nil
	}
	refs := referencesIn(s)
	switch {
	case len(refs) == 0:
		// A literal: convert it and see.
		_, err := coerce(s, kind)
		return err
	case len(refs) == 1 && isWholeReference(s, refs[0]):
		if kind == typeString {
			return nil // text is what a reference gives
		}
		name, isVar := varName(refs[0])
		if !isVar {
			return fmt.Errorf("ссылка «%s%s%s» даёт текст, а здесь ждут %s",
				tmplOpen, refs[0], tmplClose, kindWord(kind))
		}
		value, ok := known[name]
		if !ok {
			return nil // no list at hand: the stamp will say it at order time
		}
		if _, err := coerce(value, kind); err != nil {
			return fmt.Errorf("переменная «%s» сейчас равна «%s», а здесь ждут %s", name, value, kindWord(kind))
		}
		return nil
	default:
		// A reference inside text: the result is text, always.
		if kind == typeString {
			return nil
		}
		return fmt.Errorf("здесь ждут %s, а из ссылки внутри текста всегда получается текст", kindWord(kind))
	}
}

func kindWord(kind string) string {
	switch kind {
	case typeInteger:
		return "целое число"
	case typeNumber:
		return "число"
	case typeBoolean:
		return "«да» или «нет»"
	}
	return "значение другого вида"
}

// referencesIn lists the references a value uses, in the order they appear.
func referencesIn(s string) []string {
	var refs []string
	_, _ = walkTemplate(s, func(ref string) (string, error) {
		refs = append(refs, ref)
		return "", nil
	})
	return refs
}

// isWholeReference reports whether the value is nothing but this one reference,
// so what it renders to is what the reference holds.
func isWholeReference(s, ref string) bool {
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(s), tmplOpen), tmplClose))
	return strings.HasPrefix(strings.TrimSpace(s), tmplOpen) &&
		strings.HasSuffix(strings.TrimSpace(s), tmplClose) && inner == ref
}
