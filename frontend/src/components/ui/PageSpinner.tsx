interface PageSpinnerProps {
  label?: string
}

export default function PageSpinner({ label = 'Loading…' }: PageSpinnerProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#E0F1FF]">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"
        role="status"
        aria-label={label}
      />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  )
}
