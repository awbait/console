import type { ReactNode } from "react";

// Page and PageBody are the frame every page sits in, the way PageHeader is its
// top block. Pages used to spell the frame out themselves: a column with a
// header and a scrolling body, copied a dozen times with a gap of 4, 5 or 6
// between the two and the scrollbar lane left to chance. One frame, filled by
// the page:
//
//   <Page>
//     <PageHeader ... />        stays put
//     <PageBody> ... </PageBody> scrolls
//   </Page>
//
// A page with panes of its own (an editor, a split view) uses Page alone and
// scrolls its panes itself.

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-h-0 flex-1 flex-col gap-5 ${className}`}>{children}</div>;
}

// Space between the blocks of a page body: "sections" for a page made of
// titled sections, "blocks" for a denser page of cards and tables.
const GAP = {
  sections: "gap-8",
  blocks: "gap-5",
  none: "",
} as const;

// PageBody is the part of a page that scrolls under a fixed header.
//
// The scroll box reaches past the content on both sides and pads itself back:
// - on the left by 4px, so focus rings and shadows of cards flush with the
//   edge are not clipped by the box;
// - on the right by the scrollbar lane (scroll-lane in index.css), so the bar
//   is drawn in the shell's gutter, beside the content and never over it. An
//   overlay scrollbar (Firefox, Windows 11) takes no room of its own and would
//   otherwise sit on the cards; a classic one would take its width off them,
//   and the body would come out narrower than the header above it.
// main in Layout leaves the lane free, so the box has somewhere to reach.
export function PageBody({
  children,
  gap = "sections",
  className = "",
}: {
  children: ReactNode;
  gap?: keyof typeof GAP;
  className?: string;
}) {
  return (
    <div
      className={`scroll-lane -ml-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-1 pl-1 ${GAP[gap]} ${className}`}
    >
      {children}
    </div>
  );
}
