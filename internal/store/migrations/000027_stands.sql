-- Стенды: именованные места, куда уезжают заказы. У стенда свой кластер по
-- умолчанию, позже свои значения переменных, раскладка в Git и режим. Стенд -
-- глобальная сущность: все команды заказывают на одни и те же стенды и видят
-- на них только свои заказы. Кластер при этом остаётся полем заказа: у стенда
-- кластеров может быть несколько, стенд лишь говорит, с какого начинает форма.
CREATE TABLE IF NOT EXISTS stands (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  -- destination.name, которым открывается форма заказа на этом стенде.
  -- Проверка та же, что у кластера заказа: имя уходит в путь Git и в манифест.
  default_cluster TEXT NOT NULL CHECK (default_cluster ~ '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' AND length(default_cluster) <= 63),
  -- Стенд по умолчанию: туда попадает заказ без указанного стенда и все заказы,
  -- сделанные до появления стендов. Частичный уникальный индекс ниже держит
  -- ровно один такой стенд.
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_stand ON stands ((TRUE)) WHERE is_default;

-- Заказ привязан к стенду с момента создания и дальше его не меняет, как и
-- namespace. NULL остаётся только у строк, записанных до этой миграции: их
-- присоединяет к стенду по умолчанию портал на старте (store.SeedDefaultStand),
-- потому что имя кластера этого стенда он знает из конфигурации, а миграция нет.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS stand_id UUID REFERENCES stands(id);
CREATE INDEX IF NOT EXISTS idx_requests_stand ON requests (stand_id);
