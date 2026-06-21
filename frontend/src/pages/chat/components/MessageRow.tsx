import { Bot, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../../entity/Chat'
import type { RunUiState } from '../runTypes'
import { RunStatusPanel } from './run/RunStatusPanel'

export function MessageRow({
  msg,
  run,
}: {
  msg?: ChatMessage | null
  run?: RunUiState
}) {
  if (!msg) return null

  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-emerald-500/90 text-white shadow-md shadow-emerald-500/20'
            : 'bg-white/70 border border-white/60 text-slate-600 shadow-sm'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`flex-1 min-w-0 pt-1 ${isUser ? 'flex justify-end' : ''}`}>
        {isUser ? (
          <div className="inline-block max-w-full text-[15px] leading-7 whitespace-pre-wrap px-4 py-2.5 rounded-3xl rounded-br-md bg-emerald-500/15 border border-emerald-300/30 text-slate-800">
            {msg.content}
          </div>
        ) : (
          <div className="max-w-full text-[15px] leading-7 text-slate-700">
            {msg.content && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={{
                  h1: ({ ...props }) => <h1 className="mt-3 mb-2 text-xl font-semibold text-slate-900" {...props} />,
                  h2: ({ ...props }) => <h2 className="mt-3 mb-2 text-lg font-semibold text-slate-900" {...props} />,
                  h3: ({ ...props }) => <h3 className="mt-3 mb-2 text-base font-semibold text-slate-900" {...props} />,
                  p: ({ ...props }) => <p className="my-2" {...props} />,
                  ul: ({ ...props }) => <ul className="my-2 list-disc pl-5 space-y-1" {...props} />,
                  ol: ({ ...props }) => <ol className="my-2 list-decimal pl-5 space-y-1" {...props} />,
                  li: ({ ...props }) => <li className="pl-1" {...props} />,
                  a: ({ ...props }) => (
                    <a
                      className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                      target="_blank"
                      rel="noreferrer"
                      {...props}
                    />
                  ),
                  table: ({ ...props }) => (
                    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm" {...props} />
                    </div>
                  ),
                  th: ({ ...props }) => <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-800" {...props} />,
                  td: ({ ...props }) => <td className="border-t border-slate-100 px-3 py-2 align-top" {...props} />,
                  code: ({ className, children, ...props }) => {
                    const isBlock = /language-/.test(className || '')
                    return isBlock ? (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    ) : (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800" {...props}>
                        {children}
                      </code>
                    )
                  },
                  pre: ({ ...props }) => (
                    <pre className="my-3 max-w-full overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100" {...props} />
                  ),
                  blockquote: ({ ...props }) => (
                    <blockquote className="my-3 border-l-4 border-emerald-300 pl-4 text-slate-600" {...props} />
                  ),
                }}
              >
                {msg.content}
              </ReactMarkdown>
            )}
            <RunStatusPanel run={run} />
          </div>
        )}
      </div>
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/70 border border-white/60 text-slate-600 shadow-sm">
        <Bot className="w-4 h-4" />
      </div>
      <div className="pt-2">
        <div className="inline-flex items-center gap-1 px-4 py-3 rounded-2xl bg-white/50 border border-white/50">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
