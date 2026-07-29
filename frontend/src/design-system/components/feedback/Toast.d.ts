import * as React from 'react';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @default 'info' */
  type?: 'success' | 'error' | 'info' | 'warning';
  message?: React.ReactNode;
  /** When set, shows a dismiss button. */
  onDismiss?: () => void;
}

/** Inline toast with a colored accent edge and status icon. */
export function Toast(props: ToastProps): React.JSX.Element;
