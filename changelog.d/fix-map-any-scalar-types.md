### Fixed

#### en

Dictionary fields in order forms now save values using the types described by the chart: unquoted numbers are saved as numbers, `true` and `false` as boolean values, `null` as an empty value, and other input as text. Quoted values such as `"5"` remain text, and values from saved orders or YAML keep their type when another entry is edited. Users and chart authors do not need to do anything.

#### ru

Поля-словари в форме заказа теперь сохраняют значения в типах, указанных в описании чарта: числа без кавычек сохраняются как числа, `true` и `false` как логические значения, `null` как пустое значение, а остальной ввод как текст. Значения в кавычках, например `"5"`, остаются текстом, а значения из сохранённого заказа или YAML сохраняют свой тип при редактировании другой записи. Пользователям и авторам чартов ничего делать не нужно.
