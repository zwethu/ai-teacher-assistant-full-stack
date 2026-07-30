import * as React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `ghost` (default), `solid` azure, `soft` azure tint, or `danger` hover. */
  variant?: 'ghost' | 'solid' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Use a rounded-square tile instead of a circle. */
  tile?: boolean;
  /** Accessible label (also the tooltip). Required for icon-only buttons. */
  label: string;
  /** The icon node. */
  children: React.ReactNode;
}

/** Icon-only button for toolbars, close, and panel toggles. */
export function IconButton(props: IconButtonProps): React.JSX.Element;
