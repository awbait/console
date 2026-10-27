### Fixed

#### en
Service order forms now handle conditions based on nested settings correctly. Dependent fields are marked required as soon as the setting is enabled, including when it is enabled by default. While the setting is off, those fields remain optional, and the form builder preview follows the same behavior. The form also evaluates other kinds of conditions correctly, so dependent fields are required only when those conditions are met.

#### ru
Форма заказа теперь правильно учитывает условия, зависящие от вложенных настроек. Зависимые поля сразу отмечаются обязательными, если настройка включена, в том числе по умолчанию. Пока настройка выключена, поля остаются необязательными, и предпросмотр конструктора работает так же. Форма также правильно проверяет условия других типов, поэтому зависимые поля обязательны, только когда эти условия выполнены.