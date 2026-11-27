// Mở file Excel có mật khẩu (mã hóa "Agile" của Office 2010 trở lên, ECMA-376) ngay trên máy bằng Web Crypto.
// Mật khẩu chỉ dùng trong bộ nhớ để giải mã, không lưu lại, không gửi đi đâu.
// Cấu trúc: file CFB chứa "EncryptionInfo" (XML tham số) và "EncryptedPackage" (file .xlsx đã mã hóa AES-CBC).

const HASH = { SHA1: 'SHA-1', 'SHA-1': 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };
// Hằng số khối theo đặc tả, dùng để sinh khóa cho từng mục.
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79];
const BLOCK_VERIFIER_HASH = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e];
const BLOCK_KEY = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
const SEGMENT = 4096;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const fit = (b, n) => (b.length >= n ? b.slice(0, n) : cat(b, new Uint8Array(n - b.length).fill(0x36)));
const digest = async (alg, data) => new Uint8Array(await crypto.subtle.digest(alg, data));
const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['encrypt', 'decrypt']);

/** Giải mã AES-CBC không đệm (Web Crypto luôn đòi đệm PKCS#7, nên nối thêm một khối đệm hợp lệ). */
async function cbcRaw(key, iv, data) {
  const last = data.slice(data.length - 16);
  const padBlock = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(16).fill(16))).slice(0, 16);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cat(data, padBlock)));
}

/** Có phải file Office đã mã hóa không (dạng CFB có mục EncryptionInfo). */
export function isEncryptedOffice(u8, CFB) {
  if (!(u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0)) return false;
  try { return !!CFB.find(CFB.read(u8, { type: 'array' }), 'EncryptionInfo'); } catch { return false; }
}

/** Trả về nội dung .xlsx đã giải mã, hoặc null nếu sai mật khẩu. */
export async function decryptOffice(u8, password, CFB) {
  const cfb = CFB.read(u8, { type: 'array' });
  const info = CFB.find(cfb, 'EncryptionInfo').content;
  const pkg = CFB.find(cfb, 'EncryptedPackage').content;
  const major = info[0] | (info[1] << 8), minor = info[2] | (info[3] << 8);
  if (!(major === 4 && minor === 4)) {
    throw new Error('Kiểu mật khẩu của file Excel này chưa hỗ trợ (chỉ đọc được file đặt mật khẩu bằng Excel 2010 trở lên). Hãy mở file bằng Excel, bỏ mật khẩu rồi nhập lại, hoặc dùng bản PDF.');
  }
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(info).slice(8)), 'application/xml');
  const kd = doc.getElementsByTagName('keyData')[0];
  const ek = [...doc.getElementsByTagName('*')].find((e) => e.localName === 'encryptedKey');
  if (!kd || !ek) throw new Error('File Excel có mật khẩu nhưng không đọc được thông tin mã hóa.');
  const num = (el, a) => +el.getAttribute(a);
  const hashOf = (el) => {
    const h = HASH[el.getAttribute('hashAlgorithm')];
    if (!h || el.getAttribute('cipherAlgorithm') !== 'AES') throw new Error('Thuật toán mã hóa của file Excel này chưa hỗ trợ.');
    return h;
  };

  // Khóa từ mật khẩu: H0 = H(salt + mật khẩu UTF-16LE), lặp spinCount lần H(i + H).
  const alg = hashOf(ek);
  const pw = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) { const c = password.charCodeAt(i); pw[i * 2] = c & 255; pw[i * 2 + 1] = c >> 8; }
  const ekSalt = b64(ek.getAttribute('saltValue'));
  let h = await digest(alg, cat(ekSalt, pw));
  const spin = num(ek, 'spinCount');
  const buf = new Uint8Array(4 + h.length);
  for (let i = 0; i < spin; i++) {
    buf.set(u32(i), 0); buf.set(h, 4);
    h = await digest(alg, buf); // digest() chép dữ liệu ngay khi gọi nên dùng lại buf được
  }
  const keyBytes = num(ek, 'keyBits') / 8;
  const derive = async (block) => aesKey(fit(await digest(alg, cat(h, new Uint8Array(block))), keyBytes));
  const iv = fit(ekSalt, num(ek, 'blockSize'));

  // Kiểm tra mật khẩu bằng cặp verifier.
  const vIn = (await cbcRaw(await derive(BLOCK_VERIFIER_INPUT), iv, b64(ek.getAttribute('encryptedVerifierHashInput')))).slice(0, num(ek, 'saltSize'));
  const vHash = (await cbcRaw(await derive(BLOCK_VERIFIER_HASH), iv, b64(ek.getAttribute('encryptedVerifierHashValue')))).slice(0, num(ek, 'hashSize'));
  const calc = (await digest(alg, vIn)).slice(0, vHash.length);
  if (calc.some((b, i) => b !== vHash[i])) return null;

  // Khóa thật của dữ liệu, rồi giải mã từng đoạn 4096 byte (IV = H(salt của keyData + số thứ tự đoạn)).
  const secret = await aesKey((await cbcRaw(await derive(BLOCK_KEY), iv, b64(ek.getAttribute('encryptedKeyValue')))).slice(0, num(kd, 'keyBits') / 8));
  const kdAlg = hashOf(kd), kdSalt = b64(kd.getAttribute('saltValue')), kdBlock = num(kd, 'blockSize');
  const data = new Uint8Array(pkg);
  const size = (data[0] | (data[1] << 8) | (data[2] << 16)) + data[3] * 2 ** 24 + (data[4] | (data[5] << 8)) * 2 ** 32;
  const out = new Uint8Array(size);
  for (let i = 0, off = 8; off < data.length && i * SEGMENT < size; i++, off += SEGMENT) {
    const chunk = data.slice(off, Math.min(off + SEGMENT, data.length));
    const usable = chunk.slice(0, chunk.length - (chunk.length % 16));
    if (!usable.length) break;
    const segIv = fit(await digest(kdAlg, cat(kdSalt, u32(i))), kdBlock);
    const plain = await cbcRaw(secret, segIv, usable);
    out.set(plain.slice(0, Math.min(plain.length, size - i * SEGMENT)), i * SEGMENT);
  }
  return out;
}
