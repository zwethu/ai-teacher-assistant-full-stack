import * as React from 'react';

export interface ModalProps {
  /** @default true */
  open?: boolean;
  /** Close handler — fires on backdrop click and the × button. */
  onClose?: () => void;
  title?: React.ReactNode;
  /** Uppercase micro-label under the title. */
  eyebrow?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Footer action row (right-aligned). */
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

/** Centered dialog: frosted backdrop, gradient header, footer action row. */
export function Modal(props: ModalProps): React.JSX.Element | null;
