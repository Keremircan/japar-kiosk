// Karekod içeriğinin şifrelenmesi (yalnızca sunucuda çalışır).
//
// BU DOSYANIN KARŞILIĞI: JaparQrNext/lib/qrToken.ts — biçim veya anahtar
// türetme değişirse iki dosya birlikte güncellenmelidir.
//
// Biçim (v2):  "v2." + base64url( iv[12] | şifreli metin | etiket[16] )
// Algoritma:   AES-256-GCM (kimlik doğrulamalı şifreleme: içerik değiştirilirse
//              çözülemez). Anahtar AES_SECRET_KEY'den HKDF-SHA256 ile türetilir.

import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';

export const QR_FORMAT_PREFIX = 'v2.';
const IV_BYTES = 12;
const KEY_INFO = 'japar-pdks/qr/v2';
const ADDITIONAL_DATA = Buffer.from('japar-pdks-qr-v2');

// Belgelerde/örneklerde yayımlanmış, gizli sayılamayacak değerler
const PUBLIC_SAMPLE_VALUES = new Set([
  'JBSWY3DPEHPK3PXP',
  '12345678901234567890123456789012',
]);

const MIN_SHARED_SECRET_LENGTH = 32; // Base32 karakter (160 bit)
const MIN_AES_SECRET_LENGTH = 32;

export type QrSecrets = { sharedSecretBase32: string; key: Buffer };

/**
 * Ortam değişkenlerini doğrular. Eksik, zayıf veya herkese açık örnek değerler
 * kabul edilmez; bu durumda karekod üretimi tamamen kapatılır (fail closed).
 */
export function loadQrSecrets(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; secrets: QrSecrets } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const shared = (env.SHARED_SECRET_BASE32 ?? '').replace(/[\s=]/g, '').toUpperCase();
  const aes = env.AES_SECRET_KEY ?? '';

  if (!shared) problems.push('SHARED_SECRET_BASE32 tanımlı değil');
  else if (!/^[A-Z2-7]+$/.test(shared)) problems.push('SHARED_SECRET_BASE32 geçerli Base32 değil');
  else if (shared.length < MIN_SHARED_SECRET_LENGTH)
    problems.push(`SHARED_SECRET_BASE32 en az ${MIN_SHARED_SECRET_LENGTH} karakter olmalı`);
  else if (PUBLIC_SAMPLE_VALUES.has(shared)) problems.push('SHARED_SECRET_BASE32 herkese açık örnek değer');

  if (!aes) problems.push('AES_SECRET_KEY tanımlı değil');
  else if (aes.length < MIN_AES_SECRET_LENGTH)
    problems.push(`AES_SECRET_KEY en az ${MIN_AES_SECRET_LENGTH} karakter olmalı`);
  else if (PUBLIC_SAMPLE_VALUES.has(aes)) problems.push('AES_SECRET_KEY herkese açık örnek değer');

  if (problems.length > 0) return { ok: false, problems };

  const key = Buffer.from(hkdfSync('sha256', aes, 'japar-pdks', KEY_INFO, 32));
  return { ok: true, secrets: { sharedSecretBase32: shared, key } };
}

export function encryptQrPayload(payload: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(ADDITIONAL_DATA);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return QR_FORMAT_PREFIX + Buffer.concat([iv, encrypted, tag]).toString('base64url');
}
