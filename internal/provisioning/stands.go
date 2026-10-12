package provisioning

import (
	"context"
	"errors"
	"strings"

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
)

// ListStands returns every stand, the default first. Open to anybody signed in:
// the order form offers them and the list filters by them.
func (s *Service) ListStands(ctx context.Context) ([]*models.Stand, error) {
	list, err := s.store.ListStands(ctx)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []*models.Stand{}
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
		return &models.Stand{DefaultCluster: s.defaultCluster}, nil
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

// UpdateStand renames a stand or changes the cluster its form opens with. The
// orders already on it are untouched: each keeps the cluster it was written
// with, the way it keeps its folder, because that is where its files and its
// application are.
func (s *Service) UpdateStand(ctx context.Context, u *models.User, st *models.Stand) error {
	if !u.IsAdmin() {
		return ErrForbidden
	}
	if err := checkStand(st); err != nil {
		return err
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
