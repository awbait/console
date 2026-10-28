import type { GraphData, GraphProfile } from "../core/model";
import { object, type Values } from "../declarative/model";

export const records = (value: unknown): Values[] =>
	Array.isArray(value) ? value.filter(object) : [];
export const backendId = (ref: Values, namespace: string) =>
	`backend:${encodeURIComponent(JSON.stringify([ref.namespace || namespace, ref.name, ref.port]))}`;
export const gatewayId = (name: unknown) => `gateway:${String(name)}`;
export const namespaceId = (name: string) => `namespace:${name}`;

export const ingressProfile: GraphProfile = {
	id: "ingress-gateway",
	title: "Ingress Gateway",
	groupNoun: "Namespace",
	kinds: {
		gateway: { label: "Gateway", tone: "accent" },
		backend: { label: "backendRef" },
	},
	legend: [{ text: "xroute: нажмите на подпись, чтобы настроить маршрут" }],
	emptyHint: "Добавьте Gateway и backendRef, затем соедините их.",
	layout: { groups: "row", nodes: "flow" },
};

// The chart owns routes, including all rules, parents and weighted backends.
// The graph is only a projection; links never become extra Helm values.
export function ingressProjection(
	values: Values,
	namespace: string,
	areas: string[],
	drafts: Values[],
) {
	const data: GraphData = { groups: [], nodes: [], links: [] };
	const backends = new Map<string, Values>();
	const routes = new Map<string, number>();
	const issues: string[] = [];
	const namespaces = new Set([namespace, ...areas]);
	const gateways = records(values.gateways);
	const addBackend = (ref: Values) => {
		const id = backendId(ref, namespace);
		const ns = String(ref.namespace || namespace);
		namespaces.add(ns);
		if (!backends.has(id)) {
			backends.set(id, ref);
			data.nodes.push({
				id,
				groupId: namespaceId(ns),
				kind: "backend",
				title: String(ref.name ?? "?"),
				rows: [{ id: "port", label: `port: ${ref.port ?? "?"}` }],
			});
		}
		return id;
	};
	gateways.forEach((gateway) =>
		data.nodes.push({
			id: gatewayId(gateway.name),
			groupId: namespaceId(namespace),
			kind: "gateway",
			title: String(gateway.name),
			rows: records(gateway.listeners).map((listener) => ({
				id: String(listener.name),
				label: String(listener.name),
				tag: `${listener.protocol}:${listener.port}`,
			})),
		}),
	);
	records(values.xroutes).forEach((route, ri) => {
		records(route.parentRefs).forEach((parent, pi) => {
			const enabled = gateways.filter((gateway) => gateway.enabled !== false);
			const name =
				parent.gateway || (enabled.length === 1 ? enabled[0].name : undefined);
			const gateway = gateways.find((candidate) => candidate.name === name);
			if (!gateway) {
				issues.push(`${route.name}: не найдена точка входа ${name ?? ""}.`);
				return;
			}
			const listener = records(gateway.listeners).find(
				(candidate) => candidate.name === parent.sectionName,
			);
			if (!listener)
				issues.push(
					`${route.name}: не найден слушатель ${parent.sectionName}.`,
				);
			records(route.rules).forEach((rule, ruleIndex) => {
				const refs = records(rule.backendRefs);
				// Redirect-only rules still have an editable route on the canvas.
				const targets = refs.length ? refs.map(addBackend) : [gatewayId(name)];
				targets.forEach((target, bi) => {
					const id = `route:${ri}:${pi}:${ruleIndex}:${bi}`;
					routes.set(id, ri);
					data.links.push({
						id,
						from: gatewayId(name),
						fromRow: listener ? String(listener.name) : undefined,
						to: target,
						label: `${route.name}${route.enabled === false ? " (выключен)" : ""}`,
					});
				});
			});
		});
	});
	drafts.forEach(addBackend);
	data.groups = [...namespaces].map((name) => ({
		id: namespaceId(name),
		title: name,
		note: name === namespace ? "Namespace · Helm release" : "Namespace",
		accent: name === namespace ? "primary" : "secondary",
	}));
	return { data, backends, routes, issues };
}

export function replaceBackend(
	values: Values,
	old: Values,
	next: Values,
	namespace: string,
): Values {
	const id = backendId(old, namespace);
	return {
		...values,
		xroutes: records(values.xroutes).map((route) => ({
			...route,
			rules: records(route.rules).map((rule) =>
				!Array.isArray(rule.backendRefs)
					? rule
					: {
							...rule,
							backendRefs: records(rule.backendRefs).map((ref) => {
								if (backendId(ref, namespace) !== id) return ref;
								const updated: Values = {
									...ref,
									name: next.name,
									port: next.port,
								};
								if (next.namespace) updated.namespace = next.namespace;
								else delete updated.namespace;
								return updated;
							}),
						},
			),
		})),
	};
}

export function saveGateway(
	values: Values,
	index: number,
	gateway: Values,
): Values {
	const gateways = [...records(values.gateways)];
	const old = gateways[index];
	if (gateways.some((item, i) => i !== index && item.name === gateway.name))
		throw new Error("Имя Gateway уже занято.");
	if (index < 0) gateways.push(gateway);
	else gateways[index] = gateway;
	return {
		...values,
		gateways,
		...(old
			? {
					xroutes: records(values.xroutes).map((route) => ({
						...route,
						parentRefs: records(route.parentRefs).map((ref) =>
							ref.gateway === old.name
								? { ...ref, gateway: gateway.name }
								: ref,
						),
					})),
				}
			: {}),
	};
}

export const ingressValues: Values = {
	identity: { cluster: "tco", project: "demo", instance: "ed" },
	gateways: [
		{
			name: "main",
			enabled: true,
			listeners: [
				{
					name: "http",
					port: 80,
					protocol: "HTTP",
					hostname: "shop.example.test",
					allowedRoutes: {
						namespaces: { from: "Same" },
						kinds: [{ kind: "HTTPRoute" }],
					},
				},
			],
		},
	],
	xroutes: [
		{
			name: "shop",
			enabled: true,
			kind: "HTTPRoute",
			parentRefs: [{ gateway: "main", sectionName: "http" }],
			rules: [
				{
					matches: [{ path: { type: "PathPrefix", value: "/" } }],
					backendRefs: [
						{ name: "shop", port: 8080, weight: 90 },
						{ name: "shop-canary", port: 8080, weight: 10 },
					],
				},
			],
		},
		{
			name: "api",
			enabled: true,
			kind: "HTTPRoute",
			parentRefs: [{ gateway: "main", sectionName: "http" }],
			rules: [
				{
					matches: [{ path: { type: "PathPrefix", value: "/api" } }],
					timeouts: { request: "30s" },
					backendRefs: [{ name: "api", port: 8080 }],
				},
			],
		},
	],
};
