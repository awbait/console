### Fixed

#### en

The same service ordered on different stands now gets distinct application names, preventing conflicts in Argo CD. Application names for existing orders remain unchanged. If an application name is already used by an order on another stand in the same Argo CD instance, the portal rejects the new order and asks you to choose a different service name.

#### ru

При заказе одного сервиса на разных стендах приложения теперь получают разные имена и больше не конфликтуют в Argo CD. У заказов, созданных раньше, имена приложений не меняются. Если имя приложения уже занято заказом другого стенда в том же Argo CD, портал отклоняет новый заказ и просит выбрать другое имя сервиса.