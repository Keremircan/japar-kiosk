'use client';

import { useEffect, useRef, useState } from 'react';

// Kapıdan geçen birinin yanlışlıkla dokunup terminali kilitlememesi için
// kilit, ikona bir süre basılı tutulunca çalışır.
const HOLD_MS = 1500;

type LockButtonProps = {
  onLock: () => void;
};

export default function LockButton({ onLock }: LockButtonProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  };

  const begin = () => {
    cancel();
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onLock();
    }, HOLD_MS);
  };

  useEffect(() => cancel, []);

  return (
    <div className="absolute top-[max(16px,env(safe-area-inset-top))] right-4 z-10 flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label="Terminali kilitle (basılı tutun)"
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // Klavye ile erişimde Enter/Boşluk doğrudan kilitler
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onLock();
          }
        }}
        className="relative flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 text-white/70 transition-colors active:bg-white/20"
      >
        {/* Basılı tutma ilerlemesi */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 bg-red-500/60"
          style={{
            height: holding ? '100%' : '0%',
            transition: holding ? `height ${HOLD_MS}ms linear` : 'height 150ms ease-out',
          }}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="relative h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </button>
      <span
        aria-hidden={!holding}
        className={`rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white transition-opacity ${
          holding ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Kilitlemek için basılı tutun
      </span>
    </div>
  );
}
