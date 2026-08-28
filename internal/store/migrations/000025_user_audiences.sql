-- С какого момента человек состоит в той или иной аудитории уведомлений.
--
-- Адресат уведомления - правило, а не список: строка говорит «всем», «роли
-- admin», «команде core», и витрина отдаёт читателю всё, что под правило
-- подходит. Пока читатель один и тот же, это работает. Но новый человек
-- подходит под «всем» с первого же входа, и весь прошлый поток объявлений
-- оказывается для него непрочитанным - колокольчик полон ещё до того, как он
-- что-либо сделал. То же самое с ролью и командой: сегодняшний администратор
-- получал бы всю прошлую админскую ленту.
--
-- Здесь лежит пол под лентой каждого читателя: момент, когда портал впервые
-- увидел его в этой аудитории. Всё, что старше, адресовано тем, кто был в ней
-- тогда, а не ему.
CREATE TABLE IF NOT EXISTS user_audiences (
  subject      TEXT NOT NULL,                 -- OIDC sub читателя
  audience     TEXT NOT NULL,                 -- all | role | team (user сюда не попадает)
  audience_key TEXT NOT NULL DEFAULT '',      -- имя роли или команды; для all пусто
  since        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject, audience, audience_key)
);

-- Тем, кто уже ходит в портал, ничего терять не нужно: пол ставится по первому
-- входу из справочника пользователей. Непрочитанное с тех пор таким и остаётся,
-- а поток до их появления скрывается - ровно то, ради чего таблица заведена.
INSERT INTO user_audiences (subject, audience, audience_key, since)
SELECT subject, 'all', '', first_seen FROM users
ON CONFLICT DO NOTHING;

INSERT INTO user_audiences (subject, audience, audience_key, since)
SELECT subject, 'role', role, first_seen FROM users WHERE role <> ''
ON CONFLICT DO NOTHING;

INSERT INTO user_audiences (subject, audience, audience_key, since)
SELECT u.subject, 'team', t, u.first_seen FROM users u, unnest(u.teams) AS t
ON CONFLICT DO NOTHING;
