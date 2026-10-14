// Kiosk kilit oturumu (yalnızca sunucuda çalışır).
//
// Terminal şifresi (PIN) doğru girilince tarayıcıya HttpOnly bir çerez verilir.
// Çerez "bitiş zamanı + HMAC imzası" taşır; JavaScript tarafından okunamaz ve
// sahte üretilemez. /api/qr yalnızca geçerli çerezi olan ekrana karekod verir.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'kiosk_session';
// Kiosk sürekli açık bir cihaz: kilit 30 günde bir yeniden sorulur
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const isProduction = process.env.NODE_ENV === 'production';

// Yalnızca yerel geliştirmede kullanılan varsayılan PIN
const DEV_PIN = '1234';

export const KIOSK_PIN =
  process.env.KIOSK_ACCESS_PIN || (isProduction ? '' : DEV_PIN);

export const PIN_PATTERN = /^\d{4,12}$/;

if (!process.env.KIOSK_ACCESS_PIN) {
  console[isProduction ? 'error' : 'warn'](
    isProduction
      ? '[Kiosk] KIOSK_ACCESS_PIN tanımlı değil: terminal kilidi açılamaz.'
      : `[Kiosk] KIOSK_ACCESS_PIN tanımlı değil; geliştirme PIN'i (${DEV_PIN}) kullanılıyor.`
  );
} else if (!PIN_PATTERN.test(process.env.KIOSK_ACCESS_PIN)) {
  console.error('[Kiosk] KIOSK_ACCESS_PIN 4-12 haneli bir sayı olmalı.');
}

// İmza anahtarı PIN ve QR sırlarından türetilir: PIN değiştirilince açık olan
// tüm terminal oturumları otomatik olarak geçersiz olur.
function signingKey(): Buffer {
  return createHash('sha256')
    .update(
      [
        'japar-kiosk-session',
        KIOSK_PIN,
        process.env.AES_SECRET_KEY ?? process.env.NEXT_PUBLIC_AES_SECRET_KEY ?? '',
        process.env.SHARED_SECRET_BASE32 ?? '',
      ].join('|')
    )
    .digest();
}

function sign(value: string): string {
  return createHmac('sha256', signingKey()).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Uzunluk farkı da zamanlama açığı vermesin diye özetler karşılaştırılır
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function pinMatches(pin: string): boolean {
  return Boolean(KIOSK_PIN) && safeEqual(pin, KIOSK_PIN);
}

export function createSessionToken(now = Date.now()): string {
  const expiresAt = String(now + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAt}.${sign(expiresAt)}`;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** İstekte geçerli (imzası doğru ve süresi dolmamış) bir kiosk oturumu var mı? */
export function hasValidSession(request: Request): boolean {
  if (!KIOSK_PIN) return false;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;

  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;
  if (!safeEqual(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict' as const,
  path: '/',
};
