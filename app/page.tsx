'use client';

import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

const ACCESS_KEY_STORAGE = 'kiosk_access_key';
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

// Erişim anahtarı ekrana bir kez "adres#key=..." ile verilir, cihazda saklanır
// ve adres çubuğundan silinir.
function readAccessKey(): string {
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('key');
    if (fromHash) {
      localStorage.setItem(ACCESS_KEY_STORAGE, fromHash);
      history.replaceState(null, '', window.location.pathname);
    }
    return localStorage.getItem(ACCESS_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

// Karekod ekranın elverdiği kadar büyük çizilir (uzaktan okunabilsin)
function qrPixelSize(): number {
  return Math.round(
    Math.max(240, Math.min(window.innerWidth * 0.8, window.innerHeight * 0.58, 640))
  );
}

export default function KioskScreen() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [timeLeft, setTimeLeft] = useState(10);
  const [period, setPeriod] = useState(10);
  const [clock, setClock] = useState('');
  const [gateLabel, setGateLabel] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let fetching = false;
    let clockOffsetMs = 0; // sunucu saati - tablet saati
    let periodMs = 10_000;
    let shownSlot = -1; // ekrandaki karekodun ait olduğu zaman dilimi
    let nextAttemptAt = 0;
    let currentQr = '';
    const accessKey = readAccessKey();

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
        const response = await fetch('/api/qr', {
          method: 'POST',
          headers: accessKey ? { 'x-kiosk-key': accessKey } : undefined,
          cache: 'no-store',
        });
        const data = (await response.json()) as
          | QrResponse
          | { success: false; message?: string };
        if (disposed) return;

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
  }, []);

  const ready = status.kind === 'ready';

  return (
    <main className="flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center bg-[#0f172a] p-4 select-none">
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
              <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
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
      </div>
    </main>
  );
}
