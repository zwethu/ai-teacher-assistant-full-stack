import { useEffect, useState } from 'react'
import { AlertCircle, Database, Globe } from 'lucide-react'
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
  
  const handleGoogleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        if (window.confirm("Google Workspace connection is required. Connect now?")) {
          startGoogleOAuth()
        }
        onChange('google_workspace', false)
        return
      }
    }
    onChange('google_workspace', checked)
  }
  
  return (
    <div className="flex items-center gap-5 px-2 mb-2 text-sm text-slate-600">
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
      
      <label className="flex items-center gap-2 cursor-pointer group hover:text-slate-900 transition-colors">
        <input 
          type="checkbox" 
          checked={connectors.google_workspace}
          onChange={handleGoogleToggle}
          disabled={disabled}
          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        />
        <Database className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        <span className="font-medium">Google Workspace</span>
        {googleStatus && !googleStatus.has_google_scopes && (
           <span className="text-amber-500 hover:text-amber-600 transition-colors" title="Not connected or missing scopes">
             <AlertCircle className="w-4 h-4" />
           </span>
        )}
      </label>
    </div>
  )
}
