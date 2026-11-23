import { ViewTransition, type ReactNode } from "react";

/**
 * Wraps a dashboard page so switching pages with AppNav slides the content in the link's direction
 * (CSS in app/globals.css). Other updates (data loading, browser back/forward) don't animate.
 * Must sit in each page.tsx, not a layout: layouts persist across navigations, so enter/exit never fire there.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const slide = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" };
  return (
    <ViewTransition enter={slide} exit={slide} default="none">
      {children}
    </ViewTransition>
  );
}
