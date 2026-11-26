// Hiểu nội dung ảnh chụp màn hình sau khi đọc chữ (js/ocr.js):
// 1) màn hình thông tin khoản vay của app ngân hàng → các trường của khoản vay;
// 2) lịch sử giao dịch / sao kê chụp lại → danh sách giao dịch để người dùng soát lại trước khi lưu.
import { norm, parseMoney } from '../util.js';
import { today } from '../loans.js';

// Nhãn → trường. Thứ tự quan trọng: nhãn cụ thể đứng trước nhãn chung.
const LABELS = [
  ['disbursements', /so lan giai ngan/],
  ['startDate', /ngay (giai ngan|mo|vay|hieu luc)/],
  ['maturity', /ngay (dao han|het han|ket thuc)/],
  ['nextPayment', /ngay (thanh toan|tra no|tra|den han)|ky thanh toan tiep|han thanh toan/],
  ['accruedInterest', /lai cong don|lai du thu|lai phai tra|lai tam tinh/],
  ['paidInterest', /lai da tra|da tra lai/],
  ['paidPrincipal', /goc da tra|da tra goc/],
  ['floatRate', /lai suat tha noi/],
  ['rate', /lai suat|\bsuat\b/],
  ['outstanding', /du no|^du n|so tien con no|goc con lai/],
  ['disbursed', /tien (da )?giai ngan|so tien vay/],
  ['limit', /han muc/],
  ['termMonths', /ky han|thoi han vay|thoi gian vay/],
  ['monthlyPayment', /so tien (can |phai )?(tra|thanh toan)|tong tien phai tra/],
  ['contract', /hop dong/],
  ['accountNo', /tai khoan vay|so tai khoan|so tk/],
  ['product', /san pham/],
  ['currency', /don vi tien te|loai tien/],
  ['branch', /chi nhanh|phong giao dich|don vi quan ly/],
];
const TYPE = {
  disbursements: 'int', startDate: 'date', maturity: 'date', nextPayment: 'date',
  accruedInterest: 'money', paidInterest: 'money', paidPrincipal: 'money', outstanding: 'money',
  disbursed: 'money', limit: 'money', monthlyPayment: 'money', floatRate: 'pct', rate: 'pct',
  termMonths: 'term', contract: 'code', accountNo: 'code',
};

const MONEY_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,}/;
const DATE_RE = /(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?!\d)/;

function labelField(row) {
  const cands = [row.label || row.text, row.labelEng].map(norm).filter(Boolean);
  for (const [k, re] of LABELS) if (cands.some((c) => re.test(c))) return k;
  return null;
}

function valueOf(field, vie, eng) {
  const type = TYPE[field] || 'text';
  const src = /\d/.test(eng) ? eng : vie; // số lấy theo mô hình tiếng Anh, chữ theo tiếng Việt
  if (type === 'money') { const m = src.match(MONEY_RE); return m ? parseMoney(m[0]) : null; }
  if (type === 'int') { const m = src.match(/\d+/); return m ? +m[0] : null; }
  if (type === 'pct') { const m = src.replace(/(\d),(\d)/, '$1.$2').match(/(\d+(?:\.\d+)?)\s*%/) || src.match(/(\d+\.\d+)/); return m ? +m[1] : null; }
  if (type === 'term') { const m = src.match(/(\d+)\s*(\S*)/); if (!m) return null; return /^n/i.test(norm(m[2])) ? +m[1] * 12 : +m[1]; }
  if (type === 'date') { const m = src.match(DATE_RE); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; }
  if (type === 'code') return src.replace(/\s+/g, '').replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
  return vie.replace(/^[^0-9A-Za-zÀ-ỹ]+|[^0-9A-Za-zÀ-ỹ.)]+$/g, '').trim();
}

/** Thông tin khoản vay trong ảnh. Trả về { fields, found } (found = số trường đọc được). */
export function loanFromRows(rows) {
  const labeled = [];
  const loose = [];
  for (const r of rows) {
    const f = labelField(r);
    if (f && (r.label || r.left)) labeled.push({ r, f, vie: r.value, eng: r.valueEng });
    else if (!r.left) loose.push(r);
  }
  // Giá trị nằm riêng một dòng (nhãn xuống dòng) hoặc phần đuôi của giá trị dài.
  for (const r of loose) {
    const mid = (r.y0 + r.y1) / 2;
    const near = labeled
      .map((x) => ({ x, d: Math.abs((x.r.y0 + x.r.y1) / 2 - mid) }))
      .filter((o) => o.d < (r.y1 - r.y0) * 2.2)
      .sort((a, b) => a.d - b.d)[0]?.x;
    if (!near) continue;
    if (!near.vie && !near.eng) { near.vie = r.text; near.eng = r.num; }
    else if (r.y0 > near.r.y0 && (!TYPE[near.f] || TYPE[near.f] === 'code')) {
      near.vie += r.text; near.eng += r.num;
    }
  }
  const fields = {};
  for (const x of labeled) {
    if (fields[x.f] != null && fields[x.f] !== '') continue;
    const v = valueOf(x.f, x.vie || '', x.eng || '');
    if (v != null && v !== '') fields[x.f] = v;
  }
  if (fields.branch) fields.branch = fields.branch.replace(/^Chỉ nhánh/i, 'Chi nhánh');
  if (fields.currency) fields.currency = (fields.currency.match(/[A-Z]{3}/) || [fields.currency])[0];
  return { fields, found: Object.keys(fields).length };
}

// ---------- Giao dịch trong ảnh ----------
const MONEY_G = /(^|[^\d.,])([+\-−–]?)\s?(\d{1,3}(?:[.,]\d{3})+)(?![\d])(?:[.,]\d{1,2}(?!\d))?/g;
const DATE_G = /(?<![\d.,])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d.,])/;
const SKIP = /so du|balance|han muc|tong (cong|tien)|du no|kha dung/;
const OUT_WORDS = /ghi no|thanh toan|chuyen di|chuyen tien|tru tien|rut tien|mua|debit/;
const IN_WORDS = /ghi co|nhan tien|nhan tu|cong tien|hoan tien|credit|luong/;

function dateIn(s, now) {
  const n = norm(s);
  if (/hom nay|today/.test(n)) return now;
  if (/hom qua|yesterday/.test(n)) { const d = new Date(Date.parse(now) - 864e5); return d.toISOString().slice(0, 10); }
  const m = s.match(DATE_G);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? +m[3] : +now.slice(0, 4);
  if (y < 100) y += 2000;
  let iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!m[3] && iso > now) iso = `${y - 1}${iso.slice(4)}`;
  return iso;
}

function amountsIn(s) {
  const out = [];
  for (const m of s.matchAll(MONEY_G)) {
    const v = parseMoney(m[3]);
    if (v) out.push({ v, sign: m[2] ? (m[2] === '+' ? 1 : -1) : 0, raw: m[0].slice(m[1].length) });
  }
  return out;
}

const clean = (s) => s
  .replace(/[+\-−–]?\s?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?/g, ' ')
  .replace(/(?<!\d)\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, ' ')
  .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
  .replace(/(^|\s)(VND|VNĐ|đ|₫)(?=\s|$)/gi, ' ')
  .replace(/[|®©@<>{}[\]_~]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Danh sách giao dịch đoán được từ ảnh: [{ date, description, amount, signGuess }]. */
export function txsFromRows(rows) {
  const now = today();
  const info = rows.map((r) => {
    const a = amountsIn(r.num || r.text);
    const a2 = a.length ? a : amountsIn(r.text);
    return { r, amounts: SKIP.test(norm(r.text)) ? [] : a2, date: dateIn(r.num || r.text, now) || dateIn(r.text, now), desc: clean(r.text) };
  });
  const idx = info.map((x, i) => (x.amounts.length ? i : -1)).filter((i) => i >= 0);
  const txs = [];
  let header = null;
  let prev = -1;
  // Dòng chỉ có ngày (tiêu đề nhóm "24/11/2026") áp cho các giao dịch bên dưới nó, không áp ngược lên trên.
  // Dòng có cả giờ ("10:15 25/11/2026") là dòng chi tiết của giao dịch, không phải tiêu đề nhóm.
  const isHeader = (y) => y.date && !y.desc.replace(/[^\p{L}]/gu, '') && !/\d{1,2}:\d{2}/.test(y.r.text);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    let next = idx[k + 1] ?? info.length;
    for (let j = i + 1; j < next; j++) if (isHeader(info[j])) { next = j; break; }
    for (let j = prev + 1; j < i; j++) if (isHeader(info[j])) header = info[j].date;
    const x = info[i];
    const above = info.slice(prev + 1, i);
    const below = info.slice(i + 1, next);
    const textRow = (list) => list.find((y) => y.desc.replace(/[^\p{L}]/gu, '').length >= 3);
    const desc = x.desc.replace(/[^\p{L}]/gu, '').length >= 3 ? x.desc : (textRow(above.slice().reverse()) || textRow(below))?.desc || '';
    const date = x.date || below.find((y) => y.date)?.date || above.slice().reverse().find((y) => y.date)?.date || header || '';
    const a = x.amounts.find((m) => m.sign) || x.amounts[0];
    const ctx = norm([x.r.text, ...above.map((y) => y.r.text), ...below.map((y) => y.r.text)].join(' '));
    let sign = a.sign, signGuess = false;
    if (!sign) { sign = IN_WORDS.test(ctx) && !OUT_WORDS.test(norm(x.r.text)) ? 1 : -1; signGuess = true; }
    txs.push({ date, description: desc, amount: sign * a.v, signGuess });
    prev = i;
  }
  return txs;
}
