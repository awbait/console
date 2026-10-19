package provisioning

import (
	"context"
	"errors"
	"strings"

	"console/internal/views"
	"console/pkg/models"
	"gopkg.in/yaml.v3"
)

// Copying an order: a draft of the same service, in the same team, with the
// same values, on the stand chosen. It is both "the same thing on another
// stand" and "one more like this on the same stand", and the two differ only
// in what has to change for the copy to be an order of its own. On another
// stand the name, the namespace and the identity may repeat the original's.
// On the same one they may not, so whatever was derived from the name follows
// the new name and what was not is left for the person to fill in.
//
// The portal renders again what it filled in itself and what has a different
// answer for the copy (see views.RenderInitialChanged). Everything else is
// what the person decided for the original, and it stays.
//
// A deleted order is restored the same way: as a new draft from its row,
// which a deletion keeps. It no longer holds its name, so on its own stand
// the copy may take the name, the identity and the display name back. The
// service's data is not part of the row and does not come back with it.
// Bringing the deleted row itself back to life would reopen a state every
// other part of the portal treats as final.

// CopyInput says where the copy goes. An empty stand is the default stand, an
// empty cluster the original's on its own stand and the stand's default on
// another, an empty name the original's. An empty namespace is the
// original's, or the new name when the original's namespace was its name.
type CopyInput struct {
	StandID     string
	Cluster     string
	ServiceName string
	Namespace   string
}

// Copy creates the draft. The person copying is its author, the way the
// author of a new order is the person filling in the form: the copy is their
// order from here on.
func (s *Service) Copy(ctx context.Context, u *models.User, id string, in CopyInput) (*models.Request, error) {
	src, err := s.Get(ctx, u, id)
	if err != nil {
		return nil, err
	}
	if !canProvision(u, src.Team) {
		return nil, ErrForbidden
	}
	deleted := src.DeletedAt != nil || src.Status == models.StatusDeleted
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
	sameStand := stand.ID == src.StandID
	// beside: the copy will stand next to a live original, so what names the
	// order must differ from it.
	beside := sameStand && !deleted
	clusterIn := strings.TrimSpace(in.Cluster)
	if clusterIn == "" && sameStand {
		clusterIn = src.Cluster
	}
	cluster, err := orderCluster(clusterIn, stand)
	if err != nil {
		return nil, err
	}
	version, err := s.copyVersion(ctx, src)
	if err != nil {
		return nil, err
	}

	// A namespace the portal took from the name (nobody typed one) follows the
	// new name. One somebody chose stays. A chart that sources the namespace
	// from its values or a constant ignores this, see resolveNamespace.
	namespace := strings.TrimSpace(in.Namespace)
	if namespace == "" {
		namespace = src.Namespace
		if src.Namespace == src.ServiceName {
			namespace = name
		}
	}

	// The values were written for the original's version, so its document
	// knows which field names the order, even when the copy goes to another
	// version that names it elsewhere or not at all.
	if version != src.ChartVersion {
		if srcView := s.versionView(ctx, src.ChartProject, src.ChartName, src.ChartVersion); len(srcView) > 0 {
			copyIdentity(srcView, values, src.ServiceName, name, beside)
		}
	}
	view := s.orderView(ctx, src.ChartProject, src.ChartName, version)
	if len(view) > 0 {
		copyIdentity(view, values, src.ServiceName, name, beside)
		if err := s.copyInitial(ctx, view, src, values, version,
			views.TemplateData{ServiceName: name, Namespace: namespace, Cluster: cluster}, stand.ID); err != nil {
			return nil, err
		}
	}

	// A display name that merely repeated the service name follows the new
	// name, and so does any next to the live original, where two orders under
	// one display name are two orders nobody tells apart. One somebody chose
	// is kept otherwise.
	displayName := src.DisplayName
	if displayName == src.ServiceName || beside {
		displayName = ""
	}
	r, err := s.Create(ctx, u, CreateInput{
		ChartProject: src.ChartProject, ChartName: src.ChartName, Version: version,
		Team: src.Team, ServiceName: name, DisplayName: displayName,
		StandID: stand.ID, Cluster: cluster, Namespace: namespace,
		Values: values, EditorState: src.EditorState, Draft: true,
	})
	if err != nil {
		return nil, err
	}
	s.eventWith(ctx, r, byUser(u), "copied", "", "", map[string]any{
		"source_id": src.ID, "source_name": src.DisplayName, "stand_id": stand.ID, "stand": stand.Name,
		"source_version": src.ChartVersion, "source_deleted": deleted,
	})
	s.logger().Info("order copied", "source", src.ID, "copy", r.ID, "stand", stand.ID,
		"version", version, "source_version", src.ChartVersion, "actor", u.Subject)
	return r, nil
}

// copyVersion is the version the copy is made of: the original's while it can
// still be ordered, else the highest version that can. A copy is a new order,
// so it may only pick what a new order may, but refusing it because the
// original is old would leave the person to fill in the whole form again.
func (s *Service) copyVersion(ctx context.Context, src *models.Request) (string, error) {
	err := s.ensureOrderable(ctx, src.ChartProject, src.ChartName, src.ChartVersion)
	var verr *ValidationError
	if err == nil || !errors.As(err, &verr) {
		return src.ChartVersion, err
	}
	if latest := s.latestOrderable(ctx, src.ChartProject, src.ChartName); latest != "" && latest != src.ChartVersion {
		return latest, nil
	}
	return "", err
}

// latestOrderable is the highest version of the chart's publication that can
// be ordered, or "" when there is none.
func (s *Service) latestOrderable(ctx context.Context, chartProject, chartName string) string {
	pub, err := s.store.GetPublicationByChart(ctx, chartProject, chartName)
	if err != nil || pub == nil {
		return ""
	}
	versions, err := s.store.ListVersions(ctx, pub.ID)
	if err != nil {
		return ""
	}
	best := ""
	for _, v := range versions {
		if v.Published() && (best == "" || models.CompareChartVersions(best, v.ChartVersion) < 0) {
			best = v.ChartVersion
		}
	}
	return best
}

// versionView is the approved view of exactly this version, whether or not it
// can still be ordered. Nil when it was never approved.
func (s *Service) versionView(ctx context.Context, chartProject, chartName, version string) []byte {
	pub, err := s.store.GetPublicationByChart(ctx, chartProject, chartName)
	if err != nil || pub == nil {
		return nil
	}
	v, err := s.store.GetVersion(ctx, pub.ID, version)
	if err != nil {
		return nil
	}
	return v.ApprovedViewJSON
}

// copyIdentity handles the values field a chart names its order by. One that
// repeated the original's name follows the new name. Any other is the
// original's own identity: on another stand, or in place of a deleted
// original, it may repeat. Next to a live original it would collide, so it is
// emptied and the form asks for it on submit.
func copyIdentity(view []byte, values map[string]any, oldName, newName string, beside bool) {
	ptr := views.OrderIdentity(view)
	if ptr == "" {
		return
	}
	cur, ok := views.ResolvePointer(values, ptr)
	if !ok {
		return
	}
	switch {
	case cur == newName:
		// Already the copy's: the original's document named the same field.
	case cur == oldName:
		views.Overlay(values, map[string]any{ptr: newName})
	case beside:
		views.Overlay(values, map[string]any{ptr: ""})
	}
}

// copyInitial writes over the copied values the "initial" entries whose
// answer is different for the copy than it was for the original: a new name,
// namespace, cluster or stand, a variable that has another value there. The
// author is the original's on both sides, so a field seeded from it keeps
// what the order holds.
func (s *Service) copyInitial(ctx context.Context, view []byte, src *models.Request,
	values map[string]any, version string, now views.TemplateData, standID string) error {
	vars, standName, err := s.templateVars(ctx, view, standID)
	if err != nil {
		return err
	}
	// The original's variables are only for comparing: when they cannot be
	// read, every entry that names one counts as changed.
	srcVars, _, _ := s.templateVars(ctx, view, src.StandID)
	user := views.TemplateUser{Name: src.CreatedByName, Subject: src.CreatedBy}
	was := views.TemplateData{
		Team: src.Team, ServiceName: src.ServiceName, Namespace: src.Namespace, Cluster: src.Cluster,
		Chart: src.ChartName, ChartVersion: src.ChartVersion, User: user, Vars: srcVars,
	}
	now.Team, now.Chart, now.ChartVersion, now.User = src.Team, src.ChartName, version, user
	now.Vars, now.Stand = vars, standName
	var schema []byte
	if b, _, serr := s.catalog.FormSchema(ctx, src.ChartProject, src.ChartName, version); serr == nil {
		schema = b
	}
	rendered, err := views.RenderInitialChanged(view, was, now, schema)
	if err != nil {
		var empty *views.VarEmptyError
		if errors.As(err, &empty) {
			return &ValidationError{Message: empty.Error()}
		}
		return &ValidationError{Message: MsgViewDefaults + err.Error() + " " + MsgViewDefaultsOwner}
	}
	if skipped := views.Overlay(values, rendered); len(skipped) > 0 {
		s.logger().Warn("copy: initial values skipped",
			"source", src.ID, "chart", src.ChartName, "pointers", strings.Join(skipped, " "))
	}
	return nil
}
