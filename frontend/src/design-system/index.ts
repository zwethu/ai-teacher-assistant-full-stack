/**
 * MILA design system — public entry point.
 *
 * Components are vendored from the "AI Teacher Design System" Claude Design
 * project and ship as plain `.jsx` with a `.d.ts` beside each one: TypeScript
 * resolves the declarations, Vite resolves the `.jsx` at runtime. They inject
 * their own scoped CSS on first render and read the design tokens as CSS custom
 * properties, so they carry no Tailwind dependency.
 *
 * Tokens load via `src/index.css` → `./styles.css`. Import components from the
 * barrel:
 *
 *   import { Button, Card, ThinkingRow } from '@/design-system'
 */

// forms
export { Button } from './components/forms/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './components/forms/Button'
export { IconButton } from './components/forms/IconButton'
export type { IconButtonProps } from './components/forms/IconButton'
export { Input, Textarea, Select } from './components/forms/Input'
export type { InputProps, TextareaProps, SelectProps } from './components/forms/Input'
export { Checkbox, Switch } from './components/forms/Checkbox'
export type { CheckboxProps, SwitchProps } from './components/forms/Checkbox'

// display
export { Card } from './components/display/Card'
export type { CardProps } from './components/display/Card'
export { Badge } from './components/display/Badge'
export type { BadgeProps } from './components/display/Badge'
export { Chip } from './components/display/Chip'
export type { ChipProps } from './components/display/Chip'
export { Avatar } from './components/display/Avatar'
export type { AvatarProps } from './components/display/Avatar'
export { ProgressBar } from './components/display/ProgressBar'
export type { ProgressBarProps } from './components/display/ProgressBar'

// feedback
export { Modal } from './components/feedback/Modal'
export type { ModalProps } from './components/feedback/Modal'
export { Toast } from './components/feedback/Toast'
export type { ToastProps } from './components/feedback/Toast'
export { Spinner, PageSpinner } from './components/feedback/Spinner'
export type { SpinnerProps, PageSpinnerProps } from './components/feedback/Spinner'
export { Thinking, ThinkingRow } from './components/feedback/Thinking'
export type { ThinkingProps, ThinkingRowProps } from './components/feedback/Thinking'

// navigation
export { NavItem } from './components/navigation/NavItem'
export type { NavItemProps } from './components/navigation/NavItem'
