package provisioning

import (
	"errors"
	"fmt"

	"console/pkg/models"
)

// Domain errors mapped to HTTP codes by the API layer.
var (
	ErrForbidden = errors.New("forbidden")
	ErrOpenMR    = errors.New("an open merge request already exists for this order")
	// ErrUpstream is an alias: the sentinel is shared with every other domain
	// that talks to an upstream, so a caller wrapping either name produces the
	// same 502.
	ErrUpstream = models.ErrUpstream
)

// FieldError is one schema-validation failure pinned to a values field.
// Path is a JSON Pointer into the submitted values (e.g. "/gateways/0/listeners/0").
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
	// Keyword is the schema rule the value broke: "required", "minLength",
	// "pattern", "minimum" and so on. The portal words the complaint itself,
	// in the same sentence the field's own hint uses, so what the validator
	// says ("length must be >= 3, but got 2") stays in the logs. Empty when the
	// failure did not come from a single keyword.
	Keyword string `json:"keyword,omitempty"`
}

// What a refused order says to the person who filled the form in. Russian and
// product-toned like the rest of the interface (see CLAUDE.md), and worded like
// the form's own hints, because the two are read one after the other: the name
// rule here is the sentence the field shows while it is being typed
// (web/src/form/fieldErrors.ts). The machinery the portal runs on - merge
// requests, states of the order's own FSM - is never what it answers with.
const (
	MsgServiceName   = "Имя сервиса: используйте строчные латинские буквы, цифры и дефис."
	MsgCluster       = "Кластер: используйте строчные латинские буквы, цифры и дефис."
	MsgUnknownChart  = "Такого сервиса или его версии больше нет. Обновите страницу и выберите доступную версию."
	MsgNotDraft      = "Заказ уже отправлен. Обновите страницу, чтобы увидеть, что с ним происходит."
	MsgNotLiveEdit   = "Сервис ещё создаётся. Изменить его можно будет, когда он заработает."
	MsgNotLiveDelete = "Сервис ещё создаётся. Удалить его можно будет, когда он заработает."
	// The detail of a values failure is kept: an order can be edited as YAML by
	// hand, and "line 4: mapping values are not allowed here" is exactly what
	// the person needs to fix what they typed.
	MsgBadValues     = "Не удалось прочитать значения заказа: "
	MsgEditorTooBig  = "На холсте слишком много элементов, портал не смог его сохранить."
	MsgEditorBadJSON = "Не удалось сохранить холст. Откройте граф заново и повторите."
)

// ValidationError is a 422 with a human-readable reason and, when it comes from
// schema validation, a per-field breakdown for the UI.
type ValidationError struct {
	Message string
	Fields  []FieldError
}

func (e *ValidationError) Error() string { return e.Message }

// OpenMRError is the 409 returned when a new change is blocked by an order's
// already-open merge request. It carries that MR's URL and IID so the API can
// point the user straight at it. errors.Is(err, ErrOpenMR) stays true, so the
// HTTP mapping and existing call sites keep working.
type OpenMRError struct {
	URL string
	IID int
}

func (e *OpenMRError) Error() string        { return ErrOpenMR.Error() }
func (e *OpenMRError) Is(target error) bool { return target == ErrOpenMR }

// conflictError is a 409 carrying a human-readable reason. errors.Is(err,
// models.ErrConflict) stays true (the API maps it to 409 and surfaces the
// message), so a uniqueness collision reads as actionable text rather than a
// bare "conflict". Mirrors the publications package pattern.
type conflictError struct{ msg string }

func (e *conflictError) Error() string        { return e.msg }
func (e *conflictError) Is(target error) bool { return target == models.ErrConflict }

func conflict(format string, a ...any) error {
	return &conflictError{msg: fmt.Sprintf(format, a...)}
}
