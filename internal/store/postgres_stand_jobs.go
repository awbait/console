package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"console/pkg/models"
	"github.com/jackc/pgx/v5"
)

const standJobCols = `id, stand_id, kind, from_mode, to_mode, status, total, done, waiting, failures, created_by, created_at, finished_at`

func scanStandJob(row pgx.Row) (*models.StandJob, error) {
	var j models.StandJob
	var failures []byte
	err := row.Scan(&j.ID, &j.StandID, &j.Kind, &j.FromMode, &j.ToMode, &j.Status,
		&j.Total, &j.Done, &j.Waiting, &failures, &j.CreatedBy, &j.CreatedAt, &j.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) || isInvalidUUID(err) {
		return nil, models.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	j.Failures = []models.StandJobFailure{}
	if len(failures) > 0 {
		if err := json.Unmarshal(failures, &j.Failures); err != nil {
			return nil, fmt.Errorf("stand job failures: %w", err)
		}
	}
	return &j, nil
}

func jobFailures(j *models.StandJob) ([]byte, error) {
	if len(j.Failures) == 0 {
		return []byte("[]"), nil
	}
	return json.Marshal(j.Failures)
}

func (p *Postgres) CreateStandJob(ctx context.Context, j *models.StandJob) error {
	failures, err := jobFailures(j)
	if err != nil {
		return err
	}
	err = p.db.QueryRow(ctx, `
		INSERT INTO stand_jobs (id, stand_id, kind, from_mode, to_mode, status, total, done, waiting, failures, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING created_at`,
		j.ID, j.StandID, j.Kind, j.FromMode, j.ToMode, j.Status, j.Total, j.Done, j.Waiting, failures, j.CreatedBy).Scan(&j.CreatedAt)
	switch {
	case isUniqueViolation(err):
		return models.ErrConflict
	case isForeignKeyViolation(err) || isInvalidUUID(err):
		return models.ErrNotFound
	}
	return err
}

func (p *Postgres) UpdateStandJob(ctx context.Context, j *models.StandJob) error {
	failures, err := jobFailures(j)
	if err != nil {
		return err
	}
	tag, err := p.db.Exec(ctx, `
		UPDATE stand_jobs
		SET status=$2, total=$3, done=$4, waiting=$5, failures=$6, finished_at=$7
		WHERE id=$1`,
		j.ID, j.Status, j.Total, j.Done, j.Waiting, failures, j.FinishedAt)
	if isInvalidUUID(err) {
		return models.ErrNotFound
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return models.ErrNotFound
	}
	return nil
}

func (p *Postgres) GetStandJob(ctx context.Context, id string) (*models.StandJob, error) {
	return scanStandJob(p.db.QueryRow(ctx, `SELECT `+standJobCols+` FROM stand_jobs WHERE id=$1`, id))
}

func (p *Postgres) ListStandJobs(ctx context.Context, standID string) ([]*models.StandJob, error) {
	rows, err := p.db.Query(ctx, `SELECT `+standJobCols+` FROM stand_jobs WHERE stand_id=$1 ORDER BY created_at DESC`, standID)
	if isInvalidUUID(err) {
		return []*models.StandJob{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectStandJobs(rows)
}

func (p *Postgres) ListRunningStandJobs(ctx context.Context) ([]*models.StandJob, error) {
	rows, err := p.db.Query(ctx, `SELECT `+standJobCols+` FROM stand_jobs WHERE status='running' ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectStandJobs(rows)
}

func collectStandJobs(rows pgx.Rows) ([]*models.StandJob, error) {
	out := []*models.StandJob{}
	for rows.Next() {
		j, err := scanStandJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
