import type { Definition } from "./model";

export const exampleDefinition: Definition = {
	profile: "declarative",
	version: 1,
	nodes: {
		broker: {
			collection: "/brokers",
			key: "/name",
			title: "Брокер",
			form: "broker",
		},
		consumer: {
			collection: "/consumers",
			key: "/name",
			title: "Получатель",
			form: "consumer",
		},
	},
	relations: {
		subscription: {
			collection: "/subscriptions",
			key: "/name",
			title: "Подписка",
			form: "subscription",
			from: { node: "broker", field: "/brokerRef" },
			to: { node: "consumer", field: "/consumerRef" },
		},
	},
};
export const exampleDocument = {
	views: {
		order: {},
		broker: { include: ["name", "class"] },
		consumer: { include: ["name", "url"] },
		subscription: {
			include: ["name", "brokerRef", "consumerRef", "filter", "retry"],
		},
	},
	graph: exampleDefinition,
};
const name = {
	type: "string",
	title: "Имя",
	minLength: 1,
	pattern: "^[a-z][a-z0-9-]*$",
};
export const exampleSchema = {
	type: "object",
	title: "Event Mesh",
	properties: {
		brokers: {
			type: "array",
			title: "Брокеры",
			items: {
				type: "object",
				required: ["name"],
				properties: {
					name,
					class: {
						type: "string",
						title: "Класс",
						enum: ["Kafka", "Memory"],
						default: "Kafka",
					},
				},
			},
		},
		consumers: {
			type: "array",
			title: "Получатели",
			items: {
				type: "object",
				required: ["name", "url"],
				properties: {
					name,
					url: { type: "string", title: "Адрес", minLength: 1 },
				},
			},
		},
		subscriptions: {
			type: "array",
			title: "Подписки",
			items: {
				type: "object",
				required: ["name", "brokerRef", "consumerRef"],
				properties: {
					name,
					brokerRef: { type: "string", title: "Брокер", minLength: 1 },
					consumerRef: { type: "string", title: "Получатель", minLength: 1 },
					filter: { type: "string", title: "Тип события" },
					retry: {
						type: "integer",
						title: "Повторные попытки",
						minimum: 0,
						default: 3,
					},
				},
			},
		},
		telemetry: { type: "object", properties: { enabled: { type: "boolean" } } },
	},
};
export const exampleValues = {
	brokers: [
		{ name: "orders", class: "Kafka" },
		{ name: "payments", class: "Kafka" },
	],
	consumers: [
		{ name: "checkout", url: "http://checkout" },
		{ name: "analytics", url: "http://analytics" },
		{ name: "invoicing", url: "http://invoicing" },
	],
	subscriptions: [
		{
			name: "order-created",
			brokerRef: "orders",
			consumerRef: "checkout",
			filter: "order.created",
			retry: 3,
		},
		{
			name: "all-orders",
			brokerRef: "orders",
			consumerRef: "analytics",
			retry: 5,
		},
		{
			name: "payment-captured",
			brokerRef: "payments",
			consumerRef: "invoicing",
			filter: "payment.captured",
			retry: 3,
		},
	],
	telemetry: { enabled: true },
};
