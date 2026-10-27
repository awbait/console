### Added

#### ru
Добавили настраиваемый граф для коллекций values. В конструкторе версии можно выбрать типы узлов, связи и формы свойств. В графе можно создавать записи, соединять узлы и менять их настройки. Переименование узла обновляет ссылки на него. Попробовать редактор можно в локальной песочнице с примером Event Mesh.

Конструктор использует общий холст топологии: карточки с акцентами, группы и строки с точками подключения. В настройках можно выбрать поля для отображения и соединять конкретные строки. Пример Kubernetes открывается из страницы топологии и в песочнице; изменения сохраняются локально в браузере.

Области можно настроить как отдельные сущности с названием, параметрами и разрешёнными типами узлов. При перетаскивании узла рамка расширяется. Перенос в другую область доступен через меню по правой кнопке мыши; при запрете окно показывает ошибку и остаётся открытым. Подписи связей сохраняют читаемый размер при уменьшении масштаба.

#### en
Added configurable graphs for values collections. The version constructor lets authors define node types, connections and property forms. Users can create records, connect nodes and edit their settings on the graph. Renaming a node updates its references. A local playground includes an Event Mesh example.

The constructor now uses the shared topology canvas with card accents, groups and row connection points. Authors can map displayed fields and connect specific rows. A Kubernetes example opens from the topology page or the playground; changes stay in local browser storage.

Areas can be configured as records with names, properties and permitted node types. Dragging a node beyond its area expands the boundary. A context-menu action moves nodes between areas; rejected moves show an error and keep the dialog open. Connection labels remain readable when zooming out.
