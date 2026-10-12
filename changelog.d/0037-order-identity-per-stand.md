### Fixed

#### en
Creating or copying orders to another stand no longer triggers a false duplicate-name error when the order name, namespace and cluster name match. Duplicate names in the same namespace and cluster are still refused within one stand. Importing orders from Git no longer skips an order because the same application name exists on another stand.

#### ru
При создании или копировании заказа на другой стенд больше не возникает ложная ошибка о занятом имени при совпадении имени заказа, пространства имён и имени кластера. В пределах одного стенда одинаковые имена в одном пространстве имён и кластере по-прежнему запрещены. Импорт заказов из Git больше не пропускает заказ, если приложение с таким же именем есть на другом стенде.
