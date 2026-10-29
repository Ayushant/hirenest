import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Drawer, Button } from '../ui/kit';
import { AiSuggestionBanner } from './DomainBadges';
import { sendGeneralStaffingChat } from '../../api/ai';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  label?: string;
  source?: 'provider' | 'template';
  reason?: string | null;
}

const STARTER_PROMPTS = [
  'How should we structure a senior backend job description?',
  'What are good competency rubric criteria for a technical round?',
  'How do SLA response and turnaround scores work?',
];

export const AiAssistantDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: 'assistant',
      text: 'Ask about writing clear job descriptions, structuring competency interview questions, or general staffing SLA practices. Do not include candidate personal contact details.',
      label: 'Suggestion: review before use',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, open]);

  const submitPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
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
          label: response.label || 'Suggestion: review before use',
          source: response.source,
          reason: response.reason,
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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPrompt(input);
  };

  const handleReset = () => {
    setMessages([
      {
        role: 'assistant',
        text: 'Ask about writing clear job descriptions, structuring competency interview questions, or general staffing SLA practices. Do not include candidate personal contact details.',
        label: 'Suggestion: review before use',
      },
    ]);
    setErrorMsg(null);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Assistant"
      subtitle="General staffing workflow help · No candidate records transmitted"
      widthClass="max-w-[480px]"
    >
      <div className="flex flex-col h-full justify-between gap-4">
        <div ref={scrollRef} className="space-y-3 overflow-y-auto pr-1 flex-1">
          <div className="flex items-center justify-between rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 text-[12px] leading-[16px] text-[var(--text-secondary)]">
            <span>Suggestions only · No candidate records · 20 req/hr limit</span>
            {messages.length > 1 && (
              <button
                type="button"
                onClick={handleReset}
                className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0 ml-2"
              >
                Clear
              </button>
            )}
          </div>

          {messages.map((turn, idx) => (
            <div
              key={idx}
              className={`rounded-[8px] border border-[var(--border)] p-3.5 text-[13px] leading-[20px] space-y-2 ${
                turn.role === 'user' ? 'bg-[var(--bg-subtle)] ml-6' : 'bg-[var(--bg)] mr-4'
              }`}
            >
              <div className="flex items-center justify-between text-[12px] leading-[16px] font-medium text-[var(--text-tertiary)]">
                <span>{turn.role === 'user' ? 'You' : 'Assistant'}</span>
              </div>
              {turn.role === 'assistant' && (
                <AiSuggestionBanner
                  label={turn.label}
                  source={turn.source}
                  reason={turn.reason}
                />
              )}
              <p className="whitespace-pre-line text-[var(--text-primary)]">
                {turn.text}
              </p>
            </div>
          ))}

          {messages.length === 1 && !loading && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[12px] font-medium text-[var(--text-tertiary)]">
                Suggested topics
              </div>
              <div className="flex flex-col gap-1.5">
                {STARTER_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => submitPrompt(q)}
                    className="text-left rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-[16px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors duration-120 cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 flex items-center gap-2 text-[13px] leading-[20px] text-[var(--text-secondary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)] shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSend}
          className="pt-3 border-t border-[var(--border)] flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a general staffing or JD question..."
            className="flex-1 h-8 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-3 text-[14px] leading-[20px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <Button type="submit" size="md" loading={loading} disabled={!input.trim()}>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </form>
      </div>
    </Drawer>
  );
};
