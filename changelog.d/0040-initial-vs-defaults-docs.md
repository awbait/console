### Changed

#### en

Extended the "Order form constructor" documentation with an explanation of why hiding a field filled through `initial` does not replace `defaults`. The new section explains how hidden fields can still be changed, why changes to `initial` do not update existing field values in orders, and when to use `defaults` to enforce a value on every save.

#### ru

Дополнили раздел документации «Конструктор формы заказа» объяснением, почему скрытие поля, заполненного через `initial`, не заменяет `defaults`. В новом разделе разобрали, как можно изменить скрытые поля, почему изменения `initial` не обновляют уже заданные значения в заказах и когда использовать `defaults` для принудительной записи значения при каждом сохранении.
