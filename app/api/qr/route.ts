import { NextResponse } from 'next/server';
import * as OTPAuth from 'otpauth';
import { hasValidSession } from '../../../lib/session';
import { encryptQrPayload, loadQrSecrets } from '../../../lib/qrToken';

// Karekod SUNUCUDA üretilir. TOTP sırrı ve şifreleme anahtarı tarayıcıya hiç
// gönderilmez; ekran yalnızca hazır (şifreli) karekod metnini alır.

const PERIOD_SECONDS = 10;
// factory_id / gate_id kolonları varchar(50)
const MAX_ID_LENGTH = 50;

const FACTORY_ID = (process.env.FACTORY_ID || 'JaparFAB-01').slice(0, MAX_ID_LENGTH);
const GATE_ID = (process.env.GATE_ID || 'Gate-01').slice(0, MAX_ID_LENGTH);

// Sırlar açılışta bir kez doğrulanır. Eksik, zayıf veya herkese açık örnek
// değerlerle karekod hiç üretilmez (fail closed); yerel geliştirmede de.
const loaded = loadQrSecrets();
if (!loaded.ok) {
  console.error(`[Kiosk] Karekod üretimi devre dışı: ${loaded.problems.join('; ')}.`);
}
const secrets = loaded.ok ? loaded.secrets : null;

// TOTP parametreleri PWA sunucusundaki lib/qr.ts ile birebir aynı olmalı
const totp = secrets
  ? new OTPAuth.TOTP({
      issuer: 'FactorySystem',
      label: GATE_ID,
      algorithm: 'SHA256',
      digits: 6,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secrets.sharedSecretBase32),
    })
  : null;

// POST: yanıtın hiçbir katmanda önbelleğe alınmaması için
export async function POST(request: Request) {
  if (!totp || !secrets) {
    return NextResponse.json(
      {
        success: false,
        code: 'NOT_CONFIGURED',
        message:
          'Kiosk yapılandırılmamış veya anahtarlar güvensiz: SHARED_SECRET_BASE32 ve AES_SECRET_KEY değerlerini kontrol edin.',
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
      qr: encryptQrPayload(payload, secrets.key),
      factoryId: FACTORY_ID,
      gateId: GATE_ID,
      // Ekran geri sayımı tabletin değil sunucunun saatine göre yapar
      serverTime: Date.now(),
      periodSeconds: PERIOD_SECONDS,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
