import type { TemplateRef } from "@/api/types";

// What a document may reference in "defaults", "initial" and the namespace
// template: the portal's fixed catalogue, as views.TemplateRefs() lists it in
// internal/views/tmpl.go. The portal adds its platform variables on top; the
// playground has none. refs.test.ts reads the Go file and fails when the two
// lists drift apart.
export const TEMPLATE_REFS: TemplateRef[] = [
  { ref: ".Team", desc: "Команда, от имени которой сделан заказ", at_order_form: true, in_namespace: true },
  { ref: ".ServiceName", desc: "Имя сервиса в заказе", at_order_form: false, in_namespace: true },
  { ref: ".Namespace", desc: "Неймспейс, в который уезжает заказ", at_order_form: false, in_namespace: false },
  { ref: ".Cluster", desc: "Кластер, в который уезжает заказ", at_order_form: false, in_namespace: true },
  { ref: ".Chart", desc: "Имя чарта", at_order_form: true, in_namespace: true },
  { ref: ".ChartVersion", desc: "Версия чарта", at_order_form: true, in_namespace: false },
  { ref: ".User.Name", desc: "ФИО автора заказа", at_order_form: true, in_namespace: false },
  { ref: ".User.Subject", desc: "Идентификатор автора заказа в OIDC", at_order_form: true, in_namespace: false },
];
