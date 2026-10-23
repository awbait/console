-- argocd_git_path: путь в GitLab, по которому Argo CD стенда читает файлы
-- заказов, когда это не git_path: репозиторий зеркалируется или перенесён под
-- другой путь, и repoURL в application.yaml должен называть именно его.
-- Подменяет git_path в repoURL и в манифестах стенда, портал по-прежнему
-- пишет под git_path. Пустая строка - git_path.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS argocd_git_path TEXT NOT NULL DEFAULT '';
