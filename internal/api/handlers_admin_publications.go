package api

import (
	"net/http"

	"console/internal/publications"
	"console/internal/store"
)

// The admin's registry of publications (issue #470): GET /admin/publications
// answers with one row per publication, ready to list - the publication, a
// summary of its versions, how many orders run on it and what is wrong with
// it. The page used to assemble that from three endpoints and a request per
// publication, and the number of orders it could not get at all.

// registryOrders counts the orders placed on a publication's chart.
type registryOrders struct {
	// Live is the orders that stand for a running service (models.RequestStatus.Live);
	// Total every order that has not been deleted.
	Live  int `json:"live"`
	Total int `json:"total"`
}

type registryRow struct {
	publications.RegistryRow
	Orders registryOrders `json:"orders"`
}

func (s *Server) handleAdminPublications(w http.ResponseWriter, r *http.Request) {
	if !s.adminOnly(w, r, "the publications registry") {
		return
	}
	ctx := r.Context()
	rows, err := s.Pubs.Registry(ctx)
	if err != nil {
		s.writeDomainErr(w, r, err)
		return
	}
	// One pass over every order, grouped by chart: the registry is a few dozen
	// publications over a few hundred orders, and a count per publication would
	// be a query each.
	orders := map[string]registryOrders{}
	if reqs, err := s.Store.ListRequests(ctx, store.RequestFilter{Admin: true}); err == nil {
		for _, req := range reqs {
			key := req.ChartProject + "/" + req.ChartName
			o := orders[key]
			o.Total++
			if req.Status.Live() {
				o.Live++
			}
			orders[key] = o
		}
	} else {
		s.logger().Warn("registry: orders unavailable", "err", err)
	}
	out := make([]registryRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, registryRow{
			RegistryRow: row,
			Orders:      orders[row.Publication.ChartProject+"/"+row.Publication.ChartName],
		})
	}
	writeJSON(w, http.StatusOK, out)
}
