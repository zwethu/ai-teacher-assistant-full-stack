import * as React from 'react';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected/active state (azure fill). */
  active?: boolean;
  /** Slate outline instead of azure (neutral filter chips). */
  plain?: boolean;
  /** Show a trailing dropdown caret (selector chips). */
  caret?: boolean;
  /** When set, renders a dismiss "×"; called on click. */
  onDismiss?: (e: React.SyntheticEvent) => void;
}

/** Rounded pill control — batch/space selector, filters, tags. */
export function Chip(props: ChipProps): React.JSX.Element;
