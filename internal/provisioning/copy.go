package provisioning

import (
	"context"
	"errors"
	"strings"

	"console/internal/views"
	"console/pkg/models"
	"gopkg.in/yaml.v3"
)

// Copying an order to another stand: a draft of the same service, in the same
// team, with the same values, on the stand chosen. The portal renders again
// only what it filled in itself from the platform's variables, because those
// are the values that are meant to differ between stands. Everything else is
// what the person decided for the original, and it stays.

// MsgCopyDeleted refuses a copy of an order that is gone: there is nothing to
// edit the copy against, and its values may name resources that no longer
// exist.
const MsgCopyDeleted = "Удалённый заказ нельзя скопировать."

// CopyInput says where the copy goes. An empty stand is the default stand, an
// empty cluster the stand's default, an empty name the original's.
type CopyInput struct {
	StandID     string
	Cluster     string
	ServiceName string
}

// Copy creates the draft. The person copying is its author, the way the
// author of a new order is the person filling in the form: the copy is their
// order, on their stand, from here on.
func (s *Service) Copy(ctx context.Context, u *models.User, id string, in CopyInput) (*models.Request, error) {
	src, err := s.Get(ctx, u, id)
	if err != nil {
		return nil, err
	}
	if !canProvision(u, src.Team) {
		return nil, ErrForbidden
	}
	if src.DeletedAt != nil || src.Status == models.StatusDeleted {
		return nil, &ValidationError{Message: MsgCopyDeleted}
	}
	values := map[string]any{}
	if strings.TrimSpace(src.ValuesYAML) != "" {
		if err := yaml.Unmarshal([]byte(src.ValuesYAML), &values); err != nil {
			return nil, &ValidationError{Message: MsgBadValues + err.Error()}
		}
		if values == nil {
			values = map[string]any{}
		}
	}
	name := strings.TrimSpace(in.ServiceName)
	if name == "" {
		name = src.ServiceName
	}
	stand, err := s.resolveStand(ctx, in.StandID)
	if err != nil {
		return nil, err
	}
	cluster, err := orderCluster(in.Cluster, stand)
	if err != nil {
		return nil, err
	}

	// The "initial" block, for the entries that name a variable, rendered for
	// the stand the copy goes to and written over the copied values. The rest
	// of the block seeded the original once and is not a prefill any more.
	view := s.orderView(ctx, src.ChartProject, src.ChartName, src.ChartVersion)
	if len(view) > 0 {
		vars, standName, err := s.templateVars(ctx, view, stand.ID)
		if err != nil {
			return nil, err
		}
		if vars != nil {
			var schema []byte
			if b, _, serr := s.catalog.FormSchema(ctx, src.ChartProject, src.ChartName, src.ChartVersion); serr == nil {
				schema = b
			}
			// Unlike a fresh form, a copy already knows its name, cluster and
			// namespace, so a template may have them too.
			rendered, rerr := views.RenderInitialVariables(view, views.TemplateData{
				Team: src.Team, ServiceName: name, Namespace: src.Namespace, Cluster: cluster,
				Chart: src.ChartName, ChartVersion: src.ChartVersion,
				User: views.TemplateUser{Name: u.Name, Subject: u.Subject},
				Vars: vars, Stand: standName,
			}, schema)
			if rerr != nil {
				var empty *views.VarEmptyError
				if errors.As(rerr, &empty) {
					return nil, &ValidationError{Message: empty.Error()}
				}
				return nil, &ValidationError{Message: MsgViewDefaults + rerr.Error() + " " + MsgViewDefaultsOwner}
			}
			if skipped := views.Overlay(values, rendered); len(skipped) > 0 {
				s.logger().Warn("copy: initial values skipped",
					"source", src.ID, "chart", src.ChartName, "pointers", strings.Join(skipped, " "))
			}
		}
	}

	// A display name that merely repeated the service name follows the new
	// name; one somebody chose is kept.
	displayName := src.DisplayName
	if displayName == src.ServiceName {
		displayName = ""
	}
	r, err := s.Create(ctx, u, CreateInput{
		ChartProject: src.ChartProject, ChartName: src.ChartName, Version: src.ChartVersion,
		Team: src.Team, ServiceName: name, DisplayName: displayName,
		StandID: stand.ID, Cluster: cluster, Namespace: src.Namespace,
		Values: values, EditorState: src.EditorState, Draft: true,
	})
	if err != nil {
		return nil, err
	}
	s.eventWith(ctx, r, byUser(u), "copied", "", "", map[string]any{
		"source_id": src.ID, "source_name": src.DisplayName, "stand_id": stand.ID, "stand": stand.Name,
	})
	s.logger().Info("order copied", "source", src.ID, "copy", r.ID, "stand", stand.ID, "actor", u.Subject)
	return r, nil
}
