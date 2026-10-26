// The built-in example: a small web application chart and a document over it.
// Enough shapes to show what the form does with each - a number with bounds, a
// block, an enum, a boolean, a list of strings - and one list kept off the
// order form and shown as a product tab instead.
export const SAMPLE_SCHEMA = `{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "title": "Веб-приложение",
  "type": "object",
  "required": ["image"],
  "properties": {
    "replicas": {
      "type": "integer",
      "title": "Число реплик",
      "description": "Укажите, сколько копий приложения нужно запустить.",
      "minimum": 1,
      "maximum": 10,
      "default": 2
    },
    "image": {
      "type": "object",
      "title": "Образ контейнера",
      "description": "Выберите образ для запуска приложения.",
      "required": ["repository"],
      "properties": {
        "repository": {
          "type": "string",
          "title": "Адрес образа",
          "description": "Укажите адрес образа в реестре контейнеров."
        },
        "tag": {
          "type": "string",
          "title": "Тег образа",
          "description": "Укажите тег нужной версии образа.",
          "default": "latest"
        }
      }
    },
    "logLevel": {
      "type": "string",
      "title": "Уровень логирования",
      "description": "Выберите, насколько подробные сообщения приложение будет записывать в журнал.",
      "enum": ["debug", "info", "warn", "error"],
      "default": "info"
    },
    "resources": {
      "type": "object",
      "title": "Ресурсы",
      "description": "Задайте ограничения на использование процессора и памяти.",
      "properties": {
        "cpu": {
          "type": "string",
          "title": "Лимит процессора",
          "description": "Укажите, сколько процессора может использовать каждая копия приложения, например 500m.",
          "pattern": "^[0-9]+m?$",
          "default": "500m"
        },
        "memory": {
          "type": "string",
          "title": "Лимит памяти",
          "description": "Укажите, сколько памяти может использовать каждая копия приложения, например 512Mi.",
          "pattern": "^[0-9]+(Mi|Gi)$",
          "default": "512Mi"
        }
      }
    },
    "ingress": {
      "type": "object",
      "title": "Внешний доступ",
      "description": "Настройте доступ к приложению извне кластера.",
      "properties": {
        "enabled": {
          "type": "boolean",
          "title": "Разрешить внешний доступ",
          "description": "Включите доступ к приложению по указанным доменным именам.",
          "default": false
        },
        "hosts": {
          "type": "array",
          "title": "Доменные имена",
          "description": "Укажите доменные имена, по которым будет доступно приложение.",
          "items": { "type": "string" }
        }
      }
    },
    "env": {
      "type": "array",
      "title": "Переменные окружения",
      "description": "Добавьте настройки, которые приложение получит через переменные окружения.",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {
            "type": "string",
            "title": "Имя переменной",
            "description": "Укажите имя переменной, которую читает приложение."
          },
          "value": {
            "type": "string",
            "title": "Значение переменной",
            "description": "Укажите значение, которое приложение получит в этой переменной."
          }
        }
      }
    }
  }
}
`;

export const SAMPLE_VIEW = `{
  "views": {
    "order": {
      "include": ["replicas", "image", "logLevel", "resources", "ingress"]
    },
    "envRow": {}
  },
  "tabs": [
    {
      "id": "env",
      "title": "Переменные окружения",
      "items": "/env",
      "form": "envRow",
      "addLabel": "Добавить переменную",
      "ui:uniqueBy": "name",
      "ui:table": [
        { "path": "name", "label": "Имя переменной" },
        { "path": "value", "label": "Значение переменной" }
      ]
    }
  ]
}
`;
