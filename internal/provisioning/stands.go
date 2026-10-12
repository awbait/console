package provisioning

import (
	"context"
	"errors"
	"strings"

	"console/internal/store"
	"console/pkg/models"
)

// Stands: the places an order is placed on (models.Stand). They live in this
// domain because an order cannot be written without one: the stand is where
// the form's cluster comes from, and later the variable values, the Git
// layout and the mode.

// What a refused stand says, product-toned like the rest (see errors.go) and
// worded from the same templates as the form's own field errors.
const (
	MsgStandNameEmpty = "Обязательное поле."
	MsgStandNameLong  = "Не длиннее 64 символов."
	MsgStandCluster   = "Используйте строчные латинские буквы, цифры и дефис."
	MsgStandNameTaken = "Имя «%s» уже занято."
	MsgStandUnknown   = "Этот стенд больше не существует. Обновите страницу и выберите стенд из списка."
	MsgStandPathEmpty = "Обязательное поле."
	MsgStandPath      = "Используйте латинские буквы, цифры, точку, дефис, подчёркивание и разделитель «/»."
	MsgStandLayout    = "Выберите раскладку из списка."
	MsgStandGitLocked = "Нельзя изменить раскладку или путь: на стенде есть заказы, кроме черновиков и удалённых."
)

// standOf is the stand an order is on, for the paths its files take. An order
// whose stand is gone, or one written before stands existed in a store that
// has none, falls back to the configured group: that is where such an order's
// files are.
func (s *Service) standOf(ctx context.Context, r *models.Request) *models.Stand {
	if r.StandID != "" {
		if st, err := s.store.GetStand(ctx, r.StandID); err == nil {
			return st
		}
	}
	return s.fallbackStand()
}

// fallbackStand is the shape of a portal with no stand to answer with: the
// configured cluster and group, laid out the way every order always was.
func (s *Service) fallbackStand() *models.Stand {
	return &models.Stand{DefaultCluster: s.defaultCluster, Layout: models.LayoutGroup, GitPath: s.gitops.TopGroup}
}

// repoPathOf is the full path of the repository an order's files are in.
func (s *Service) repoPathOf(ctx context.Context, r *models.Request) string {
	return s.gitops.RepoPath(s.standOf(ctx, r), r.Team, r.ChartName)
}

// GetStand returns one stand, with whether its layout is locked by orders.
func (s *Service) GetStand(ctx context.Context, id string) (*models.Stand, error) {
	st, err := s.store.GetStand(ctx, id)
	if err != nil {
		return nil, err
	}
	locked, err := s.standLocked(ctx, id)
	if err != nil {
		return nil, err
	}
	st.Locked = locked
	return st, nil
}

// standLocked reports whether the stand has orders that live in Git: anything
// but drafts and deleted ones. Their folders are where the layout says, so
// the layout cannot change under them.
func (s *Service) standLocked(ctx context.Context, id string) (bool, error) {
	list, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true, Stand: id})
	if err != nil {
		return false, err
	}
	for _, r := range list {
		if r.DeletedAt == nil && r.Status != models.StatusDraft && r.Status != models.StatusDeleted {
			return true, nil
		}
	}
	return false, nil
}

// ListStands returns every stand, the default first. Open to anybody signed in:
// the order form offers them and the list filters by them.
func (s *Service) ListStands(ctx context.Context) ([]*models.Stand, error) {
	list, err := s.store.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	if list == nil {
		return []*models.Stand{}, nil
	}
	// Which stands have orders in Git, in one read: the page greys out the
	// layout of those.
	orders, err := s.store.ListRequests(ctx, store.RequestFilter{Admin: true})
	if err != nil {
		return nil, err
	}
	locked := map[string]bool{}
	for _, r := range orders {
		if r.DeletedAt == nil && r.Status != models.StatusDraft && r.Status != models.StatusDeleted {
			locked[r.StandID] = true
		}
	}
	for _, st := range list {
		st.Locked = locked[st.ID]
	}
	return list, nil
}

// resolveStand answers which stand an order goes on: the one named, or the
// default when none is. A name nobody answers to is the caller's mistake.
//
// A store with no stand at all answers with the configured default cluster and
// no stand id. That is the shape of a store nothing was seeded into - the
// tests' in-memory one - and the behaviour every order had before stands
// existed; a running portal always has the stand SeedDefaultStand made.
func (s *Service) resolveStand(ctx context.Context, id string) (*models.Stand, error) {
	if id != "" {
		st, err := s.store.GetStand(ctx, id)
		if errors.Is(err, models.ErrNotFound) {
			return nil, &ValidationError{Message: MsgStandUnknown}
		}
		return st, err
	}
	st, err := s.store.DefaultStand(ctx)
	if errors.Is(err, models.ErrNotFound) {
		return s.fallbackStand(), nil
	}
	return st, err
}

// orderCluster is the cluster an order is written with: the one named, or the
// stand's default when none is. Either way it is checked here, because it lands
// in commit paths ({cluster}/{namespace}/{service}) and in the rendered
// application.yaml destination, and must not carry "../" or newlines there.
func orderCluster(named string, st *models.Stand) (string, error) {
	cluster := named
	if cluster == "" {
		cluster = st.DefaultCluster
	}
	if !validCluster(cluster) {
		return "", &ValidationError{Message: MsgCluster}
	}
	return cluster, nil
}

func validCluster(cluster string) bool {
	return nameRe.MatchString(cluster) && len(cluster) <= 63
}

// checkStand validates what an admin typed. The default cluster follows the
// rule of the order's cluster, because that is what it becomes.
func checkStand(st *models.Stand) error {
	st.Name = strings.TrimSpace(st.Name)
	st.DefaultCluster = strings.TrimSpace(st.DefaultCluster)
	if st.Name == "" {
		return &ValidationError{Message: MsgStandNameEmpty}
	}
	if len([]rune(st.Name)) > models.MaxStandName {
		return &ValidationError{Message: MsgStandNameLong}
	}
	if !validCluster(st.DefaultCluster) {
		return &ValidationError{Message: MsgStandCluster}
	}
	st.Layout = strings.TrimSpace(st.Layout)
	st.GitPath = strings.Trim(strings.TrimSpace(st.GitPath), "/")
	if st.Layout == "" {
		st.Layout = models.LayoutGroup
	}
	if !models.ValidLayout(st.Layout) {
		return &ValidationError{Message: MsgStandLayout}
	}
	if st.GitPath == "" {
		return &ValidationError{Message: MsgStandPathEmpty}
	}
	if !models.ValidGitPath(st.GitPath) {
		return &ValidationError{Message: MsgStandPath}
	}
	return nil
}

// CreateStand adds a stand. Admin only: a stand is a place every team orders
// onto. The first stand ever created becomes the default, so a portal is never
// left with stands and no default among them.
func (s *Service) CreateStand(ctx context.Context, u *models.User, st *models.Stand) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	if err := checkStand(st); err != nil {
		return err
	}
	st.ID = newID()
	if _, err := s.store.DefaultStand(ctx); errors.Is(err, models.ErrNotFound) {
		st.Default = true
	} else if err != nil {
		return err
	} else {
		st.Default = false
	}
	if err := s.store.CreateStand(ctx, st); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return conflict(MsgStandNameTaken, st.Name)
		}
		return err
	}
	s.logger().Info("stand created", "stand", st.ID, "stand_name", st.Name, "cluster", st.DefaultCluster, "actor", u.Subject)
	return nil
}

// UpdateStand renames a stand, changes the cluster its form opens with, or,
// while nothing is in Git for it yet, its layout and path. The orders already
// on it are untouched: each keeps the cluster it was written with, the way it
// keeps its folder, because that is where its files and its application are.
// Which is also why the layout is locked once there are such orders: it would
// put the next order of the stand somewhere else than the rest.
func (s *Service) UpdateStand(ctx context.Context, u *models.User, st *models.Stand) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	if err := checkStand(st); err != nil {
		return err
	}
	cur, err := s.store.GetStand(ctx, st.ID)
	if err != nil {
		return err
	}
	if cur.Layout != st.Layout || cur.GitPath != st.GitPath {
		locked, err := s.standLocked(ctx, st.ID)
		if err != nil {
			return err
		}
		if locked {
			return &ValidationError{Message: MsgStandGitLocked}
		}
	}
	if err := s.store.UpdateStand(ctx, st); err != nil {
		if errors.Is(err, models.ErrConflict) {
			return conflict(MsgStandNameTaken, st.Name)
		}
		return err
	}
	s.logger().Info("stand updated", "stand", st.ID, "stand_name", st.Name, "cluster", st.DefaultCluster, "actor", u.Subject)
	return nil
}

// SetDefaultStand moves the default flag onto this stand.
func (s *Service) SetDefaultStand(ctx context.Context, u *models.User, id string) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	if err := s.store.SetDefaultStand(ctx, id); err != nil {
		return err
	}
	s.logger().Info("stand made default", "stand", id, "actor", u.Subject)
	return nil
}
