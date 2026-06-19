import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Chat render error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 min-h-0 px-6 py-8 text-sm text-slate-600">
          Chat hit a rendering issue. Refresh the conversation to continue.
        </div>
      )
    }

    return this.props.children
  }
}
