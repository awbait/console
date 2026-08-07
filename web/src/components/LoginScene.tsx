import { type CSSProperties, useCallback, useEffect, useState } from "react";
import "../features/graph/core/graph.css";
import { statusMeta } from "./StatusBadge";
import "./loginScene.css";

// The scene behind the sign-in panel: two still installations, shown one after
// the other, that say what the portal is for. Both are laid out in flat
// coordinates on a 940x460 plane which is then tilted as a whole, so the
// arrows meet the boxes exactly where they were drawn.
//
// The first installation is a fragment of the network map, built from the map's
// own styles (graph.css), so a first time visitor already sees the product
// rather than a stock illustration. The second one puts the same order side by
// side: done by hand on the left, placed through a form on the right.
//
// Everything here is plain markup on purpose - neither the canvas library nor
// the editor has any business loading before anyone is signed in.

const BOARD_W = 940;
const BOARD_H = 460;
// Long enough for the slower slide to finish its story (the file on the left is
// typed for about five seconds, the order lands at seven) and be looked at.
const SLIDE_MS = 10000;

interface Wire {
  d: string;
  from: [number, number];
  to: [number, number];
  delay: string;
}

// --- Installation 1: the network map ---------------------------------------

const NAMESPACES = [
  { name: "edge", x: 0, y: 30, w: 258, h: 130 },
  { name: "payments-prod", x: 340, y: 0, w: 258, h: 224 },
  { name: "data-prod", x: 650, y: 290, w: 258, h: 130 },
];

const WORKLOADS = [
  {
    name: "api-gateway",
    kind: "Ingress GW",
    badge: " rf-wl__badge--ingw",
    sa: "istio-ingress",
    port: "443",
    proto: "HTTP",
    x: 14,
    y: 70,
  },
  {
    name: "checkout",
    kind: "Deployment",
    sa: "checkout-sa",
    port: "8080",
    proto: "HTTP",
    x: 354,
    y: 40,
  },
  { name: "cart", kind: "Deployment", sa: "cart-sa", port: "8080", proto: "HTTP", x: 354, y: 134 },
  {
    name: "ledger",
    kind: "StatefulSet",
    sa: "ledger-sa",
    port: "5432",
    proto: "TCP",
    x: 664,
    y: 330,
  },
];

// Each wire leaves a card's outgoing dot and lands on a peer's port, the way a
// policy is drawn on the live map.
const MAP_WIRES: Wire[] = [
  { d: "M244 93 C296 93 302 103 354 103", from: [244, 93], to: [354, 103], delay: "0s" },
  { d: "M244 93 C300 93 300 197 354 197", from: [244, 93], to: [354, 197], delay: "1.1s" },
  { d: "M584 65 C636 65 612 393 664 393", from: [584, 65], to: [664, 393], delay: "2.2s" },
];

function MapInstallation() {
  return (
    <>
      {NAMESPACES.map((ns, i) => (
        <div
          key={ns.name}
          className="rf-ns login-scene__item"
          style={{ left: ns.x, top: ns.y, width: ns.w, height: ns.h, animationDelay: `${i * 90}ms` }}
        >
          <div className="rf-ns__title">
            <span className="rf-ns__name">{ns.name}</span>
          </div>
        </div>
      ))}

      {WORKLOADS.map((c, i) => (
        <div
          key={c.name}
          className="rf-wl login-scene__item"
          style={{ left: c.x, top: c.y, animationDelay: `${180 + i * 90}ms` }}
        >
          <div className="rf-wl__head">
            <div className="rf-wl__title">
              <span className="rf-wl__name">{c.name}</span>
              <span className={`rf-wl__badge${c.badge ?? ""}`}>{c.kind}</span>
            </div>
            <div className="rf-wl__sa">
              <span className="rf-wl__sa-label">sa</span>
              <span className="rf-wl__sa-value">{c.sa}</span>
            </div>
          </div>
          <div className="rf-wl__ports">
            <div className="rf-wl__port-row">
              <span className="rf-wl__port-label">
                <span className="rf-wl__port-num">{c.port}</span>
                <span className="rf-wl__port-proto">{c.proto}</span>
              </span>
            </div>
          </div>
        </div>
      ))}

      <Wires wires={MAP_WIRES} markerId="login-arrow-map" title="Карта сетевого взаимодействия" />
    </>
  );
}

// --- Installation 2: the same order, done both ways -------------------------
// Two columns side by side rather than one chain: the point is the difference.
// The left column is the work as it is done without the portal - written by
// hand, carried to a repository, chased through a review. The right column is
// the same order placed through a form, with everything after it happening on
// its own. The left side is drawn a step paler and its steps are unticked; the
// right side is in full colour and already ticked off.

// Hand-written values: indented by eye, and one line is already wrong.
const VALUES_LINES: { text: string; tone: "key" | "value" | "bad" }[] = [
  { text: "postgresql:", tone: "key" },
  { text: "  auth:", tone: "key" },
  { text: "    database: payments", tone: "value" },
  { text: "  primary:", tone: "key" },
  { text: "    persistence:", tone: "key" },
  { text: "      size: 100", tone: "bad" },
  { text: "  replication:", tone: "key" },
  { text: "    replicas: 3", tone: "value" },
];

// Typing: the box is as wide as the text is long, and the width grows one
// character at a time. Both sides are set in a monospaced face, so a character
// really is 1ch and the run lands exactly on the last glyph.
const typing = (text: string, delay: number, ms: number): CSSProperties =>
  ({
    "--type-w": `${text.length}ch`,
    animationDelay: `${delay}ms`,
    animationDuration: `${ms}ms`,
    animationTimingFunction: `steps(${Math.max(text.length, 1)})`,
  }) as CSSProperties;

const MANUAL_STEPS = [
  "Найти нужный репозиторий и путь",
  "Открыть merge request руками",
  "Искать, кто это согласует",
];

const FORM_FIELDS = [
  { label: "Namespace", value: "payments-prod" },
  { label: "База данных", value: "payments" },
  { label: "Размер диска", value: "100 Gi" },
  { label: "Реплики", value: "3" },
];

// What the portal does once the form is sent, in the words the order history
// itself uses. Statuses and their icons come from StatusBadge, so the picture
// cannot drift from the real thing.
// Approval is machinery, not news: the person who ordered cares that the order
// was taken, is being rolled out, and is running.
const ORDER_FLOW = [
  { status: "DRAFT", event: "Заказ создан", at: 3400 },
  { status: "DEPLOYING", event: "Заказ разворачивается", at: 4600 },
  { status: "HEALTHY", event: "Заказ развёрнут", at: 6600 },
];

const PRESS_AT = 3000;

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// The portal side runs on its own clock: the form fills itself, the button is
// pressed, and the order then walks the statuses one by one. Timers rather than
// CSS delays, because only the status the order is on may spin.
function ConsoleColumn() {
  const [pressed, setPressed] = useState(false);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reducedMotion()) {
      setPressed(true);
      setShown(ORDER_FLOW.length);
      return;
    }
    const timers = [window.setTimeout(() => setPressed(true), PRESS_AT)];
    ORDER_FLOW.forEach((s, i) => {
      timers.push(window.setTimeout(() => setShown(i + 1), s.at));
    });
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  return (
    <div className="login-col login-scene__item" style={{ left: 520, top: 46, animationDelay: "160ms" }}>
      <div className="login-col__title login-col__title--on">С консолью</div>

      <div className="login-doc">
        <div className="login-doc__head">
          <span>Заказ сервиса</span>
          <span className="login-doc__tag">postgres 16</span>
        </div>
        <div className="login-doc__body">
          {/* Field by field: each one lights up as it is filled. */}
          {FORM_FIELDS.map((f, i) => (
            <div key={f.label} className="login-field">
              <span className="login-field__label">{f.label}</span>
              <span className="login-field__value" style={{ animationDelay: `${350 + i * 420}ms` }}>
                <span className="login-field__text" style={typing(f.value, 350 + i * 420, 360)}>
                  {f.value}
                </span>
              </span>
            </div>
          ))}
          {/* The arrival delay belongs to the waiting button only: keeping it
              would push the press animation just as far into the future. */}
          <div
            className={`login-btn${pressed ? " login-btn--press" : ""}`}
            style={pressed ? undefined : { animationDelay: `${350 + FORM_FIELDS.length * 420}ms` }}
          >
            Заказать
          </div>
        </div>
      </div>

      {/* The path the order takes, all of it visible from the start: the steps
          wait greyed out, and the press sends the order down them one by one.
          The step it is on now is live, the ones behind it are records. */}
      <div className="login-list">
        <div className="login-list__note">дальше портал сам</div>
        {ORDER_FLOW.map((s, i) => (
          <OrderEvent
            key={s.status}
            status={s.status}
            event={s.event}
            state={i < shown - 1 ? "done" : i === shown - 1 ? "live" : "waiting"}
          />
        ))}
      </div>
    </div>
  );
}

function OrderEvent({
  status,
  event,
  state,
}: {
  status: string;
  event: string;
  state: "waiting" | "live" | "done";
}) {
  const meta = statusMeta(status);
  const reached = state !== "waiting";
  const spin = state === "live" && meta.spin;
  const Icon = spin ? meta.Icon : (meta.staticIcon ?? meta.Icon);
  return (
    <div className={`login-status login-status--${state}`}>
      <span className={`login-status__mark ${reached ? meta.badge : "bg-slate-100 text-slate-400"}`}>
        <Icon size={11} stroke={2} className={spin ? "animate-spin" : undefined} />
      </span>
      {event}
    </div>
  );
}

function CompareInstallation() {
  return (
    <>
      <div className="login-col login-col--manual login-scene__item" style={{ left: 0, top: 46 }}>
        <div className="login-col__title">Без консоли</div>

        <div className="login-doc login-doc--manual">
          <div className="login-doc__head">
            <span>values.yaml</span>
            <span className="login-doc__tag">вручную</span>
          </div>
          <div className="login-doc__body">
            {/* Line by line, the way it is actually written: slower than the
                form on the right, and that is the point. */}
            <pre className="login-code">
              {VALUES_LINES.map((l, i) => (
                <span
                  key={l.text}
                  className={`login-code__line login-code__line--${l.tone}`}
                  style={typing(l.text, 300 + i * 560, 420)}
                >
                  {l.text}
                </span>
              ))}
            </pre>
          </div>
        </div>

        <div className="login-list login-list--manual">
          {MANUAL_STEPS.map((s) => (
            <div key={s} className="login-step">
              <span className="login-step__mark login-step__mark--todo" />
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* The divide: the two columns are the same order, not two stories. */}
      <div className="login-divide login-scene__item" style={{ left: 462, top: 30 }} />

      <ConsoleColumn />
    </>
  );
}

// --- Shared parts ----------------------------------------------------------

// Wires draw last: their anchors sit on the box borders, so they have to run
// over the boxes to stay whole circles.
function Wires({ wires, markerId, title }: { wires: Wire[]; markerId: string; title: string }) {
  return (
    <svg className="login-scene__wires" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} fill="none">
      <title>{title}</title>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="login-scene__arrow" />
        </marker>
      </defs>
      {wires.map((w) => (
        <g key={w.d}>
          <path d={w.d} className="login-scene__wire" markerEnd={`url(#${markerId})`} />
          <circle cx={w.from[0]} cy={w.from[1]} r="3.5" className="login-scene__source" />
          <circle cx={w.to[0]} cy={w.to[1]} r="4.5" className="login-scene__target" />
          <circle
            r="3.5"
            className="login-scene__dot"
            style={{ offsetPath: `path("${w.d}")`, animationDelay: w.delay }}
          />
        </g>
      ))}
    </svg>
  );
}

// The comparison goes first: it is the answer to "why this portal at all", and
// the map is what the portal looks like once you are inside.
const SLIDES = [
  {
    id: "compare",
    caption: "Заполняете форму - остальное портал делает сам.",
    Installation: CompareInstallation,
  },
  {
    id: "map",
    caption: "Рисуете связи - сетевые политики портал настроит сам.",
    Installation: MapInstallation,
  },
];

export function LoginScene() {
  // Each slide carries how many times it has been shown, and only the slide
  // being switched TO counts up. The number is its React key, so the incoming
  // board remounts and plays from the start while the outgoing one keeps its
  // key and just fades - otherwise the slide being left would replay its whole
  // arrival on the way out, and look like the same slide flashing back.
  const [{ current, runs }, setSlide] = useState(() => ({
    current: 0,
    runs: SLIDES.map(() => 0),
  }));

  const show = useCallback((next: number) => {
    setSlide((s) => ({ current: next, runs: s.runs.map((r, i) => (i === next ? r + 1 : r)) }));
  }, []);

  // The timer restarts from the slide on screen, so picking one by hand gives
  // it a full turn instead of whatever was left of the previous one.
  useEffect(() => {
    const t = window.setTimeout(() => show((current + 1) % SLIDES.length), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [current, show]);

  const slide = SLIDES[current];

  return (
    <div className="login-scene">
      <div className="login-scene__plate">
        <div className="login-scene__grid" />
        <div className="login-scene__glow" />
        {/* Both boards stay mounted and cross-fade: a picture that blinks out
            and another that appears is a jump. The boards are out of the
            reading order - the caption below carries the same meaning in
            words. */}
        {SLIDES.map((s, i) => (
          <div
            key={s.id}
            className={`login-scene__board${i === current ? " login-scene__board--on" : ""}`}
            aria-hidden="true"
          >
            <s.Installation key={runs[i]} />
          </div>
        ))}
      </div>

      <div className="login-scene__legend">
        <p key={slide.id} className="login-scene__caption">
          {slide.caption}
        </p>
        <div className="login-scene__dots">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.caption}
              aria-current={i === current}
              onClick={() => show(i)}
              className={`login-scene__pip${i === current ? " login-scene__pip--on" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
