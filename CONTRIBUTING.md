# Как участвовать в разработке

Правила проекта для людей и агентов собраны в одном файле: [AGENTS.md](AGENTS.md).
Здесь короткий путь от клонирования до первого PR.

## Рабочее место

Нужны Go 1.26 или новее, Bun 1.x, Python 3.11 или новее (скрипты скиллов,
сборщик журнала), Git и Make. Для локального стенда дополнительно Docker
Desktop, kubectl, Helm и KinD (`README.md`, раздел «Запуск для разработки»).

Один раз после клонирования:

```bash
go install github.com/evilmartians/lefthook@latest
make hooks                    # хуки lefthook на git push
cd web && bun install         # зависимости фронтенда
bun add -g @playwright/cli    # просмотр страниц в браузере, по желанию
```

Переводы строк закреплены в `.gitattributes`: в репозитории и в рабочей копии
LF на любой платформе, настройка `core.autocrlf` не нужна.

## Как устроена работа

1. **Задача** живёт в issue (`.github/ISSUE_TEMPLATE/`). Метки и статусы
   описаны в скилле `issue-workflow`. План одобряет и PR сливает владелец.
2. **Ветка** от `main`: `feat/42-short-description`, `fix/...`, `chore/...`,
   `docs/...`. В `main` напрямую не коммитим.
3. **Коммиты** по Conventional Commits, на английском, без упоминаний ИИ.
4. **Проверка до коммита**: `make test`, `make lint`, в `web/` -
   `bun run typecheck`, `bun test`. Lefthook повторит это на push.
5. **Запись в журнал** для изменений, которые видит пользователь: файл в
   `changelog.d/` по [README](changelog.d/README.md), `make changelog-check`.
6. **PR** в `main` с описанием, что изменилось и как проверено. Заголовок на
   английском в формате Conventional Commits. `Closes #N` закрывает issue.
7. **Релиз** делает владелец: `make changelog RELEASE=X.Y.Z`, PR из ветки
   `release/vX.Y.Z`, тег и GitHub Release создаёт CI.

Подробности каждого шага - в скиллах `.agents/skills/git-workflow/SKILL.md`,
`.agents/skills/issue-workflow/SKILL.md` и `.agents/skills/changelog/SKILL.md`.
Правила по областям кода лежат в `.claude/rules/`, таблица в `AGENTS.md`.

## Если работаете с агентом

Claude Code и Codex читают `AGENTS.md` и скиллы сами. Тексты, которые видит
пользователь (интерфейс, журнал, документация портала), пишет codex по правилу
`.claude/rules/user-facing-text.md`; остальное агент делает по общим правилам.
