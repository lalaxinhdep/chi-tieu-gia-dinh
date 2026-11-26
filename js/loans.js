// Khoản vay: danh sách trường thông tin và các phép tính ước lượng (lịch trả nợ, trả trước…).
// Lãi tính theo tháng (dư nợ × lãi năm / 12), nên chỉ là ước tính; ngân hàng tính theo số ngày thực tế.
import { norm, parseMoney, parseDate } from './util.js';

export const METHODS = {
  principal: 'Gốc chia đều, lãi tính trên dư nợ (giảm dần)',
  annuity: 'Trả đều mỗi tháng (gốc + lãi bằng nhau)',
};

// type: text | money | int | pct | date | select | textarea
export const LOAN_FIELDS = [
  { group: 'Thông tin khoản vay' },
  { k: 'name', label: 'Tên gợi nhớ', type: 'text', ph: 'Ví dụ: Vay mua nhà' },
  { k: 'bank', label: 'Ngân hàng', type: 'text', ph: 'Ví dụ: Techcombank' },
  { k: 'product', label: 'Sản phẩm vay', type: 'text' },
  { k: 'contract', label: 'Hợp đồng vay', type: 'text' },
  { k: 'accountNo', label: 'Tài khoản vay', type: 'text' },
  { k: 'currency', label: 'Đơn vị tiền tệ', type: 'text', ph: 'VND' },
  { k: 'limit', label: 'Hạn mức vay', type: 'money' },
  { k: 'disbursed', label: 'Số tiền đã giải ngân', type: 'money' },
  { k: 'disbursements', label: 'Số lần giải ngân', type: 'int' },
  { k: 'startDate', label: 'Ngày giải ngân / ngày mở', type: 'date' },
  { k: 'termMonths', label: 'Kỳ hạn vay (tháng)', type: 'int', hint: 'Để trống: app tính từ ngày mở đến ngày đáo hạn' },
  { k: 'maturity', label: 'Ngày đáo hạn', type: 'date' },
  { k: 'branch', label: 'Chi nhánh quản lý', type: 'text' },
  { group: 'Dư nợ và số đã trả' },
  { k: 'outstanding', label: 'Dư nợ hiện tại', type: 'money' },
  { k: 'outstandingAsOf', label: 'Dư nợ tính đến ngày', type: 'date' },
  { k: 'accruedInterest', label: 'Lãi cộng dồn', type: 'money' },
  { k: 'paidPrincipal', label: 'Đã trả gốc', type: 'money', hint: 'Để trống: app lấy số đã giải ngân trừ dư nợ' },
  { k: 'paidInterest', label: 'Đã trả lãi', type: 'money' },
  { group: 'Lãi suất' },
  { k: 'rate', label: 'Lãi suất cố định / ưu đãi (%/năm)', type: 'pct' },
  { k: 'fixedMonths', label: 'Cố định trong (tháng)', type: 'int' },
  { k: 'floatStart', label: 'Bắt đầu thả nổi từ ngày', type: 'date', hint: 'Để trống: app tính từ ngày mở cộng số tháng cố định' },
  { k: 'floatRate', label: 'Lãi suất thả nổi hiện tại (%/năm)', type: 'pct' },
  { k: 'floatMargin', label: 'Biên độ thả nổi (%/năm)', type: 'pct', hint: 'Ví dụ: lãi tiết kiệm 24 tháng + 3,5%. Ghi để nhớ, không dùng để tính' },
  { group: 'Trả nợ hằng tháng' },
  { k: 'method', label: 'Cách trả', type: 'select', options: METHODS },
  { k: 'monthlyPayment', label: 'Số tiền phải trả hằng tháng', type: 'money', hint: 'Theo thông báo của ngân hàng. Để trống: app ước tính' },
  { k: 'nextPayment', label: 'Ngày thanh toán tiếp theo', type: 'date' },
  { k: 'prepayFee', label: 'Phí trả nợ trước hạn (%)', type: 'pct' },
  { k: 'note', label: 'Ghi chú', type: 'textarea' },
];

export const emptyLoan = () => ({ id: '', method: 'principal', currency: 'VND', payments: [] });

// ---------- Ngày tháng ----------
const pad = (n) => String(n).padStart(2, '0');
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function monthsBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

// ---------- Tính toán ----------
const num = (v) => (v == null || v === '' || Number.isNaN(v) ? null : v);

/** Các giá trị suy ra từ thông tin đã nhập. */
export function derived(loan, now = today()) {
  const term = num(loan.termMonths) ?? (loan.startDate && loan.maturity ? monthsBetween(loan.startDate, loan.maturity) : null);
  const maturity = loan.maturity || (loan.startDate && term ? addMonths(loan.startDate, term) : '');
  const floatStart = loan.floatStart || (loan.startDate && num(loan.fixedMonths) ? addMonths(loan.startDate, loan.fixedMonths) : '');
  // Kỳ trả tới: nếu ngày đã nhập đã qua thì lùi sang tháng sau.
  let next = loan.nextPayment || (loan.startDate ? addMonths(loan.startDate, 1) : '');
  if (next) { const base = next; for (let i = 1; next < now && i < 720; i++) next = addMonths(base, i); }
  const dates = [];
  if (next && maturity) for (let i = 0, d = next; d <= maturity && i < 720; d = addMonths(next, ++i)) dates.push(d);
  const balance = num(loan.outstanding) ?? num(loan.disbursed);
  const paidPrincipal = num(loan.paidPrincipal)
    ?? (num(loan.disbursed) != null && num(loan.outstanding) != null ? loan.disbursed - loan.outstanding : null);
  const rateAt = (date) => (floatStart && date >= floatStart ? num(loan.floatRate) ?? num(loan.rate) : num(loan.rate));
  return {
    term, maturity, floatStart, floatAuto: !loan.floatStart && !!floatStart,
    next, dates, balance, paidPrincipal, rateAt,
    currentRate: rateAt(now), floating: !!floatStart && now >= floatStart,
    floatRateMissing: !!floatStart && num(loan.floatRate) == null,
  };
}

const annuity = (p, r, n) => (r ? (p * r) / (1 - (1 + r) ** -n) : p / n);

/**
 * Lịch trả nợ dự kiến từ kỳ tới đến hết.
 * extra: trả trước ngay bây giờ; keep: 'term' giữ kỳ hạn (giảm tiền trả) | 'payment' giữ mức trả (rút ngắn thời gian).
 */
export function schedule(loan, { extra = 0, keep = 'term', baseline = null } = {}) {
  const d = derived(loan);
  if (d.balance == null || !d.dates.length || d.rateAt(d.dates[0]) == null) return null;
  const n = d.dates.length;
  let bal = Math.max(0, d.balance - extra);
  // Gốc đều: nếu biết số đã giải ngân và kỳ hạn thì gốc mỗi kỳ = giải ngân / kỳ hạn (đúng như ngân hàng tính).
  let basePrincipal = d.balance / n;
  if (num(loan.disbursed) && d.term && loan.disbursed >= d.balance) {
    const p = loan.disbursed / d.term;
    if (p * n >= d.balance * 0.98) basePrincipal = p;
  }
  const fixedPrincipal = keep === 'payment' || !extra ? basePrincipal : (basePrincipal * bal) / d.balance;
  const rows = [];
  let pmt = null, lastR = null;
  for (let i = 0; i < n && bal > 0.5; i++) {
    const date = d.dates[i];
    const r = (d.rateAt(date) || 0) / 1200;
    const interest = bal * r;
    let principal;
    if (loan.method === 'annuity') {
      if (keep === 'payment' && baseline?.rows[i]) pmt = baseline.rows[i].total;
      else if (pmt == null || r !== lastR) pmt = annuity(bal, r, n - i);
      principal = pmt - interest;
    } else principal = fixedPrincipal;
    if (i === n - 1) principal = bal;
    principal = Math.min(Math.max(principal, 0), bal);
    bal -= principal;
    lastR = r;
    rows.push({ date, principal, interest, total: principal + interest, balance: bal, rate: r * 1200 });
  }
  return {
    rows,
    totalInterest: rows.reduce((s, x) => s + x.interest, 0),
    totalPaid: rows.reduce((s, x) => s + x.total, 0),
    end: rows.at(-1)?.date || '',
  };
}

/** So sánh trả trước một khoản với không trả trước. */
export function prepay(loan, extra, keep) {
  const base = schedule(loan);
  if (!base || !(extra > 0)) return null;
  const alt = schedule(loan, { extra, keep, baseline: base });
  const fee = (extra * (num(loan.prepayFee) || 0)) / 100;
  return {
    saved: base.totalInterest - alt.totalInterest,
    fee,
    monthsLess: base.rows.length - alt.rows.length,
    newEnd: alt.end,
    newFirst: alt.rows[0]?.total || 0,
    oldFirst: base.rows[0]?.total || 0,
  };
}

/** Giao dịch trong sao kê có vẻ là trả nợ khoản vay này (theo số tài khoản / hợp đồng, hoặc danh mục Trả nợ vay). */
export function matchTxs(loan, txs) {
  const linked = new Set((loan.payments || []).map((p) => p.txId).filter(Boolean));
  const ids = [loan.accountNo, loan.contract].map((x) => String(x || '').replace(/[^0-9a-z]/gi, '').toLowerCase()).filter((x) => x.length >= 6);
  return txs.filter((t) => {
    if (t.amount >= 0 || linked.has(t.id)) return false;
    const d = norm(`${t.description} ${t.counterparty || ''}`).replace(/[^0-9a-z]/g, '');
    return ids.some((x) => d.includes(x)) || t.category === 'Trả nợ vay';
  });
}

// ---------- Đọc giá trị nhập tay ----------
export function parseField(f, raw) {
  const s = String(raw ?? '').trim();
  if (f.type === 'money') return s ? parseMoney(s) : null;
  if (f.type === 'int') { const m = s.match(/\d+/); return m ? +m[0] : null; }
  if (f.type === 'pct') { const m = s.replace(',', '.').match(/\d+(\.\d+)?/); return m ? +m[0] : null; }
  if (f.type === 'date') return s ? parseDate(s) || '' : '';
  return s;
}

/** Tên hiển thị của khoản vay. */
export const loanTitle = (l) => l.name || [l.bank, l.product].filter(Boolean).join(' · ') || (l.accountNo ? `Khoản vay ${l.accountNo}` : 'Khoản vay');
