/**
 * Tailwind twins of the design system's Button, for the places in the batches
 * pages that style a plain `<button>` rather than importing the component.
 *
 * They have to track `design-system/components/forms/Button.jsx`: same weight,
 * same flat fill, same `scale(.97)` press, same hover-shadow. Two buttons that
 * are almost the same is worse than two that are obviously different — the
 * near-miss is what reads as sloppy.
 */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-md text-sm font-semibold tracking-[-0.006em] text-white bg-violet-600 shadow-[0_1px_2px_rgba(42,30,82,0.16)] hover:bg-violet-700 hover:shadow-[0_4px_14px_rgba(95,72,156,0.28)] active:scale-[0.97] transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-55 disabled:cursor-not-allowed motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500'
export const BTN_SECONDARY =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-md text-sm font-semibold tracking-[-0.006em] text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:scale-[0.97] transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-55 motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500'
export const BTN_BACK =
  'inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors'
export const INPUT_CLASS =
  'block w-full rounded-md border border-violet-200 bg-slate-50 focus:bg-white focus:border-violet-500 py-2.5 px-3 text-sm'
