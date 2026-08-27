-- Снятие версии сервиса с поддержки.
--
-- Отдельный признак рядом с orderable, а не новое значение status: status - это
-- FSM согласования (DRAFT -> PENDING -> APPROVED | REJECTED), из него считается
-- агрегат публикации и очередь у администратора. Депрекация ортогональна
-- согласованию: она отвечает не на вопрос «версию согласовали?», а на вопрос
-- «версию ещё поддерживают?».
--
-- deprecated_at NULL - версия на поддержке. Дата, а не булев флаг: «снята
-- 20 августа» портал показывает и в каталоге, и в карточке заказа, а из флага
-- эту дату потом взять неоткуда.
ALTER TABLE publication_versions
  ADD COLUMN IF NOT EXISTS deprecated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deprecated_by    TEXT NOT NULL DEFAULT '', -- OIDC sub снявшего
  ADD COLUMN IF NOT EXISTS deprecation_note TEXT NOT NULL DEFAULT ''; -- причина от владельца

-- «Что снято у этого сервиса» спрашивают на каждой отрисовке карточки чарта;
-- частичный индекс держит в себе только снятые версии, а их единицы.
CREATE INDEX IF NOT EXISTS idx_pub_versions_deprecated
  ON publication_versions(publication_id)
  WHERE deprecated_at IS NOT NULL;
