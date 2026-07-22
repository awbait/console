package models

import (
	"strconv"
	"strings"
)

// CompareChartVersions orders Helm SemVer-ish versions by numeric
// major.minor.patch (a leading "v" and any pre-release/build suffix are ignored
// for ordering). It is a best-effort comparison for picking the highest
// published version; unparsable parts compare as 0, with a lexicographic
// tie-break so the order stays deterministic.
func CompareChartVersions(a, b string) int {
	pa, pb := splitChartVersion(a), splitChartVersion(b)
	for i := range 3 {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1
			}
			return 1
		}
	}
	return strings.Compare(a, b)
}

func splitChartVersion(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		out[i], _ = strconv.Atoi(strings.TrimSpace(part))
	}
	return out
}
