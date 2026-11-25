// Phân loại bằng quy tắc, không dùng AI.
// Thứ tự ưu tiên: sửa tay từng dòng > quy tắc đã học > quy tắc cấu trúc (trả nợ thẻ, nội bộ…) > từ khóa > mặc định.
import { norm } from './util.js';

export const EXPENSE_CATS = [
  'Ăn uống', 'Đi chợ & siêu thị', 'Mua sắm online', 'Mua sắm', 'Di chuyển', 'Hóa đơn & tiện ích',
  'Giải trí & đăng ký', 'Sức khỏe', 'Giáo dục & con cái', 'Làm đẹp', 'Du lịch', 'Quà tặng & hiếu hỉ',
  'Bảo hiểm', 'Phí & lãi ngân hàng', 'Trả góp', 'Chuyển khoản cá nhân', 'Chưa phân loại',
];
export const INCOME_CATS = ['Lương', 'Lãi tiết kiệm', 'Hoàn tiền & thưởng', 'Thu khác'];
export const KINDS = {
  expense: 'Chi tiêu',
  income: 'Thu nhập',
  transfer: 'Chuyển nội bộ (không tính)',
  cc_payment: 'Trả nợ thẻ (không tính)',
  ignore: 'Bỏ qua (không tính)',
};
export const isCounted = (kind) => kind === 'expense' || kind === 'income';
export const UNCATEGORIZED = 'Chưa phân loại';

// Từ khóa → danh mục chi (so trên chữ đã bỏ dấu, viết thường). Dòng trên được ưu tiên hơn dòng dưới.
const KEYWORDS = [
  ['Phí & lãi ngân hàng', /phi giao dich|thu phi|phi thuong nien|phi duy tri|phi chuyen|lai the|lai qua han/],
  ['Ăn uống', /shopeefood|grabfood|baemin|pizza|coffee|cafe|ca phe|phuc long|highlands|starbucks|katinat|banh mi|banh cuon|banh trang|\bbun\b|\bpho\b|quan an|nha hang|tra sua|kfc|lotteria|jollibee|mcdonald|an vat|\bmi y\b|kitchen|\boc\b|beanthere|mango|com tam|\blau\b|nuong|bakery/],
  ['Mua sắm online', /shopee|lazada|\btiki\b|shein|sendo|tiktok/],
  ['Đi chợ & siêu thị', /lotte ?mart|bach ?hoa ?xanh|bachhoaxanh|winmart|coopmart|co\.op|aeon|emart|big ?c\b|kkv|mm mega|circle ?k|family ?mart|ministop|7-eleven/],
  ['Di chuyển', /\bgrab\b|moca|be group|xanh ?sm|gojek|petrolimex|\bxang\b|vetc|epass|parking|gui xe|van chuyen/],
  ['Hóa đơn & tiện ích', /vien thong|viettel|vnpt|mobifone|vinaphone|dien luc|\bevn\b|cap nuoc|internet|truyen hinh|giat ui/],
  ['Giải trí & đăng ký', /netflix|youtube|google one|spotify|chatgpt|openai|claude|anthropic|apple\.com|icloud|garena|game|cgv|galaxy cinema|lotte cinema|\bbhd\b|dreamgames|meitu|h2lab|giai tri|g1ai|steam/],
  ['Sức khỏe', /pharma|long ?chau|nha thuoc|healthcare|benh vien|phong kham|duoc pham|medic|nha khoa|hospital|clinic/],
  ['Giáo dục & con cái', /truong|mam non|apollo|\bvus\b|hoc phi|nha hoc|\bila\b|\bedu|phuong nam|fahasa|nha sach/],
  ['Làm đẹp', /nail|\bspa\b|spa\d|salon|hasaki|cat toc|beauty|cosmetic/],
  ['Du lịch', /agoda|traveloka|booking\.com|vietjet|vietnam airlines|bamboo airways|mytrip|khach san|hotel|glamping|\btours?\b|airbnb|klook/],
  ['Bảo hiểm', /bao hiem|\baia\b|prudential|manulife|insurance/],
  ['Quà tặng & hiếu hỉ', /chuc mung|happy birthday|sinh nhat|qua tang|mung cuoi|phong bi|vieng/],
];
const COMPANY = /cong ty|\bcty\b|\bct\b|tnhh|ho kinh doanh|\bhkd\b|corp|jsc|ltd|group|cua hang|\bshop\b|store|truong|benh vien|trung gian|ngan hang|techcombank|payoo/;

/** Khóa để nhớ quy tắc: tên nơi giao dịch, bỏ dấu, bỏ số (mã đơn, mã cửa hàng thay đổi theo lần). */
export function merchantKey(t) {
  return norm(t.merchant || t.counterparty || t.description)
    .replace(/\d+/g, ' ').replace(/[^a-z&.\- ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

const kindForCategory = (cat) => (INCOME_CATS.includes(cat) ? 'income' : 'expense');

export function keywordCategory(t) {
  const text = `${norm(t.merchant)} ${norm(t.counterparty)} ${norm(t.description)}`;
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return null;
}

/** Quy tắc cấu trúc: những trường hợp nhận ra chắc chắn từ nội dung giao dịch. */
function structural(t, ctx) {
  const d = norm(t.description);
  const p = norm(t.counterparty);

  // Trả nợ thẻ tín dụng: không phải chi tiêu (chi tiêu đã tính ở từng giao dịch quẹt thẻ).
  if (/thanh toan no the tin dung|thanh toan the tin dung|tt the tin dung|credit card payment/.test(d)) {
    return { kind: 'cc_payment', category: '' };
  }
  // Mua hàng chuyển sang trả góp: món mua và khoản "chuyển sang trả góp" triệt tiêu nhau,
  // chi tiêu được tính dần theo từng kỳ "Trả góp hàng kỳ".
  if (/chuyen sang tra gop|debt transfer to installment/.test(d) || ctx.installmentPairs.has(t.id)) {
    return { kind: 'transfer', category: '', note: 'Đã chuyển sang trả góp, tính theo từng kỳ' };
  }
  if (/tra gop hang ky|installment repayment/.test(d)) return { kind: 'expense', category: 'Trả góp' };
  if (/phi tra gop/.test(d)) return { kind: 'expense', category: 'Phí & lãi ngân hàng' };

  // Lãi tiền gửi / sinh lời: thu nhập.
  if (t.amount > 0 && /tra lai so du|tra lai tien gui|loi nhuan sinh loi|lai tien gui|\binterest\b/.test(d)) {
    return { kind: 'income', category: 'Lãi tiết kiệm' };
  }
  // Gửi/rút tiết kiệm của chính mình: chuyển nội bộ.
  if (/mo moi tien gui|tat toan tiet kiem|rut goc|rut tien thong minh|gui tiet kiem|tien gui online/.test(d)) {
    return { kind: 'transfer', category: '', note: 'Tiết kiệm' };
  }
  // Chuyển tiền giữa tài khoản của các thành viên trong gia đình.
  for (const f of ctx.family) {
    if (t.amount < 0 && p && (p === f || p.startsWith(f + ' ') || p.endsWith(' ' + f))) {
      return { kind: 'transfer', category: '', note: 'Chuyển cho tài khoản trong gia đình' };
    }
    if (t.amount > 0 && (d.startsWith(f + ' chuyen') || d.includes(' ' + f + ' chuyen') || (p && p === f))) {
      return { kind: 'transfer', category: '', note: 'Nhận từ tài khoản trong gia đình' };
    }
  }
  // Hoàn tiền / trả hàng: là chi tiêu âm, làm giảm chi của danh mục.
  if (t.amount > 0 && /hoan tra|tra lai hang|merchandi[sz]e return|refund|hoan tien/.test(d)) {
    return { kind: 'expense', category: keywordCategory(t) || UNCATEGORIZED, note: 'Hoàn tiền' };
  }
  return null;
}

function automatic(t) {
  const d = norm(t.description);
  if (t.amount > 0) {
    if (/\bluong\b|salary|payroll/.test(d)) return { kind: 'income', category: 'Lương' };
    if (/tien thuong|\bbonus\b|cashback|hoan tien/.test(d)) return { kind: 'income', category: 'Hoàn tiền & thưởng' };
    return { kind: 'income', category: 'Thu khác' };
  }
  const k = keywordCategory(t);
  if (k) return { kind: 'expense', category: k };
  const p = norm(t.counterparty);
  if (p && !COMPANY.test(p) && /chuyen/.test(d)) return { kind: 'expense', category: 'Chuyển khoản cá nhân' };
  return { kind: 'expense', category: UNCATEGORIZED };
}

export function buildContext(data) {
  const family = data.family.map(norm).filter((f) => f.length >= 4);
  const rules = new Map(data.rules.map((r) => [r.key, r]));

  // Ghép "Chuyển sang trả góp" (ghi có) với giao dịch mua cùng số tiền trong 45 ngày trước đó, cùng tài khoản.
  const installmentPairs = new Set();
  const txs = Object.values(data.transactions);
  for (const c of txs) {
    if (!(c.amount > 0 && /chuyen sang tra gop|debt transfer to installment/.test(norm(c.description)))) continue;
    const buy = txs
      .filter((t) => t.account === c.account && Math.abs(t.amount + c.amount) < 1 && t.date <= c.date
        && (Date.parse(c.date) - Date.parse(t.date)) / 864e5 <= 45 && !installmentPairs.has(t.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (buy) installmentPairs.add(buy.id);
  }
  return { family, rules, overrides: data.overrides, installmentPairs };
}

export function classify(t, ctx) {
  const key = merchantKey(t);
  const o = ctx.overrides[t.id];
  if (o) return { ...o, key, source: 'manual' };
  const r = ctx.rules.get(key);
  if (r) {
    const kind = isCounted(r.kind) ? kindForCategory(r.category) : r.kind;
    return { kind, category: isCounted(kind) ? r.category : '', key, source: 'rule' };
  }
  const s = structural(t, ctx);
  if (s) return { ...s, key, source: 'system' };
  return { ...automatic(t), key, source: 'auto' };
}

/** Trả về danh sách giao dịch kèm kind/category, mới nhất trước. */
export function classifyAll(data) {
  const ctx = buildContext(data);
  return Object.values(data.transactions)
    .map((t) => ({ ...t, ...classify(t, ctx) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
