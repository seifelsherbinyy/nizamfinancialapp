/**
 * NIZAM · Modal — accessible dialog overlay
 * Implemented by: KIRO Contract 4 / Phase 4.1
 * Depends on: none
 */
import { useEffect, useRef, type ReactNode } from 'react';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal(props: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        ref={ref}
      >
        <h3>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}
