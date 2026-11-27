// Hàm dùng chung: chuẩn hóa chữ, đọc số tiền, đọc ngày, định dạng hiển thị.

/** Bỏ dấu tiếng Việt, viết thường, gộp khoảng trắng — để so khớp văn bản. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const DATE_ONLY = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}$/;
export const isDateStr = (s) => DATE_ONLY.test(String(s).trim());

function ymd(y, m, d) {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Trả về 'YYYY-MM-DD' hoặc null. Nhận dd/mm/yyyy, yyyy-mm-dd, Date, số serial Excel. */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Math.round((v - 25569) * 86400000));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  return null;
}

/**
 * Đọc số tiền. Hỗ trợ "1,234,567", "1.234.567", "1,234.00", "(1,000)", "-50.000", "+50.000 đ".
 * Trả về number hoặc null nếu không phải số tiền.
 */
export function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/\s|VNĐ|VND|đ|₫/gi, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  let n;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) n = parseFloat(s.replace(/,/g, ''));
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+([.,]\d+)?$/.test(s)) n = parseFloat(s.replace(',', '.'));
  else return null;
  return neg ? -n : n;
}

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
export const fmtMoney = (n) => nf.format(Math.round(n || 0));
export const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n || 0)));
export const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
export const maskAccount = (no) => (no ? '••••' + String(no).replace(/\D/g, '').slice(-4) : '');

/**
 * Che số thẻ / số tài khoản khi hiển thị: "4220...4702", "513892xxxxxx9887", "513892******9887",
 * dãy từ 9 chữ số trở lên. Chỉ đổi chữ hiển thị, dữ liệu gốc (đã mã hóa) giữ nguyên để tìm kiếm, chống trùng.
 */
export function hideNumbers(s) {
  return String(s ?? '')
    .replace(/\b\d{4,6}\s?(?:\.{2,3}|…|[x*]{3,10})\s?\d{4}\b/gi, '••••')
    .replace(/(?<![A-Za-z\d])\d{9,}(?!\d)/g, '••••');
}

/** Thoát HTML để chèn chuỗi vào giao diện an toàn. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Băm ngắn (FNV-1a) để tạo mã giao dịch ổn định, dùng chống trùng khi nạp lại file. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** So tổng app đọc được với tổng in trên sao kê. */
export function sumCheck(checks, label, txs, field, expected) {
  if (expected == null) {
    checks.push({ ok: null, label: `${label}: sao kê không có dòng tổng để đối chiếu` });
    return;
  }
  const actual = txs.reduce((s, t) => s + (t[field] || 0), 0);
  checks.push({ ok: Math.abs(actual - Math.abs(expected)) < 1, label, expected: Math.abs(expected), actual });
}
