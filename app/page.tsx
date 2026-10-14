'use client';

import { useCallback, useEffect, useState } from 'react';
import KioskScreen from '../components/KioskScreen';
import LockScreen from '../components/LockScreen';

type Phase = 'checking' | 'locked' | 'unlocked';

export default function KioskPage() {
  const [phase, setPhase] = useState<Phase>('checking');

  // Sayfa yenilendiğinde (F5) kilit oturumu sunucudan sorulur; oturum
  // HttpOnly çerezde tutulduğu için tarayıcı kodu onu doğrudan okuyamaz.
  useEffect(() => {
    let ignore = false;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((data: { unlocked?: boolean }) => {
        if (!ignore) setPhase(data.unlocked ? 'unlocked' : 'locked');
      })
      .catch(() => {
        if (!ignore) setPhase('locked');
      });
    return () => {
      ignore = true;
    };
  }, []);

  const lock = useCallback(() => {
    setPhase('locked');
    // Çerez sunucuda silinir; istek başarısız olsa da ekran kilitli kalır
    void fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock' }),
    }).catch(() => {});
  }, []);

  const unlock = useCallback(() => setPhase('unlocked'), []);

  if (phase === 'checking') {
    return (
      <main className="flex min-h-screen min-h-[100dvh] w-full items-center justify-center bg-[#0f172a]">
        <span
          role="status"
          aria-label="Yükleniyor"
          className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
        />
      </main>
    );
  }

  if (phase === 'locked') return <LockScreen onUnlock={unlock} />;

  return (
    <div className="animate-fade-in">
      <KioskScreen onLock={lock} />
    </div>
  );
}
