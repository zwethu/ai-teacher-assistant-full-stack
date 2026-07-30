import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Props for the primary action button and its variants.
 * @startingPoint section="Forms" subtitle="Azure CTA + variants" viewport="700x300"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = azure CTA, `secondary` = outlined white, `ghost` = text, `danger` = red. */
  variant?: ButtonVariant;
  /** @default 'md' — md is the 44px min-hit-target default. */
  size?: ButtonSize;
  /** Stretch to full width (form submits). */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Icon node placed before the label (e.g. a Lucide icon). */
  leadingIcon?: React.ReactNode;
  /** Icon node placed after the label. */
  trailingIcon?: React.ReactNode;
}

/** MILA's primary action button and its variants. */
export function Button(props: ButtonProps): React.JSX.Element;
