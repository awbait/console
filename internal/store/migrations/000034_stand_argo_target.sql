-- Как Argo CD стенда видит платформу.
--
-- git_url: адрес GitLab, из которого Argo CD стенда читает значения заказов:
-- другой адрес того же GitLab или зеркало с теми же путями. Пустая строка -
-- адрес, которым пользуется сам портал.
-- argocd_namespace: namespace, где работает Argo CD стенда и лежат его
-- Application. Пустая строка - ARGOCD_NAMESPACE.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS git_url          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS argocd_namespace TEXT NOT NULL DEFAULT '';
