-- Результаты проверок стенда и признак подключения Argo CD.
--
-- Проверки стенда (доступ к пути в GitLab, кластеры и приложения в Argo CD,
-- вложенные пути) теперь выполняются и в фоне, а не только при открытии
-- страницы стенда. Последний результат каждой проверки хранится здесь: его
-- читают страница стенда и сводка на странице состояния.
--
-- argo_connected: Argo CD видит приложения стенда. Выставляется проверкой
-- приложений: приложения найдены - true, при живых заказах не найдено ни
-- одного - false. Пока стенд не подключён, его заказы после слияния ждут, и
-- страница заказа говорит, чего именно. По умолчанию true: стенд, который
-- ещё не проверяли, не объявляется отключённым.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS argo_connected BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS checked_at     TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS stand_checks (
  stand_id   UUID NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  check_id   TEXT NOT NULL,
  component  TEXT NOT NULL,
  verdict    TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  facts      JSONB NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (stand_id, check_id)
);
