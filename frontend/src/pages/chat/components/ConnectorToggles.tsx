import { useEffect, useState, type ChangeEvent } from 'react'
import { Database, Globe, LinkIcon } from 'lucide-react'
import { checkGoogleAuthStatus, startGoogleOAuth, type GoogleAuthStatus } from '../../../services/authService'

export interface ConnectorsState {
  web_search: boolean
  google_workspace: boolean
}

type Props = {
  connectors: ConnectorsState
  onChange: (key: keyof ConnectorsState, value: boolean) => void
  disabled?: boolean
}

export function ConnectorToggles({ connectors, onChange, disabled }: Props) {
  const [googleStatus, setGoogleStatus] = useState<GoogleAuthStatus | null>(null)
  
  useEffect(() => {
    checkGoogleAuthStatus().then(setGoogleStatus).catch(console.error)
  }, [])

  const googleAvailable = Boolean(googleStatus?.valid && googleStatus?.has_google_scopes)

  useEffect(() => {
    if (googleStatus && !googleAvailable && connectors.google_workspace) {
      onChange('google_workspace', false)
    }
  }, [connectors.google_workspace, googleAvailable, googleStatus, onChange])
  
  const handleGoogleToggle = async (e: ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked
    if (checked) {
      let status = googleStatus
      try {
        status = await checkGoogleAuthStatus()
        setGoogleStatus(status)
      } catch (err) {
        console.error(err)
        status = null
      }
      if (!status?.has_google_scopes || !status.valid) {
        onChange('google_workspace', false)
        return
      }
    }
    onChange('google_workspace', checked)
  }
  
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
      
      <label
        className={`flex items-center gap-2 transition-colors ${
          googleAvailable && !disabled
            ? 'cursor-pointer group hover:text-slate-900'
            : 'cursor-not-allowed text-slate-400'
        }`}
      >
        <input 
          type="checkbox" 
          checked={googleAvailable && connectors.google_workspace}
          onChange={handleGoogleToggle}
          disabled={disabled || !googleAvailable}
          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        />
        <Database className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        <span className="font-medium">Google Workspace</span>
      </label>

      {!googleAvailable && (
        <button
          type="button"
          onClick={startGoogleOAuth}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Connect Google
        </button>
      )}

      <span className="basis-full text-xs text-slate-500">
        Google Workspace lets PNAI create Docs, Forms, drafts, and calendar items in your Google account.
      </span>
    </div>
  )
}
