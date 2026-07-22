/** @type {import('tailwindcss').Config} */

// Семантические токены тем (светлая/тёмная/РН) заданы CSS-переменными в index.css
// в формате «R G B». Здесь палитры Tailwind переопределены на эти переменные,
// чтобы существующие классы (bg-slate-50, text-red-600, bg-brand-600 …) сами
// следовали активной теме без правок в разметке. <alpha-value> сохраняет
// модификаторы прозрачности (bg-red-50/50, bg-black/20).
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const ramp = (hue, shades) => Object.fromEntries(shades.map((s) => [s, c(`${hue}-${s}`)]));

const NEUTRAL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // поверхности и текст-на-акценте
        surface: c("surface"), // карточки, нав, попап, инпуты (бывший bg-white)
        app: c("app"), // фон страницы
        "on-accent": c("on-accent"), // текст/иконка на акцентной заливке

        // акцент: синий (светлая/тёмная), жёлтый (РН)
        brand: ramp("brand", [50, 100, 200, 300, 400, 500, 600, 700]),

        // нейтрали: slate и gray делят одну тему-зависимую шкалу
        slate: ramp("neutral", NEUTRAL),
        gray: ramp("neutral", NEUTRAL),

        // статусные семейства (в тёмных темах — тёмная заливка + светлый текст)
        emerald: ramp("success", [50, 100, 200, 500, 600, 700, 800]),
        green: ramp("success", [50, 100, 200, 500, 600, 700, 800]),
        red: ramp("danger", [50, 100, 200, 500, 600, 700, 800]),
        amber: ramp("warning", [50, 100, 200, 300, 400, 500, 600, 700, 800]),
        sky: ramp("info", [50, 100, 200, 500, 600, 700, 800]),
        blue: ramp("info", [50, 100, 200, 500, 600, 700, 800]),
        indigo: ramp("violet", [100, 600, 800]),
        orange: ramp("orange", [100, 600, 800]),
      },
    },
  },
  plugins: [require("tailwindcss-react-aria-components"), require("tailwindcss-animate")],
};
