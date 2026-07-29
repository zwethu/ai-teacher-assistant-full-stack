import * as React from 'react';

/**
 * Props for the sidebar navigation item.
 * @startingPoint section="Navigation" subtitle="Sidebar nav item" viewport="700x260"
 */
export interface NavItemProps extends React.HTMLAttributes<HTMLElement> {
  /** Leading icon node (Lucide-style). */
  icon?: React.ReactNode;
  label: string;
  /** Active/current state (azure gradient, lifted). */
  active?: boolean;
  /** Icon-only collapsed rail mode. */
  collapsed?: boolean;
  /** Optional count pill on the right. */
  badge?: React.ReactNode;
  /** Render as an anchor when provided, else a button. */
  href?: string;
}

/** Sidebar navigation item with lifted active/hover states. */
export function NavItem(props: NavItemProps): React.JSX.Element;
