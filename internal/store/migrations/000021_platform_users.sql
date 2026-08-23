-- Справочник пользователей платформы: кто вообще заходил в портал.
--
-- Портал не имеет доступа к списку пользователей Keycloak: он видит только
-- того, кто прямо сейчас пришёл с токеном. Поэтому справочник накапливается
-- сам, из входов: первый заход создаёт строку, каждый следующий обновляет
-- имя, команды и роль. Человек, который ни разу не логинился, сюда не
-- попадает - для обзорной статистики это как раз наименее интересная часть.
--
-- Команды хранятся тут же, а не в отдельной таблице: их состав целиком
-- определяется группами в токене, портал их не редактирует, и «команда» без
-- единого зашедшего участника не существует ни для одной страницы.
CREATE TABLE IF NOT EXISTS platform_users (
  subject    TEXT PRIMARY KEY,                    -- OIDC sub: единственный стабильный ключ
  email      TEXT NOT NULL DEFAULT '',
  username   TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  teams      TEXT[] NOT NULL DEFAULT '{}',        -- команды из групп токена, на момент последнего входа
  role       TEXT NOT NULL DEFAULT '',            -- роль портала: admin | support | security | member | auditor
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Считается не «запросов», а окон активности: строка обновляется не чаще
  -- раза в несколько минут на пользователя (иначе это сотни апдейтов в
  -- минуту), и каждое такое обновление и есть один визит.
  visits     BIGINT NOT NULL DEFAULT 1
);

-- «Кто заходил за сутки / за неделю» и лента справочника: обе сортируют по
-- последнему визиту.
CREATE INDEX IF NOT EXISTS idx_platform_users_last_seen ON platform_users(last_seen DESC);
-- Разрез по командам: фильтр «состав команды» и подсчёт размеров команд.
CREATE INDEX IF NOT EXISTS idx_platform_users_teams ON platform_users USING GIN(teams);
