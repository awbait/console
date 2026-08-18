import {
  IconCheck,
  IconChevronDown,
  IconInfoCircle,
  IconPlugConnectedX,
  IconPointFilled,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Select as AriaSelect,
  TextField as AriaTextField,
  Tooltip as AriaTooltip,
  type ButtonProps,
  type CheckboxProps,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  OverlayArrow,
  Popover,
  SelectValue,
  TooltipTrigger,
} from "react-aria-components";
import { Link, type LinkProps } from "react-router-dom";
import type { FieldKind, FieldRequirement } from "../form/fieldErrors";

const btnVariants = {
  primary:
    "bg-brand-600 text-on-accent pressed:bg-brand-700 hover:bg-brand-700 border border-transparent",
  secondary:
    "bg-surface text-gray-800 border border-gray-300 hover:bg-gray-50 pressed:bg-gray-100",
  danger: "bg-red-600 text-white hover:bg-red-700 pressed:bg-red-800 border border-transparent",
};

// The colour transition is part of the base: a button can be disabled by
// something the user did not do - the platform health poll switching ordering
// off mid-page - and a control that greys out instantly reads as a glitch.
// Opacity rides the same transition as the colours (one transition-property
// wins, so `transition-colors` plus `transition-opacity` would drop the first).
const BTN_BASE =
  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-[color,background-color,border-color,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-brand-500 motion-reduce:transition-none";

// buttonClass builds the shared look for both <Button> and <LinkButton>, so a
// button and a button-shaped link can never drift apart.
export function buttonClass(variant: keyof typeof btnVariants = "secondary", className = "") {
  return `${BTN_BASE} ${btnVariants[variant]} ${className}`;
}

// Hint wraps a focusable trigger (a react-aria Button) with a styled tooltip,
// the same look as the small "i" hints. Note: a tooltip won't open on a truly
// `isDisabled` trigger - keep the button enabled and gate its action instead.
export function Hint({
  text,
  children,
  isOpen,
  onOpenChange,
  placement,
}: {
  text: ReactNode;
  children: ReactNode;
  // Controlled open state, for hints that have to be visible while the reader
  // is doing something else (typing in the field the hint is about). Left out,
  // the hint behaves as a plain tooltip: hover or focus its trigger.
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: "top" | "bottom" | "bottom start" | "bottom end" | "top start" | "top end";
}) {
  return (
    <TooltipTrigger delay={150} closeDelay={0} isOpen={isOpen} onOpenChange={onOpenChange}>
      {children}
      {/* The floating layer, not another card: bg-overlay sits above whatever it
          covers (in the dark themes by lightness, since a shadow on black is
          invisible), the edge is a shade stronger than a card border, and the
          arrow points at what the hint is about. Without those three it reads as
          a block that grew out of the page.

          It also arrives from somewhere: a few pixels along the axis it opened
          on, out of the trigger and back into it. A panel that only fades in has
          no direction and reads as appearing over the page rather than as
          coming out of the icon. Closing is quicker than opening - a hint on
          its way out should not be in the way. */}
      <AriaTooltip
        offset={8}
        placement={placement}
        className="group max-w-xs rounded-lg border border-overlay-edge overlay-panel bg-overlay px-3 py-2 text-xs text-slate-700 entering:animate-in entering:fade-in entering:zoom-in-95 entering:duration-150 entering:placement-bottom:slide-in-from-top-1 entering:placement-left:slide-in-from-right-1 entering:placement-right:slide-in-from-left-1 entering:placement-top:slide-in-from-bottom-1 exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:duration-100 motion-reduce:transition-none motion-reduce:animate-none"
      >
        <OverlayArrow className="group">
          {/* Rotated square rather than an SVG triangle: it inherits the panel's
              own background and border, so the two can never drift apart in
              either theme. Only the two outward edges are drawn; the panel
              covers the rest, which is what the 1px nudge is for. */}
          <span className="block h-2 w-2 rotate-45 border-b border-r border-overlay-edge bg-overlay group-placement-bottom:-mb-px group-placement-bottom:rotate-[225deg] group-placement-top:-mt-px" />
        </OverlayArrow>
        {text}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

// RequirementList: what a field accepts, one rule per line, each ticked off
// against what is typed so far. A list, not a paragraph - three rules run
// together into a sentence nobody finishes reading.
//
// An empty field is neutral: every rule unmet is true but useless, and a wall
// of red in front of someone who has not typed anything reads as a telling-off.
// State is carried by an icon as well as by colour, never by colour alone.
function RequirementList({ items, value }: { items: FieldRequirement[]; value: string }) {
  const empty = value.trim() === "";
  return (
    <ul className="flex flex-col gap-1">
      {items.map((r) => {
        const met = !empty && r.met(value);
        const failed = !empty && !met;
        return (
          <li
            key={r.text}
            className={`flex items-start gap-1.5 ${
              met ? "text-emerald-700" : failed ? "text-red-700" : "text-slate-600"
            }`}
          >
            <span className="mt-px shrink-0">
              {met ? (
                <IconCheck size={13} stroke={2.4} />
              ) : failed ? (
                <IconX size={13} stroke={2.4} />
              ) : (
                // slate-500, not slate-300: in the dark themes slate-300 is
                // darker than the panel it sits on, so the dot vanished. This
                // one stays quieter than the row it belongs to and is still
                // above the 3:1 a glyph needs, in both themes.
                <IconPointFilled size={13} className="text-slate-500" />
              )}
            </span>
            <span>{r.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonProps & { variant?: keyof typeof btnVariants }) {
  return <AriaButton {...props} className={buttonClass(variant, `disabled:opacity-50 ${className}`)} />;
}

// LinkButton: navigation that looks like a button. Use this instead of wrapping
// a <Button> in a <Link> - a <button> inside an <a> is invalid markup, the
// router never sees the click as its own, and the browser falls back to a full
// page load (the whole shell reloads). It also gives assistive tech one control
// to announce instead of two nested ones.
export function LinkButton({
  to,
  variant = "secondary",
  className = "",
  children,
  ...props
}: LinkProps & { variant?: keyof typeof btnVariants }) {
  return (
    <Link {...props} to={to} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function TextField({
  label,
  description,
  kind,
  requirements,
  value,
  onChange,
  errorText,
  onBlur,
  hideLabel,
  ...rest
}: {
  label: string;
  description?: string;
  // What kind of value this field takes (form/fieldErrors: a DNS label, a port,
  // a namespace). One prop instead of two: the field states the rules in its
  // hint and reports the first broken one under itself, from the same
  // definition, so a field cannot promise one thing and complain about another.
  // Fields built from a chart schema pass `requirements` and `errorText`
  // separately - the schema is their kind.
  kind?: FieldKind;
  // What the field accepts (characters, length, range), one line per rule, in
  // the wording of form/fieldErrors. Shown behind the "i" inside the field
  // rather than under it: the description below says what the field is for, and
  // the two used to be written into one sentence and read as neither. The list
  // opens by itself while the field is being typed into, ticking off what the
  // value already satisfies.
  requirements?: FieldRequirement[];
  value: string;
  onChange: (v: string) => void;
  // Everything the rules cannot know: a required field left empty, a name
  // already taken, a refusal from the server. The kind's own complaint comes
  // first - while the value is still malformed, that is the thing to fix.
  errorText?: string;
  onBlur?: () => void;
  // Render without a visible label (label becomes the aria-label). Used for
  // array rows where the field's meaning comes from the surrounding list.
  hideLabel?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
  type?: string;
  placeholder?: string;
  // Mobile keyboard hint for filtered numeric text inputs (see NumberInput).
  inputMode?: "numeric" | "decimal";
}) {
  const rules = requirements ?? kind?.requirements;
  const error = kind?.error(value) ?? errorText;
  const invalid = !!error;
  const hasRules = (rules?.length ?? 0) > 0;
  // The rules are needed while typing, and a tooltip on the icon is not open
  // then - so the field holds it open for as long as it has the caret. Hovering
  // the icon still works on its own, hence both states.
  const [hintHovered, setHintHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  return (
    <AriaTextField
      value={value}
      onChange={onChange}
      isRequired={rest.isRequired}
      isDisabled={rest.isDisabled}
      isInvalid={invalid}
      aria-label={hideLabel ? label : undefined}
      className="flex flex-col gap-1"
    >
      {!hideLabel && (
        <Label className="text-sm font-medium text-gray-700">
          {label}
          {rest.isRequired && <span className="text-red-500"> *</span>}
        </Label>
      )}
      <div className="relative">
        <Input
          type={rest.type}
          inputMode={rest.inputMode}
          placeholder={rest.placeholder}
          onFocus={() => setTyping(true)}
          onBlur={() => {
            setTyping(false);
            onBlur?.();
          }}
          // bg-surface, not the browser's default: an unstyled control keeps the
          // UA field colour, which is a light box on a near-black card in the dark
          // themes. The field reads as a field by its border (see index.css).
          // pr-8 with rules: the text stops before the "i" instead of running under it.
          className={`w-full rounded-md border bg-surface py-1.5 pl-2 text-sm outline-none placeholder:text-slate-400 focus:ring-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${
            hasRules ? "pr-8" : "pr-2"
          } ${
            invalid
              ? "border-red-500 focus:border-red-500 focus:ring-red-500"
              : "border-gray-300 focus:border-brand-500 focus:ring-brand-500"
          }`}
        />
        {hasRules && (
          <span className="absolute inset-y-0 right-1 flex items-center">
            <Hint
              text={<RequirementList items={rules ?? []} value={value} />}
              isOpen={typing || hintHovered}
              onOpenChange={setHintHovered}
              // Below the field: while typing, a hint over the label hides the
              // name of what is being filled in. Aligned to the end rather than
              // centred on the icon, so the panel finishes where the field
              // does instead of hanging past its right edge, which is what made
              // it look like a block of its own.
              placement="bottom end"
            >
              {/* A button, not a bare icon: the tooltip has to open on focus and
                  on tap too, not only under a mouse. */}
              <AriaButton
                aria-label="Требования к полю"
                className="rounded p-1 text-slate-400 outline-none transition-colors hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconInfoCircle size={15} stroke={1.8} />
              </AriaButton>
            </Hint>
          </span>
        )}
      </div>
      {error ? (
        <span className="text-xs text-red-600">{error}</span>
      ) : (
        description && <span className="text-xs text-gray-500">{description}</span>
      )}
    </AriaTextField>
  );
}

export function Checkbox({
  label,
  ...props
}: CheckboxProps & { label: string }) {
  return (
    <AriaCheckbox {...props} className="flex items-center gap-2 text-sm text-gray-700">
      {({ isSelected }) => (
        <>
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border ${
              isSelected ? "border-brand-600 bg-brand-600" : "border-gray-300"
            }`}
          >
            {isSelected && (
              <svg viewBox="0 0 18 18" className="h-3 w-3 fill-none stroke-on-accent stroke-[3]">
                <polyline points="1 9 7 14 15 4" />
              </svg>
            )}
          </span>
          {label}
          {props.isRequired && <span className="text-red-500"> *</span>}
        </>
      )}
    </AriaCheckbox>
  );
}

export function Select<T extends string>({
  label,
  description,
  selectedKey,
  onSelectionChange,
  options,
  isRequired,
  isDisabled,
  errorText,
  hideLabel,
  placeholder = "Выберите…",
  compact = false,
}: {
  label: string;
  description?: string;
  selectedKey: T | null;
  onSelectionChange: (key: T) => void;
  options: { id: T; label: string }[];
  isRequired?: boolean;
  isDisabled?: boolean;
  errorText?: string;
  // Render without a visible label (label becomes the aria-label).
  hideLabel?: boolean;
  // Shown by SelectValue when nothing is selected - defaults to a RU placeholder
  // instead of React Aria's built-in English "Select an item".
  placeholder?: string;
  // Small trigger (text-xs, tighter padding) for dense toolbars.
  compact?: boolean;
}) {
  const invalid = !!errorText;
  return (
    <AriaSelect
      selectedKey={selectedKey}
      onSelectionChange={(k) => onSelectionChange(k as T)}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={invalid}
      placeholder={placeholder}
      aria-label={hideLabel ? label : undefined}
      className="flex flex-col gap-1"
    >
      {!hideLabel && (
        <Label className="text-sm font-medium text-gray-700">
          {label}
          {isRequired && <span className="text-red-500"> *</span>}
        </Label>
      )}
      <AriaButton
        className={`flex items-center justify-between rounded-md border bg-surface outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ${
          compact ? "gap-1 px-2 py-1 text-xs" : "px-2 py-1.5 text-sm"
        } ${invalid ? "border-red-500" : "border-gray-300 focus:border-brand-500"}`}
      >
        <SelectValue className="truncate" />
        <IconChevronDown size={compact ? 14 : 16} className="shrink-0 text-gray-400" aria-hidden />
      </AriaButton>
      {errorText ? (
        <span className="text-xs text-red-600">{errorText}</span>
      ) : (
        description && <span className="text-xs text-gray-500">{description}</span>
      )}
      <Popover className="min-w-[var(--trigger-width)] rounded-md border border-gray-200 bg-surface shadow-lg">
        <ListBox className="max-h-60 overflow-auto p-1 outline-none">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              className={`cursor-pointer rounded px-2 py-1 outline-none focus:bg-brand-50 selected:bg-brand-100 ${
                compact ? "text-xs" : "text-sm"
              }`}
            >
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

// Card: the standard content box. Pass padded={false} when the card holds its
// own scrolling area - the padding then belongs to that area, so the scrollbar
// runs along the card's inner edge instead of outside its border.
export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-surface shadow-sm ${padded ? "p-4" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

// Chip: a single style for metadata badges in headers (category, owner, version...).
// Colors come from className: background + text (e.g. bg-slate-100 text-slate-600);
// inside, it's handy to prefix the caption with a muted <span> (text-slate-400).
export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

// A loading state that comes and goes within a few hundred milliseconds reads
// as a flash, not as feedback, so nothing is rendered until this delay passes.
// A cached page then swaps in silently and only a genuinely slow one says it is
// working.
const LOADING_DELAY_MS = 300;

// useDelayed reports whether the wait has lasted long enough to be worth
// showing. Shared by every loading state below so they all appear on the same
// beat instead of one panel flashing ahead of another.
function useDelayed(ms = LOADING_DELAY_MS): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return ready;
}

// Skeleton is one grey block standing in for content that is on its way. Give
// it the size of what it replaces: the point is that nothing moves when the
// real thing arrives. Silent to screen readers - the wrapper announces the wait
// once, and a dozen announced boxes would be noise.
//
// The fill is a theme token of its own rather than a step of the neutral scale:
// the same step reads differently at the two ends of it, and the light theme
// needs a deeper one to say the same thing (see --c-skeleton in index.css).
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded bg-skeleton motion-reduce:animate-none ${className}`}
    />
  );
}

// Placeholder wraps a skeleton layout: it holds the delay and makes the whole
// group one polite announcement.
function Placeholder({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ready = useDelayed();
  if (!ready) return null;
  return (
    <output aria-label={label} className={`block ${className}`}>
      {children}
    </output>
  );
}

// SkeletonText stands in for a block of prose (a readme, a changelog entry).
// The last line is short, like a real paragraph's is.
export function SkeletonText({ lines = 5, className = "" }: { lines?: number; className?: string }) {
  return (
    <Placeholder label="Загружаем текст" className={className}>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative list
            key={i}
            className={`h-3.5 ${i === lines - 1 ? "w-2/5" : i % 3 === 1 ? "w-11/12" : "w-full"}`}
          />
        ))}
      </div>
    </Placeholder>
  );
}

// SkeletonRows stands in for a list or a table body - one row per record.
export function SkeletonRows({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <Placeholder label="Загружаем список" className={className}>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface shadow-sm">
        {Array.from({ length: rows }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative list
            key={i}
            className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-b-0"
          >
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="ml-auto h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Placeholder>
  );
}

// SkeletonCards stands in for a grid of cards (the catalog). Same grid as the
// real one, so the page does not reflow when the data lands.
export function SkeletonCards({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <Placeholder label="Загружаем каталог" className={className}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative list
            key={i}
            className="rounded-lg border border-slate-200 bg-surface p-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Placeholder>
  );
}

// Loading is the honest wait, for cases where the shape of what is coming is
// unknown (a lazy-loaded editor, an action in flight) and a skeleton would be a
// guess. Everywhere the layout is known, a skeleton is the better answer.
export function Loading({ label = "Загружаем данные" }: { label?: string }) {
  const ready = useDelayed();
  if (!ready) return null;
  return (
    <output className="flex items-center gap-2.5 p-6 text-sm text-slate-500">
      <span
        aria-hidden
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500 motion-reduce:animate-none"
      />
      {label}
    </output>
  );
}

// OutageState is the whole page when the thing it was going to show cannot be
// loaded at all - an empty catalog page with a red box pinned to its top corner
// reads as a broken layout, not as an explanation. It says what is unavailable
// in the portal's own words and offers the one useful action: try again.
//
// The raw failure is deliberately absent: the message here already covers it,
// and "upstream unavailable: harbor: dial tcp" helps nobody standing in front
// of an empty catalog. It is still in the console and in the portal's logs.
export function OutageState({
  title,
  message,
  onRetry,
  icon,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center animate-in fade-in duration-300 motion-reduce:animate-none"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        {icon ?? <IconPlugConnectedX size={34} stroke={1.5} />}
      </span>
      <div>
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onPress={onRetry} className="gap-1.5">
          <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
          Повторить
        </Button>
      )}
    </div>
  );
}

// ErrorBox states a failure in one sentence (HttpError already carries product
// text, see api/errorText). `hint` says what the failure costs the user here -
// a dead catalog is not a dead portal, and only the caller knows the
// difference. `onRetry` is worth passing wherever the page has a reload: most
// of these failures are momentary, and a button beats explaining F5.
export function ErrorBox({
  error,
  hint,
  onRetry,
}: {
  error: Error;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p className="font-medium">{error.message}</p>
      {hint && <p className="mt-1.5 text-red-600">{hint}</p>}
      {onRetry && (
        <Button
          variant="secondary"
          onPress={onRetry}
          className="mt-3 border-red-200 bg-surface hover:bg-red-50"
        >
          Повторить
        </Button>
      )}
    </div>
  );
}
