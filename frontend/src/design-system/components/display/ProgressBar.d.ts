import * as React from 'react';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  /** @default 100 */
  max?: number;
  /** Color. `auto` derives low→max from the value (stress meter). */
  tone?: 'primary' | 'info' | 'warning' | 'danger' | 'gradient' | 'auto';
  size?: 'md' | 'lg';
}

/** Thin rounded progress/level bar — stress meter, mood summary. */
export function ProgressBar(props: ProgressBarProps): React.JSX.Element;
