### Added

#### en
Added optional Git URL and Argo CD namespace settings for each stand. When left empty, they use the portal's GitLab URL and the namespace from the platform settings. The values are applied to order `application.yaml` files and Argo CD connection manifests on the stand page. Existing orders receive the new values when next modified. Changing the Git URL preserves the repository path, so a mirror must use the same path.

#### ru
Добавлены необязательные поля «Адрес Git» и «Namespace Argo CD» для каждого стенда. Если поля пусты, используются адрес GitLab портала и namespace из настроек платформы. Значения подставляются в `application.yaml` заказов и в манифесты для подключения Argo CD на странице стенда. Сохранённые заказы получают новые значения при следующем изменении. При замене адреса Git путь к репозиторию остаётся прежним, поэтому в зеркале он должен совпадать с исходным.
