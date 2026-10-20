// A screen shown over the current one. Esc or a tap outside closes it; with pop-ups on top of
// each other (Find over Gig), Esc closes only the top one.

import { useEffect, useRef, type ReactNode } from 'react';

const open: { current: () => void }[] = [];
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') open.at(-1)?.current();
});

export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    open.push(close);
    return () => {
      open.splice(open.indexOf(close), 1);
    };
  }, []);
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="btn dialog-close" onClick={onClose} aria-label="Close">
      ✕
    </button>
  );
}
