package provisioning

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"

	"console/pkg/models"
)

// The manifests that connect Argo CD to a stand. The portal commits
// application.yaml files; what turns them into Applications is an
// app-of-apps that scans the stand's path, and the credentials Argo CD
// reads that path with. Neither is created by the portal: ops applies them
// once per deploying stand, from the stand page, the way the configured
// group was wired at installation. Rendered here so what ops applies is
// exactly what the portal writes against.

// standManifestData is what the templates know.
type standManifestData struct {
	Name        string // the stand, DNS-safe
	Stand       string // the stand as named
	GitLabURL   string
	GitLabAPI   string // the API root the SCM generator polls
	GitPath     string
	RepoURL     string // the one repository, under the repository layout
	Branch      string
	Project     string // the Argo CD project the applications belong to
	Namespace   string // where Argo CD reads Applications from
	TokenSecret string // the secret the SCM generator reads GitLab with
	// Registry is the stand's own chart registry, or "" for the platform's,
	// which Argo CD was given credentials for at installation.
	Registry string
}

// standRegistryManifest is the credential Argo CD pulls charts from a
// stand's own registry with: a repo-creds secret over the registry host, so
// every chart project under it is covered. Appended when the stand names a
// registry of its own.
var standRegistryManifest = template.Must(template.New("registry").Parse(`---
# Argo CD reads the charts of stand "{{.Stand}}" from {{.Registry}}, not from
# the platform registry: this gives it the credentials for that registry.
apiVersion: v1
kind: Secret
metadata:
  name: registry-{{.Name}}
  namespace: {{.Namespace}}
  labels:
    argocd.argoproj.io/secret-type: repo-creds
stringData:
  type: helm
  enableOCI: "true"
  url: {{.Registry}}
  username: "<registry user>"
  password: "<registry password>"
`))

// standGroupManifests is the app-of-apps of a stand laid out as a group: the
// SCM generator finds every repository under it, subgroups included, and
// each repository becomes one Application applying its committed
// application.yaml files. The same mechanism as deployments/kind, written
// for the stand's own path.
var standGroupManifests = template.Must(template.New("group").Parse(`# Argo CD wiring for stand "{{.Stand}}": one app-of-apps over its GitLab group.
# Apply once, from a context that may write to the {{.Namespace}} namespace.
# The secret with the GitLab token is shared by every stand; create it once.
apiVersion: v1
kind: Secret
metadata:
  name: {{.TokenSecret}}
  namespace: {{.Namespace}}
stringData:
  token: "<gitlab token with read_api>"
---
apiVersion: v1
kind: Secret
metadata:
  name: repo-gitlab-{{.Name}}
  namespace: {{.Namespace}}
  labels:
    argocd.argoproj.io/secret-type: repo-creds
stringData:
  type: git
  url: {{.GitLabURL}}/{{.GitPath}}
  username: oauth2
  password: "<gitlab token with read_repository>"
---
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: portal-stand-{{.Name}}
  namespace: {{.Namespace}}
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - scmProvider:
        requeueAfterSeconds: 60
        cloneProtocol: https
        gitlab:
          group: "{{.GitPath}}"
          api: {{.GitLabAPI}}
          includeSubgroups: true
          allBranches: false
          tokenRef:
            secretName: {{.TokenSecret}}
            key: token
  template:
    metadata:
      name: "{{"{{"}} lower .repository {{"}}"}}-{{"{{"}} trunc 8 (sha1sum .url) {{"}}"}}"
      labels:
        managed-by: portal
        portal.stand: "{{.Name}}"
    spec:
      project: {{.Project}}
      source:
        repoURL: "{{"{{"}} .url {{"}}"}}"
        targetRevision: "{{"{{"}} .branch {{"}}"}}"
        path: "."
        directory:
          recurse: true
          include: "**/application.yaml"
      destination:
        server: https://kubernetes.default.svc
        namespace: {{.Namespace}}
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
          allowEmpty: true
`))

// standRepoManifests is the app-of-apps of a stand laid out as one
// repository: a single Application applying every application.yaml in it.
var standRepoManifests = template.Must(template.New("repo").Parse(`# Argo CD wiring for stand "{{.Stand}}": one app-of-apps over its GitLab repository.
# Apply once, from a context that may write to the {{.Namespace}} namespace.
apiVersion: v1
kind: Secret
metadata:
  name: repo-gitlab-{{.Name}}
  namespace: {{.Namespace}}
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: git
  url: {{.RepoURL}}
  username: oauth2
  password: "<gitlab token with read_repository>"
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: portal-stand-{{.Name}}
  namespace: {{.Namespace}}
  labels:
    managed-by: portal
    portal.stand: "{{.Name}}"
spec:
  project: {{.Project}}
  source:
    repoURL: {{.RepoURL}}
    targetRevision: {{.Branch}}
    path: "."
    directory:
      recurse: true
      include: "**/application.yaml"
  destination:
    server: https://kubernetes.default.svc
    namespace: {{.Namespace}}
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: true
`))

// standSCMTokenSecret is the secret every stand's SCM generator reads GitLab
// with. One per Argo CD, the name the local stand uses.
const standSCMTokenSecret = "gitlab-scm-token"

// StandManifests renders the Argo CD manifests for a stand. A stand without a
// path has nothing to wire, and a stand nothing deploys from has no Argo CD
// to wire to.
func (s *Service) StandManifests(st *models.Stand) (string, error) {
	if !st.Deploys() {
		return "", &ValidationError{Message: MsgManifestsMode}
	}
	if st.GitPath == "" {
		return "", &ValidationError{Message: MsgStandPathEmpty}
	}
	// The stand's Argo CD may see GitLab under another address, and run in
	// another namespace: the manifests are written as it sees things.
	base := strings.TrimRight(s.GitLabURL, "/")
	if st.GitURL != "" {
		base = strings.TrimRight(st.GitURL, "/")
	}
	ns := s.ArgoCDNamespace
	if st.ArgoNamespace != "" {
		ns = st.ArgoNamespace
	}
	if ns == "" {
		ns = defaultAppNamespace
	}
	d := standManifestData{
		Name:        dnsName(st.Name),
		Stand:       st.Name,
		GitLabURL:   base,
		GitLabAPI:   base,
		GitPath:     st.GitPath,
		RepoURL:     base + "/" + st.GitPath + ".git",
		Branch:      s.defaultBranch,
		Project:     s.gitops.ArgoProjectOf(st),
		Namespace:   ns,
		TokenSecret: standSCMTokenSecret,
		Registry:    st.ChartRegistry,
	}
	tmpl := standGroupManifests
	if st.Layout == models.LayoutRepository {
		tmpl = standRepoManifests
	}
	var b bytes.Buffer
	if err := tmpl.Execute(&b, d); err != nil {
		return "", fmt.Errorf("stand manifests: %w", err)
	}
	if d.Registry != "" {
		if err := standRegistryManifest.Execute(&b, d); err != nil {
			return "", fmt.Errorf("stand manifests: %w", err)
		}
	}
	return b.String(), nil
}

// dnsName turns a stand's name into something a Kubernetes object may be
// called: lower case, letters, digits and dashes.
func dnsName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "stand"
	}
	if len(out) > 40 {
		out = strings.TrimRight(out[:40], "-")
	}
	return out
}
