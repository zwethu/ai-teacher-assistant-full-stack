import * as React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Photo URL; falls back to initials on an azure gradient. */
  src?: string | null;
  /** Full name — drives initials and alt text. */
  name?: string;
  /** Preset `sm|md|lg` or a pixel number. @default 'md' */
  size?: 'sm' | 'md' | 'lg' | number;
  /** White ring + shadow (over colored backgrounds). */
  ring?: boolean;
}

/** User avatar with photo or azure-gradient initials fallback. */
export function Avatar(props: AvatarProps): React.JSX.Element;
