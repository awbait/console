### Fixed

#### en

Fixed orders staying in “deploying” without an error reason while Argo CD retried after failing to build the service. The order now switches to “failed” a few minutes after the error appears, even during retries, and its card shows the reason reported by Argo CD. Once the service builds successfully again, the order automatically returns to “running”. No action is required.

#### ru

Исправили зависание заказа в статусе «разворачивается» без объяснения причины, когда Argo CD не мог собрать сервис и повторял попытки. Теперь заказ переходит в «сбой» через несколько минут после появления ошибки даже при повторных попытках, а в карточке видна причина из Argo CD. Как только сервис снова собирается, заказ автоматически возвращается в «работает». Пользователю ничего делать не нужно.
