import React, { createContext, useContext, useState, useCallback } from 'react';
import { X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (params: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback(
    ({
      title,
      description,
      tone = 'info',
    }: {
      title: string;
      description?: string;
      tone?: ToastTone;
    }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev, { id, title, description, tone }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 4000);
    },
    []
  );

  const remove = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {items.map((item) => {
          const barColor =
            item.tone === 'error'
              ? 'bg-[var(--status-danger-dot)]'
              : item.tone === 'success'
              ? 'bg-[var(--status-success-dot)]'
              : 'bg-[var(--status-info-dot)]';

          return (
            <div
              key={item.id}
              style={{ boxShadow: 'var(--shadow-floating)' }}
              className="pointer-events-auto relative flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] pl-4 pr-3.5 py-2.5 text-[13px] leading-[20px] overflow-hidden transition-opacity duration-150"
            >
              {/* 4px semantic colour bar on the left */}
              <span className={`absolute inset-y-0 left-0 w-1 ${barColor}`} />
              <div className="min-w-0 truncate">
                <span
                  className={
                    item.tone === 'error'
                      ? 'font-medium text-[var(--status-danger)]'
                      : 'font-medium text-[var(--text-primary)]'
                  }
                >
                  {item.title}
                </span>
                {item.description && (
                  <span className="ml-1.5 text-[var(--text-secondary)]">
                    {item.description}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label="Close notification"
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-0.5 shrink-0 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
