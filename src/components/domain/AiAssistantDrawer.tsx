import React, { useState } from 'react';
import { Send, Sparkles, AlertCircle } from 'lucide-react';
import { Drawer, Button } from '../ui/kit';
import { AiSuggestionBanner } from './DomainBadges';
import { sendGeneralStaffingChat } from '../../api/ai';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  label?: string;
}

export const AiAssistantDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: 'assistant',
      text: 'Ask me about writing clear job descriptions, structuring competency interview questions, or general staffing SLA best practices. Do not include candidate personal contact details.',
      label: 'AI suggestion: review before use',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatTurn[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await sendGeneralStaffingChat(
        nextMessages.map((m) => ({ role: m.role, text: m.text }))
      );
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: response.text,
          label: response.label || 'AI suggestion: review before use',
        },
      ]);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'AI assistant unavailable right now';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Staffing Operations AI Guide"
      subtitle="General staffing workflow assistance · Zero candidate records or PII transmitted"
      widthClass="max-w-lg"
    >
      <div className="flex flex-col h-full justify-between gap-4">
        <div className="space-y-3 overflow-y-auto pr-1 flex-1">
          <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-600 dark:text-slate-400">
            Advisory suggestions only. This assistant has no access to candidate records,
            cannot alter scores, stages, or ratings, and is limited to 20 requests/hour.
          </div>

          {messages.map((turn, idx) => (
            <div
              key={idx}
              className={`rounded-lg border p-3.5 text-xs space-y-2 ${
                turn.role === 'user'
                  ? 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 ml-6'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 mr-4'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>{turn.role === 'user' ? 'You' : 'Staffing Guide'}</span>
              </div>
              {turn.role === 'assistant' && <AiSuggestionBanner label={turn.label} />}
              <p className="whitespace-pre-line text-slate-800 dark:text-slate-200 leading-relaxed">
                {turn.text}
              </p>
            </div>
          ))}

          {errorMsg && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a general staffing or JD question..."
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
          <Button type="submit" size="sm" loading={loading} disabled={!input.trim()}>
            <Sparkles className="h-3.5 w-3.5" />
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </Drawer>
  );
};
