import { NextResponse } from 'next/server';
import {
  KIOSK_PIN,
  PIN_PATTERN,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hasValidSession,
  pinMatches,
  sessionCookieOptions,
} from '../../../lib/session';

// PIN tahmin denemelerini yavaşlatmak için IP başına hatalı deneme sınırı.
// Sayaç sunucu belleğindedir; çok örnekli ortamlarda (Vercel) her örnek kendi
// sayacını tutar, bu yüzden kesin sınır için platformun WAF kuralı da önerilir.
const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000;
const failures = new Map<string, number[]>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function recentFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length > 0) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Tek uç nokta: { action: 'status' | 'unlock' | 'lock', pin? }
// POST kullanılır ki yanıt hiçbir katmanda önbelleğe alınmasın.
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const { action, pin } = (body ?? {}) as Record<string, unknown>;

  if (action === 'status') {
    return json({
      success: true,
      unlocked: hasValidSession(request),
      configured: Boolean(KIOSK_PIN),
    });
  }

  if (action === 'lock') {
    const response = json({ success: true });
    response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
    return response;
  }

  if (action !== 'unlock') {
    return json({ success: false, message: 'Geçersiz istek.' }, 400);
  }

  if (!KIOSK_PIN) {
    return json(
      {
        success: false,
        code: 'NOT_CONFIGURED',
        message: 'Terminal şifresi tanımlanmamış (KIOSK_ACCESS_PIN).',
      },
      503
    );
  }

  const ip = clientIp(request);
  const recent = recentFailures(ip);
  if (recent.length >= MAX_FAILURES) {
    const waitMinutes = Math.ceil((WINDOW_MS - (Date.now() - recent[0])) / 60_000);
    return json(
      {
        success: false,
        code: 'TOO_MANY_ATTEMPTS',
        message: `Çok fazla hatalı deneme. ${waitMinutes} dakika sonra tekrar deneyin.`,
      },
      429
    );
  }

  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin) || !pinMatches(pin)) {
    recent.push(Date.now());
    failures.set(ip, recent);
    return json(
      {
        success: false,
        code: 'WRONG_PIN',
        message: 'Hatalı Terminal Şifresi',
        remainingAttempts: Math.max(0, MAX_FAILURES - recent.length),
      },
      401
    );
  }

  failures.delete(ip);
  const response = json({ success: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    ...sessionCookieOptions,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
