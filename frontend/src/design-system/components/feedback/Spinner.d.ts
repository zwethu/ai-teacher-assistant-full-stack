import * as React from 'react';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. @default 20 */
  size?: number;
  /** @deprecated use `tone="muted"`. Slate instead of the violet ring. */
  muted?: boolean;
  /**
   * `brand` (default) violet garland; `muted` slate; `inverse` inherits
   * `currentColor` for use on solid violet/danger buttons, where a violet
   * garland would be invisible. The gold insight bead always holds.
   */
  tone?: 'brand' | 'muted' | 'inverse';
}
export interface PageSpinnerProps {
  label?: string;
}

/** Spinning loader ring (mirrors the product's Loader2). */
export function Spinner(props: SpinnerProps): React.JSX.Element;
/** Full-panel loading state with a label. */
export function PageSpinner(props: PageSpinnerProps): React.JSX.Element;
