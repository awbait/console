-- Переопределения переменных по стендам.
--
-- Переменная - одна сущность: общее значение в variables.value и, при
-- необходимости, своё значение на отдельных стендах здесь. При сохранении
-- заказа портал берёт значение стенда заказа, а если его нет - общее. Общее
-- значение можно оставить пустым: тогда заказ на стенде без переопределения
-- не сохраняется, и ошибка называет переменную и стенд.
--
-- Строка без переменной или без стенда не имеет смысла, поэтому удаление
-- любого из них забирает переопределение с собой.
CREATE TABLE IF NOT EXISTS variable_overrides (
  variable_name TEXT NOT NULL REFERENCES variables(name) ON DELETE CASCADE,
  stand_id      UUID NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  value         TEXT NOT NULL,
  -- Кто менял в последний раз (OIDC sub) и когда, как у самой переменной.
  updated_by    TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (variable_name, stand_id)
);

-- Переопределения одного стенда читаются вместе, когда стенд удаляют или
-- показывают на его странице.
CREATE INDEX IF NOT EXISTS idx_variable_overrides_stand ON variable_overrides (stand_id);
