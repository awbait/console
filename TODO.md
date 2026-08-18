# TODO

Бэклог переехал в issue: https://github.com/awbait/console/issues

Здесь остался только порядок работ. Что делать и почему - в самих issue, там же
разбор кода и открытые вопросы. Этот файл больше не пополняется: новая задача
заводится issue.

Где смотреть контекст: спецификация - `docs/idp-spec.md`, конвенция чартов -
`docs/chart-convention.md`, локальный запуск - `docs/development.md`.

## Порядок работ

0. **Первая версия для пользователей** ([#177](https://github.com/awbait/console/issues/177)) -
   пять сервисов, доведённых до состояния «заказывается и обслуживается без
   нас». Всё остальное ждёт.
1. **Баги и недоделки ручного прохода** - видимые дефекты, чинятся первыми.
2. **Крупные фичи (роли и панели)** - ИБ-панель, Kyverno UI, карта сети.
3. **Деплой и эксплуатация портала** - Helm-чарт, область мониторинга GitLab,
   вебхуки, масштабирование.
4. **Код-ревью (остаток)** и **полировка фронта** - по остаточному принципу.

## Карта разделов

| Раздел | Issue |
|---|---|
| 0. Первая версия для пользователей | [#177](https://github.com/awbait/console/issues/177) (зонтичная), [#178](https://github.com/awbait/console/issues/178), [#179](https://github.com/awbait/console/issues/179), [#180](https://github.com/awbait/console/issues/180), [#181](https://github.com/awbait/console/issues/181), [#182](https://github.com/awbait/console/issues/182) |
| 1. Заказы и провижининг | [#183](https://github.com/awbait/console/issues/183), [#184](https://github.com/awbait/console/issues/184), [#185](https://github.com/awbait/console/issues/185), [#186](https://github.com/awbait/console/issues/186) |
| 1. Формы | [#187](https://github.com/awbait/console/issues/187), [#188](https://github.com/awbait/console/issues/188), [#189](https://github.com/awbait/console/issues/189) |
| 1. Статусы и история | [#190](https://github.com/awbait/console/issues/190), [#191](https://github.com/awbait/console/issues/191) |
| 2. Роли и панели | [#192](https://github.com/awbait/console/issues/192), [#193](https://github.com/awbait/console/issues/193) |
| 2. Карта сетевого взаимодействия | [#194](https://github.com/awbait/console/issues/194), [#195](https://github.com/awbait/console/issues/195), [#196](https://github.com/awbait/console/issues/196), [#197](https://github.com/awbait/console/issues/197), [#198](https://github.com/awbait/console/issues/198), [#199](https://github.com/awbait/console/issues/199), [#200](https://github.com/awbait/console/issues/200) |
| 3. Интеграция с NetBox | [#201](https://github.com/awbait/console/issues/201) |
| 4. Деплой и эксплуатация | [#202](https://github.com/awbait/console/issues/202), [#203](https://github.com/awbait/console/issues/203), [#204](https://github.com/awbait/console/issues/204), [#205](https://github.com/awbait/console/issues/205), [#206](https://github.com/awbait/console/issues/206) |
| 5. Код-ревью (остаток) | [#207](https://github.com/awbait/console/issues/207) |
| 6. Полировка фронта | [#208](https://github.com/awbait/console/issues/208), [#209](https://github.com/awbait/console/issues/209), [#210](https://github.com/awbait/console/issues/210), [#211](https://github.com/awbait/console/issues/211) |
| 7. Чистка | [#212](https://github.com/awbait/console/issues/212), [#213](https://github.com/awbait/console/issues/213) |

Принятые решения «не делаем» (L4, L7, L14) записаны в
[#213](https://github.com/awbait/console/issues/213).
