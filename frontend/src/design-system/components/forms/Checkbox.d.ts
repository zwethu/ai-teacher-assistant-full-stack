import * as React from 'react';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  disabled?: boolean;
}
export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  disabled?: boolean;
}

/** Checkbox with azure accent and inline label. */
export function Checkbox(props: CheckboxProps): React.JSX.Element;
/** Toggle switch — connector toggles and settings. */
export function Switch(props: SwitchProps): React.JSX.Element;
