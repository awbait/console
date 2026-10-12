-- Режим стенда и реестр чартов.
--
-- mode: 'deploy' (файлы в git, merge request, Argo CD разворачивает, как было
-- всегда), 'git' (те же файлы и merge request, после слияния портал больше
-- ничего не делает) или 'console' (в git ничего не пишется, заказ живёт в
-- портале). Пока на стенде есть заказы, режим только для чтения, как раскладка.
--
-- chart_registry: реестр, из которого Argo CD берёт чарт для заказов стенда.
-- Пустая строка означает реестр платформы (CHART_REGISTRY).
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS mode           TEXT NOT NULL DEFAULT 'deploy' CHECK (mode IN ('deploy', 'git', 'console')),
  ADD COLUMN IF NOT EXISTS chart_registry TEXT NOT NULL DEFAULT '';
