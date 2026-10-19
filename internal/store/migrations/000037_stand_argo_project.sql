-- argocd_project: проект Argo CD, в который попадают приложения заказов стенда
-- (spec.project в application.yaml и project в манифестах стенда). Пустая
-- строка - ARGOCD_PROJECT.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS argocd_project TEXT NOT NULL DEFAULT '';
