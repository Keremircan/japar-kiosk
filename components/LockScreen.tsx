'use client';

import { useCallback, useEffect, useState } from 'react';

const MAX_PIN_LENGTH = 12;
const MIN_PIN_LENGTH = 4;
const SHAKE_MS = 500;

type LockScreenProps = {
  onUnlock: () => void;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'delete', '0', 'submit'] as const;

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const fail = useCallback((message: string) => {
    setError(message);
    setPin('');
    setShaking(true);
    setTimeout(() => setShaking(false), SHAKE_MS);
    navigator.vibrate?.([60, 60, 60]);
  }, []);

  const submit = useCallback(async () => {
    if (submitting || pin.length < MIN_PIN_LENGTH) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', pin }),
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
      } | null;

      if (response.ok && data?.success) {
        setError(null);
        setUnlocked(true);
        // Geçiş animasyonu bitince ana ekrana
        setTimeout(onUnlock, 350);
        return;
      }
      fail(data?.message || 'Hatalı Terminal Şifresi');
    } catch {
      fail('Sunucuya ulaşılamıyor. Bağlantıyı kontrol edin.');
    } finally {
      setSubmitting(false);
    }
  }, [pin, submitting, onUnlock, fail]);

  const press = useCallback(
    (key: (typeof KEYS)[number]) => {
      if (submitting || unlocked) return;
      if (key === 'submit') {
        void submit();
      } else if (key === 'delete') {
        setPin((value) => value.slice(0, -1));
      } else {
        setError(null);
        setPin((value) => (value.length < MAX_PIN_LENGTH ? value + key : value));
      }
    },
    [submit, submitting, unlocked]
  );

  // Fiziksel klavye desteği (masaüstü / harici klavyeli kiosk)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key as (typeof KEYS)[number]);
      else if (event.key === 'Backspace') press('delete');
      else if (event.key === 'Enter') press('submit');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [press]);

  const dotCount = Math.max(MIN_PIN_LENGTH, pin.length);

  return (
    <main
      className={`flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center bg-[#0f172a] px-4 py-6 text-white select-none transition-all duration-300 ${
        unlocked ? 'scale-105 opacity-0' : 'opacity-100'
      }`}
    >
      {/* Logo */}
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl font-black text-[#0f172a] shadow-lg">
          J
        </div>
        <p className="mt-3 text-xl font-bold tracking-wide">Japar PDKS</p>
        <p className="text-sm font-medium tracking-[0.2em] text-slate-400 uppercase">
          Kiosk Terminali
        </p>
      </div>

      <h1 className="mt-[clamp(16px,4vh,32px)] text-center text-xl font-semibold text-slate-100 sm:text-2xl">
        Terminali Aktif Etmek İçin Şifreyi Girin
      </h1>

      {/* Girilen PIN (gizli) */}
      <div
        className={`mt-6 flex h-6 items-center gap-4 ${shaking ? 'animate-shake' : ''}`}
        aria-label={`${pin.length} hane girildi`}
      >
        {Array.from({ length: dotCount }, (_, index) => (
          <span
            key={index}
            className={`h-5 w-5 rounded-full border-2 transition-colors ${
              error
                ? 'border-red-500 bg-red-500/30'
                : index < pin.length
                  ? 'border-white bg-white'
                  : 'border-slate-500'
            }`}
          />
        ))}
      </div>

      <p role="alert" className="mt-4 h-6 text-center text-base font-semibold text-red-400">
        {error}
      </p>

      {/* Sayısal tuş takımı */}
      <div className="mt-2 grid w-full max-w-[360px] grid-cols-3 gap-[clamp(8px,1.6vh,16px)]">
        {KEYS.map((key) => {
          if (key === 'delete') {
            return (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                aria-label="Sil"
                className="flex h-[clamp(56px,10vh,80px)] cursor-pointer items-center justify-center rounded-2xl bg-white/5 text-lg font-semibold text-slate-300 transition active:scale-95 active:bg-white/15"
              >
                Sil
              </button>
            );
          }
          if (key === 'submit') {
            return (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                disabled={pin.length < MIN_PIN_LENGTH || submitting}
                className="flex h-[clamp(56px,10vh,80px)] cursor-pointer items-center justify-center rounded-2xl bg-green-600 text-lg font-bold text-white transition active:scale-95 active:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
                ) : (
                  'Giriş'
                )}
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="flex h-[clamp(56px,10vh,80px)] cursor-pointer items-center justify-center rounded-2xl bg-white/10 text-3xl font-semibold transition active:scale-95 active:bg-white/25"
            >
              {key}
            </button>
          );
        })}
      </div>
    </main>
  );
}
