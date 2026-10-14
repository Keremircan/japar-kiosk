'use client';

import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import LockButton from './LockButton';

const TICK_MS = 250;
const RETRY_MS = 2000;

type QrResponse = {
  success: true;
  qr: string;
  factoryId: string;
  gateId: string;
  serverTime: number;
  periodSeconds: number;
};

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const clockFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Karekod ekranın elverdiği kadar büyük çizilir (uzaktan okunabilsin)
function qrPixelSize(): number {
  return Math.round(
    Math.max(200, Math.min(window.innerWidth * 0.8, window.innerHeight * 0.42, 640))
  );
}

type KioskScreenProps = {
  /** "Terminali Kilitle"ye basıldı veya sunucu oturumu geçersiz saydı */
  onLock: () => void;
};

export default function KioskScreen({ onLock }: KioskScreenProps) {
  // Karekod üretimi yalnızca "Start"a basıldıktan sonra çalışır
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [timeLeft, setTimeLeft] = useState(10);
  const [period, setPeriod] = useState(10);
  const [clock, setClock] = useState('');
  const [gateLabel, setGateLabel] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!running) return;

    let disposed = false;
    let fetching = false;
    let clockOffsetMs = 0; // sunucu saati - tablet saati
    let periodMs = 10_000;
    let shownSlot = -1; // ekrandaki karekodun ait olduğu zaman dilimi
    let nextAttemptAt = 0;
    let currentQr = '';

    const draw = async () => {
      if (!canvasRef.current || !currentQr) return;
      await QRCode.toCanvas(canvasRef.current, currentQr, {
        width: qrPixelSize(),
        margin: 4, // QR standardının istediği sessiz bölge
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    };

    const fetchQr = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const sentAt = Date.now();
        // Kilit oturumu HttpOnly çerezle otomatik gönderilir
        const response = await fetch('/api/qr', {
          method: 'POST',
          cache: 'no-store',
        });
        const data = (await response.json()) as
          | QrResponse
          | { success: false; code?: string; message?: string };
        if (disposed) return;

        // Oturum süresi doldu / PIN değişti: kilit ekranına dön
        if (!data.success && data.code === 'LOCKED') {
          onLock();
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(
            ('message' in data && data.message) || 'Karekod alınamadı.'
          );
        }

        // Ağ gecikmesinin yarısı kadar düzeltilmiş sunucu saati farkı
        const receivedAt = Date.now();
        clockOffsetMs = data.serverTime + (receivedAt - sentAt) / 2 - receivedAt;
        periodMs = data.periodSeconds * 1000;
        shownSlot = Math.floor(data.serverTime / periodMs);
        currentQr = data.qr;

        setPeriod(data.periodSeconds);
        setGateLabel(`${data.factoryId} - ${data.gateId}`);
        await draw();
        if (!disposed) setStatus({ kind: 'ready' });
      } catch (error) {
        if (disposed) return;
        console.error('Karekod alınamadı:', error);
        nextAttemptAt = Date.now() + RETRY_MS;
        setStatus({
          kind: 'error',
          message:
            error instanceof TypeError
              ? 'Sunucuya ulaşılamıyor. Bağlantı bekleniyor...'
              : error instanceof Error
                ? error.message
                : 'Karekod alınamadı.',
        });
      } finally {
        fetching = false;
      }
    };

    const tick = () => {
      const serverNow = Date.now() + clockOffsetMs;
      const slot = Math.floor(serverNow / periodMs);

      setTimeLeft(Math.ceil((periodMs - (serverNow % periodMs)) / 1000));
      setClock(clockFormatter.format(serverNow));

      // Zaman dilimi değişti (veya henüz kod yok): yenisini al. Süresi dolan kod
      // ekranda bırakılmaz; alınamazsa hata katmanı gösterilir.
      if (slot !== shownSlot && Date.now() >= nextAttemptAt) void fetchQr();
    };

    tick();
    const timer = setInterval(tick, TICK_MS);

    const onResize = () => void draw();
    window.addEventListener('resize', onResize);

    // Ekranın uykuya geçmesini engelle (destekleyen tarayıcılarda). Sekme
    // gizlenince kilit düşer; yeniden görünür olunca tekrar alınır.
    let wakeLock: WakeLockSentinel | null = null;
    const keepAwake = async () => {
      try {
        if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Pil tasarrufu modu vb. — işletim sistemi ayarına bırakılır
      }
    };
    void keepAwake();
    document.addEventListener('visibilitychange', keepAwake);

    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', keepAwake);
      void wakeLock?.release().catch(() => {});
    };
  }, [running, onLock]);

  const start = () => {
    setStatus({ kind: 'loading' });
    setRunning(true);
  };

  // Durdurunca effect temizlenir: zamanlayıcı, istekler ve uyku kilidi biter
  const stop = () => setRunning(false);

  const ready = status.kind === 'ready';

  if (!running) {
    return (
      <main className="relative flex min-h-screen min-h-[100dvh] w-full items-center justify-center bg-[#0f172a] p-4 select-none">
        <LockButton onLock={onLock} />
        <button
          type="button"
          onClick={start}
          className="min-h-[96px] min-w-[280px] cursor-pointer rounded-3xl bg-green-600 px-16 text-4xl font-bold text-white shadow-2xl transition active:scale-[0.98] active:bg-green-700"
        >
          Start
        </button>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center bg-[#0f172a] p-4 select-none">
      <LockButton onLock={onLock} />
      <div className="flex w-full max-w-[760px] flex-col items-center rounded-3xl bg-white p-6 shadow-2xl sm:p-10">
        {/* Üst Başlık & Kapı Bilgisi */}
        <h1 className="text-center text-2xl font-bold tracking-tight text-[#0f172a] sm:text-4xl">
          PERSONEL GİRİŞ / ÇIKIŞ
        </h1>
        <p className="mt-2 text-center text-base font-semibold text-[#475569] sm:text-xl">
          Telefonunuzla karekodu okutun
        </p>

        {/* QR Kod Çerçevesi */}
        <div className="relative mt-6 flex items-center justify-center rounded-2xl border-2 border-[#e2e8f0] bg-white p-2">
          <canvas
            ref={canvasRef}
            width={240}
            height={240}
            className={ready ? '' : 'opacity-0'}
          />
          {!ready && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
            >
              {status.kind === 'loading' && (
                <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
              )}
              <span className="text-lg font-semibold text-[#0f172a] sm:text-2xl">
                {status.kind === 'error' ? status.message : 'Karekod hazırlanıyor...'}
              </span>
            </div>
          )}
        </div>

        {/* Geri Sayım Barı & Sayaç */}
        <div className="mt-6 flex w-full flex-col items-center gap-3">
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-blue-600 transition-all duration-300 ease-linear"
              style={{ width: ready ? `${(timeLeft / period) * 100}%` : '0%' }}
            />
          </div>

          <div className="flex w-full items-center justify-between px-1 text-base text-[#475569] sm:text-xl">
            <span>
              Yeni kod:{' '}
              <strong className="font-bold text-blue-600">
                {ready ? `${timeLeft} sn` : '—'}
              </strong>
            </span>
            <span className="font-semibold text-[#475569]">{gateLabel}</span>
            <span className="font-mono tabular-nums text-[#475569]">{clock}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={stop}
          className="mt-6 min-h-[64px] w-full cursor-pointer rounded-2xl bg-red-600 text-2xl font-bold text-white transition active:scale-[0.98] active:bg-red-700"
        >
          Stop
        </button>
      </div>
    </main>
  );
}
