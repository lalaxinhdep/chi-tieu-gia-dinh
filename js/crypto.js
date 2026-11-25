// Mã hóa AES-GCM 256-bit, khóa sinh từ mật khẩu bằng PBKDF2-SHA256 (Web Crypto, chạy trên máy).
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_ITER = 600000;
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(password, salt, iterations = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // khóa không thể trích xuất ra ngoài
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  return { iv, ct };
}

/** Ném lỗi nếu sai khóa hoặc dữ liệu bị sửa (GCM có kiểm tra toàn vẹn). */
export async function decryptJSON(key, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(td.decode(pt));
}

export function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
