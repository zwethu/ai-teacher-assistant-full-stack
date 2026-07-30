import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. @default 'neutral' */
  tone?: 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  /** Leading status dot in the current color. */
  dot?: boolean;
  icon?: React.ReactNode;
}

/** Small status/label pill mapped to the status palette. */
export function Badge(props: BadgeProps): React.JSX.Element;
