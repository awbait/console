-- Раскладка стенда в Git и его точка сохранения.
--
-- layout: 'group' (под точкой сохранения подгруппа на команду и репозиторий
-- на сервис, как было всегда) или 'repository' (один репозиторий, заказы в
-- папках по команде и сервису). git_path: полный путь GitLab этой группы или
-- этого репозитория.
--
-- Пустой git_path остаётся только у стенда, записанного до этой миграции:
-- его заполняет портал на старте из GITLAB_GITOPS_GROUP (store.SeedDefaultStand),
-- потому что миграция этого значения не знает. Пока на стенде есть заказы,
-- оба поля только для чтения: иначе пришлось бы переносить папки в Git.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS layout   TEXT NOT NULL DEFAULT 'group' CHECK (layout IN ('group', 'repository')),
  ADD COLUMN IF NOT EXISTS git_path TEXT NOT NULL DEFAULT '';
