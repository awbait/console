### Added

#### en
Stands now support three modes. "Deploy" keeps the existing workflow: the portal saves order files to Git and opens a merge request. After the merge, Argo CD deploys the service while the portal tracks its status. "Git only" saves the same files to Git and opens a merge request. After the merge, the order receives the status "Saved in Git" and no further action runs. "Console only" stores the order in the portal without writing to Git and immediately sets its status to "Saved in console". Edits and deletion apply immediately without a merge request. You can change the mode only when the stand has no orders other than drafts and deleted orders. Each stand can also specify its own chart registry for Argo CD. Leave this value empty to use the platform registry.

#### ru
Добавлено поле «Режим» с тремя вариантами для стенда. «Разворачивать» сохраняет файлы заказа в Git, открывает merge request и отслеживает развёртывание через Argo CD после слияния. «Только Git» сохраняет те же файлы в Git и открывает merge request, после слияния которого обработка завершается. «Только консоль» хранит заказы только в портале, изменения и удаление выполняются сразу. Добавлены статусы заказа «Сохранён в Git» и «Сохранён в консоли». Для каждого стенда можно указать реестр чартов для Argo CD, при пустом значении используется реестр платформы.
