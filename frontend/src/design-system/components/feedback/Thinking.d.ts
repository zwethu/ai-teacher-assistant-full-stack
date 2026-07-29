import * as React from 'react';

export interface ThinkingProps extends React.SVGAttributes<SVGSVGElement> {
  /** Diameter in px. Use ≥24. @default 40 */
  size?: number;
}
export interface ThinkingRowProps {
  /** Calm status line, e.g. "Reading course files…". @default 'Thinking…' */
  label?: string;
  /** Mark diameter in px. @default 28 */
  size?: number;
}

/** Agent-thinking indicator — the living MILA garland. Use while the assistant
 * is working; use `Spinner`/`PageSpinner` for plain loading instead. */
export function Thinking(props: ThinkingProps): React.JSX.Element;
/** Inline "MILA is thinking…" row for chat streams and agent runs. */
export function ThinkingRow(props: ThinkingRowProps): React.JSX.Element;
