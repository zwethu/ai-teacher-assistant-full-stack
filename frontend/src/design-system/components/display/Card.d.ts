import * as React from 'react';

/**
 * Props for the product's default white rounded container.
 * @startingPoint section="Display" subtitle="Content card with icon header" viewport="700x340"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Inner padding. `none` for custom layouts. @default 'md' */
  padding?: 'none' | 'md' | 'lg';
  /** Corner radius. @default 'xl' */
  rounded?: 'xl' | '2xl';
  /** Lift + shadow on hover (for clickable cards). */
  interactive?: boolean;
  /** Frosted-glass surface over the academic canvas. */
  glass?: boolean;
  /** Icon node shown in a soft azure tile in the header. */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  /** Small muted meta line under the title. */
  meta?: React.ReactNode;
  /** Node pinned to the right of the header row. */
  headerRight?: React.ReactNode;
}

/** The product's default white rounded container with an optional header row. */
export function Card(props: CardProps): React.JSX.Element;
