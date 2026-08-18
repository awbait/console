-- Уведомления: одна строка на событие, а не на получателя.
--
-- Состав команды меняется, и «все члены команды» в момент события портал не
-- знает: справочника пользователей у него нет, в событиях лежит только OIDC
-- subject. Поэтому у уведомления не список адресатов, а правило видимости
-- (audience + audience_key), которое разворачивается в предикат при чтении.
--
-- Текст в базе не хранится: kind и payload, фраза собирается в интерфейсе.
-- Так тексты живут в одном месте (см. web/src/form/fieldErrors.ts) и не
-- застывают в старых строках при переписывании формулировок.
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY,                -- v7: сортировка по времени бесплатно
  kind         TEXT NOT NULL,                   -- order_healthy, version_rejected, ...
  subject_type TEXT NOT NULL,                   -- order | publication | version | platform
  subject_id   TEXT NOT NULL DEFAULT '',        -- на что ведёт ссылка
  audience     TEXT NOT NULL,                   -- user | team | role | all
  audience_key TEXT NOT NULL DEFAULT '',        -- subject | команда | роль | пусто для all
  actor        TEXT NOT NULL DEFAULT '',        -- OIDC subject автора действия
  actor_name   TEXT NOT NULL DEFAULT '',        -- его имя: позже его негде взять
  payload      JSONB,                           -- версия, комментарий отказа, имя сервиса
  level        TEXT NOT NULL DEFAULT 'info',    -- info | attention
  -- Ключ против повторов: фоновый цикл ходит раз в 15 секунд и без него
  -- превращает одно событие в 240 уведомлений в час.
  dedup_key    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Лента читается «кому видно, новые сверху»: индекс по аудитории и времени.
CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications(audience, audience_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(dedup_key) WHERE dedup_key IS NOT NULL;

-- Прочитано - персонально: одно уведомление видит целая команда, и каждый
-- отмечает его за себя.
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subject         TEXT NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_subject ON notification_reads(subject);

-- «Прочитать все» одной строкой вместо строки на каждое уведомление: всё, что
-- старше отметки, прочитано по умолчанию. Она же отсекает историю, накопленную
-- до того, как человек впервые открыл портал.
CREATE TABLE IF NOT EXISTS notification_cursor (
  subject        TEXT PRIMARY KEY,
  cleared_before TIMESTAMPTZ NOT NULL
);
