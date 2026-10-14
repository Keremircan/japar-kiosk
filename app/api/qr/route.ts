import { NextResponse } from 'next/server';
import * as OTPAuth from 'otpauth';
import CryptoJS from 'crypto-js';
import { hasValidSession } from '../../../lib/session';

// Karekod SUNUCUDA üretilir. TOTP sırrı ve AES anahtarı tarayıcıya hiç
// gönderilmez; ekran yalnızca hazır (şifreli) karekod metnini alır.
// Eskiden bu değerler NEXT_PUBLIC_ ile istemci paketine gömülüyordu ve kiosk
// adresini açabilen herkes tarafından okunabiliyordu.

const PERIOD_SECONDS = 10;

// Herkese açık örnek değerler: yalnızca yerel geliştirmede yedek olarak kullanılır
const SAMPLE_SHARED_SECRET = 'JBSWY3DPEHPK3PXP';
const SAMPLE_AES_KEY = '12345678901234567890123456789012';

const isProduction = process.env.NODE_ENV === 'production';

const FACTORY_ID =
  process.env.FACTORY_ID || process.env.NEXT_PUBLIC_FACTORY_ID || 'JaparFAB-01';
const GATE_ID =
  process.env.GATE_ID || process.env.NEXT_PUBLIC_GATE_ID || 'Gate-01';

// NEXT_PUBLIC_AES_SECRET_KEY yalnızca geçiş kolaylığı için okunur (bu dosya
// sunucuda çalıştığından değer istemciye sızmaz). .env.local içinde adını
// AES_SECRET_KEY olarak değiştirin.
const SHARED_SECRET_BASE32 =
  process.env.SHARED_SECRET_BASE32 || (isProduction ? '' : SAMPLE_SHARED_SECRET);
const AES_SECRET_KEY =
  process.env.AES_SECRET_KEY ||
  process.env.NEXT_PUBLIC_AES_SECRET_KEY ||
  (isProduction ? '' : SAMPLE_AES_KEY);

const isConfigured = Boolean(SHARED_SECRET_BASE32 && AES_SECRET_KEY);

if (
  SHARED_SECRET_BASE32 === SAMPLE_SHARED_SECRET ||
  AES_SECRET_KEY === SAMPLE_AES_KEY
) {
  console.error(
    '[Kiosk] GÜVENLİK UYARISI: SHARED_SECRET_BASE32 / AES_SECRET_KEY herkese açık örnek değerlerde. Canlıya çıkmadan önce değiştirin.'
  );
}

// TOTP parametreleri PWA sunucusundaki lib/qr.ts ile birebir aynı olmalı
const totp = isConfigured
  ? new OTPAuth.TOTP({
      issuer: 'FactorySystem',
      label: GATE_ID,
      algorithm: 'SHA256',
      digits: 6,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(SHARED_SECRET_BASE32),
    })
  : null;

// POST: yanıtın hiçbir katmanda önbelleğe alınmaması için
export async function POST(request: Request) {
  if (!totp) {
    return NextResponse.json(
      {
        success: false,
        code: 'NOT_CONFIGURED',
        message:
          'Kiosk yapılandırılmamış: SHARED_SECRET_BASE32 ve AES_SECRET_KEY ortam değişkenlerini tanımlayın.',
      },
      { status: 503 }
    );
  }

  // Yalnızca terminal şifresiyle kilidi açılmış ekran karekod alabilir
  if (!hasValidSession(request)) {
    return NextResponse.json(
      {
        success: false,
        code: 'LOCKED',
        message: 'Terminal kilitli. Lütfen terminal şifresini girin.',
      },
      { status: 401 }
    );
  }

  const payload = JSON.stringify({
    t: totp.generate(),
    f: FACTORY_ID,
    d: GATE_ID,
  });

  return NextResponse.json(
    {
      success: true,
      qr: CryptoJS.AES.encrypt(payload, AES_SECRET_KEY).toString(),
      factoryId: FACTORY_ID,
      gateId: GATE_ID,
      // Ekran geri sayımı tabletin değil sunucunun saatine göre yapar
      serverTime: Date.now(),
      periodSeconds: PERIOD_SECONDS,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
