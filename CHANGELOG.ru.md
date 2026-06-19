# Список изменений

Все значимые изменения проекта фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

### Добавлено
- CI/релизный пайплайн на GitHub Actions: проверки PR/main (`ci.yml`), создание
  тега и GitHub Release при мерже `release/*` PR (`release.yml`), сборка и
  публикация multi-arch образов portal и collector в GHCR по тегам `v*`
  (`publish.yml`).
