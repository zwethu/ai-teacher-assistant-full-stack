import { Globe } from 'lucide-react'

export interface ConnectorsState {
  web_search: boolean
}

type Props = {
  connectors: ConnectorsState
  onChange: (key: keyof ConnectorsState, value: boolean) => void
  disabled?: boolean
}

export function ConnectorToggles({ connectors, onChange, disabled }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 mb-2 text-sm text-slate-600">
      <label className="flex items-center gap-2 cursor-pointer group hover:text-slate-900 transition-colors">
        <input 
          type="checkbox" 
          checked={connectors.web_search}
          onChange={(e) => onChange('web_search', e.target.checked)}
          disabled={disabled}
          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        />
        <Globe className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        <span className="font-medium">Web Search</span>
      </label>
    </div>
  )
}
