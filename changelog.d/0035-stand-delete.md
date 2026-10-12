### Added

#### en
Administrators can now delete a stand and its orders from the stand list. Deletion runs in the background and blocks new orders on the stand. Once all orders are deleted, the portal removes the stand, its variable values, and its GitLab group or repository if created by the portal. The group specified in platform settings and groups created outside the portal are preserved. The default stand, the last remaining stand, and stands with an active task cannot be deleted. If any order fails to delete or the task is stopped, the stand remains. Deleted orders cannot be restored. After successful deletion, administrators must manually remove the stand's ApplicationSet and secrets from Argo CD.

#### ru
Администратор может удалить стенд и его заказы со страницы «Стенды». Удаление выполняется в фоне и блокирует новые заказы на стенд. После удаления всех заказов портал удаляет стенд, значения его переменных и созданные порталом группу или репозиторий в GitLab. Группа, заданная в настройках платформы, и группы, созданные не порталом, сохраняются. Нельзя удалить стенд по умолчанию, последний стенд или стенд с активной задачей. Если заказ не удалось удалить или задача остановлена, стенд остаётся. Удалённые заказы не восстанавливаются. После успешного удаления администратору нужно вручную удалить ApplicationSet и секреты стенда в Argo CD.
