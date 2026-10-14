import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ToastContext = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((value: string) => {
    setText(value);
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 3200);
  }, []);

  return (
    <ToastContext value={notify}>
      {children}
      <div className={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">{text}</div>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
