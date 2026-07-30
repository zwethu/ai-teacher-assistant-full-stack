import * as React from 'react';

interface BaseFieldProps {
  /** Field label rendered above the control. */
  label?: string;
  /** Helper text shown below (hidden when `error` is set). */
  hint?: string;
  /** Error message; also switches the control to the invalid style. */
  error?: string;
  required?: boolean;
  /** Soft variant — azure border on a slate-50 fill, white on focus. */
  soft?: boolean;
}

/**
 * Props for the single-line text field.
 * @startingPoint section="Forms" subtitle="Labeled inputs, selects & textareas" viewport="700x330"
 */
export interface InputProps extends BaseFieldProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {}
export interface TextareaProps extends BaseFieldProps, React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export interface SelectProps extends BaseFieldProps, React.SelectHTMLAttributes<HTMLSelectElement> {}

/** Single-line text field with azure focus ring and optional label/hint/error. */
export function Input(props: InputProps): React.JSX.Element;
/** Multi-line text area (composer, notes). */
export function Textarea(props: TextareaProps): React.JSX.Element;
/** Native select styled to match, with a chevron affordance. */
export function Select(props: SelectProps): React.JSX.Element;
