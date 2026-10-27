### Fixed

#### en

When a chart allows a list entry or field to be either a simple value or an object with settings, the form now lets you choose the entry type and shows its fields. The “Virtual hosts” tab now opens those fields instead of an empty dialog with a YAML editor message, and such lists can be filled in through the order form. Existing entries open as written, whether as a bare name or with settings such as a deletion policy and Kubernetes resource name. New entries start with the type that has fields, and an empty name is flagged as required before saving. Choices between plain values, such as text, numbers, or true/false, remain a single input. Developers and chart authors do not need to do anything.

#### ru

Если в чарте запись списка или поле может быть простым значением или объектом с настройками, в форме теперь можно выбрать тип записи и увидеть его поля. Вкладка «Виртуальные хосты» теперь открывает эти поля вместо пустого диалога с сообщением о YAML-редакторе, а такие списки можно заполнять в форме заказа. Существующие записи открываются в исходном виде: как простое имя или как имя с настройками, например с политикой удаления и именем ресурса Kubernetes. Для новых записей по умолчанию выбирается тип с полями, а пустое имя отмечается как обязательное до сохранения. Если на выбор доступны только простые значения, например текст, число или true/false, остаётся одно поле ввода. Разработчикам и авторам чартов ничего менять не нужно.