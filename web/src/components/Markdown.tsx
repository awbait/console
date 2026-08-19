import { lazy, Suspense } from "react";

// Markdown draws GitHub-flavoured markdown: a chart's description, a line of
// the changelog. The renderer and its parser are around a tenth of the portal's
// first bundle, and most visits never open a screen that shows any markdown at
// all, so the whole thing is fetched at the moment something needs drawing.
const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((m) => ({ default: m.MarkdownContent })),
);

// Nothing stands in while it arrives. What is waited for here is text that will
// take its own space once it is parsed, and a grey block flashing in its place
// for a fraction of a second says less than the empty space does.
export function Markdown({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <Suspense fallback={null}>
      <MarkdownContent inline={inline}>{children}</MarkdownContent>
    </Suspense>
  );
}
