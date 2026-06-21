import type {
  AgentRunEvent,
  AgentRunStatus,
  AgentRunStep,
} from '../../services/agentRunStream'

export type RunUiState = {
  status: AgentRunStatus
  events: AgentRunEvent[]
  steps: Record<string, AgentRunStep>
  streamError?: string
  runError?: string
  liveConnected?: boolean
}
