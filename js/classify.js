// Phân loại bằng quy tắc, không dùng AI.
// Thứ tự ưu tiên: sửa tay từng dòng > quy tắc đã học > quy tắc cấu trúc (trả nợ thẻ, nội bộ…) > từ khóa > mặc định.
import { norm } from './util.js';

export const EXPENSE_CATS = [
  'Ăn uống', 'Đi chợ & siêu thị', 'Mua sắm online', 'Mua sắm', 'Di chuyển', 'Hóa đơn & tiện ích',
  'Giải trí & đăng ký', 'Sức khỏe', 'Giáo dục & con cái', 'Làm đẹp', 'Du lịch', 'Quà tặng & hiếu hỉ',
  'Bảo hiểm', 'Phí & lãi ngân hàng', 'Trả nợ vay', 'Trả góp', 'Chuyển khoản cá nhân', 'Chưa phân loại',
];
export const INCOME_CATS = ['Lương', 'Lãi tiết kiệm', 'Hoàn tiền & thưởng', 'Thu khác'];
export const KINDS = {
  expense: 'Chi tiêu',
  income: 'Thu nhập',
  transfer: 'Chuyển nội bộ (không tính)',
  savings: 'Gửi / rút tiết kiệm (không tính)',
  cc_payment: 'Trả nợ thẻ (không tính)',
  ignore: 'Loại khỏi báo cáo (chuyển nhầm, trả lại…)',
};
export const isCounted = (kind) => kind === 'expense' || kind === 'income';
export const UNCATEGORIZED = 'Chưa phân loại';

/** Danh mục có sẵn + danh mục người dùng tự thêm. "Chưa phân loại" luôn ở cuối. */
export function categoryLists(data) {
  const custom = data?.categories || { expense: [], income: [] };
  return {
    expense: [...EXPENSE_CATS.filter((c) => c !== UNCATEGORIZED), ...custom.expense, UNCATEGORIZED],
    income: [...INCOME_CATS, ...custom.income],
  };
}

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

const toKey = (s) => norm(s).replace(/\d+/g, ' ').replace(/[^a-z&.\- ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * Tên đối tác. Tiền vào thường không có cột người gửi, nên lấy tên từ nội dung:
 * "CT tu 0371 0037 TRAN VAN A toi …", "IBFT NGUYEN VAN B chuyen tien", "Huan Duc chuyen khoan…".
 */
export function partyName(t) {
  if (t.counterparty) return t.merchant || t.counterparty;
  if (t.merchant && t.merchant !== t.description) return t.merchant;
  const d = norm(t.description);
  const m = d.match(/\btu\s+[\d\s]{6,}?\s*([a-z]+(?:\s+[a-z]+){1,5}?)\s+toi\b/)
    || d.match(/((?:[a-z]+\s+){1,4})chuyen\b/);
  if (m) {
    const name = m[1].replace(/^(?:ibft|mbvcb|ck|ft|tu)\s+/, '').trim();
    if (name.split(' ').length >= 2) return name.toUpperCase();
  }
  return t.merchant || t.description;
}

/** Khóa để nhớ quy tắc: tên đối tác, bỏ dấu, bỏ số (mã đơn, mã cửa hàng thay đổi theo lần). */
export function merchantKey(t) {
  return toKey(partyName(t));
}
// Khóa kiểu cũ (trước khi tách tên người gửi), để quy tắc đã học vẫn dùng được.
const legacyKey = (t) => toKey(t.merchant || t.counterparty || t.description);


export function keywordCategory(t) {
  const text = `${norm(t.merchant)} ${norm(t.counterparty)} ${norm(t.description)}`;
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return null;
}

// Mã ngành nghề (MCC) in trên sao kê thẻ, dùng khi tên nơi bán không khớp từ khóa nào.
const MCC = [
  ['Ăn uống', /^58(12|13|14)$/],
  ['Đi chợ & siêu thị', /^(5411|5422|5441|5451|5462|5499|5300|5331)$/],
  ['Di chuyển', /^(4111|4121|4131|4784|4789|5541|5542|7523|7512)$/],
  ['Hóa đơn & tiện ích', /^(4812|4814|4816|4899|4900)$/],
  ['Sức khỏe', /^(5122|5912|80[0-9]{2})$/],
  ['Giáo dục & con cái', /^(82\d{2}|5942|5943|5641)$/],
  ['Làm đẹp', /^(7230|7297|7298|5977)$/],
  ['Du lịch', /^(3\d{3}|4411|4511|4722|7011|7012|7033)$/],
  ['Bảo hiểm', /^(6300|5960)$/],
  ['Giải trí & đăng ký', /^(5815|5816|5817|5818|7832|7841|7922|7991|7994|7996|7999)$/],
  ['Phí & lãi ngân hàng', /^(6010|6011)$/],
  ['Mua sắm', /^5\d{3}$/],
];
function mccCategory(mcc) {
  const code = String(mcc || '').match(/^(\d{4})/)?.[1];
  if (!code) return null;
  return MCC.find(([, re]) => re.test(code))?.[0] || null;
}

// Khoản ghi có khi đổi một món mua sang trả góp (TCB: "Chuyển sang trả góp", VIB: "CHUYEN TRA GOP KY HAN 3 THANG").
const INSTALLMENT_CONVERT = /chuyen sang tra gop|debt transfer to installment|chuyen tra gop ky han/;

/** Quy tắc cấu trúc: những trường hợp nhận ra chắc chắn từ nội dung giao dịch. */
function structural(t, ctx) {
  const d = norm(t.description);
  const p = norm(t.counterparty);

  // Trả nợ thẻ tín dụng: không phải chi tiêu (chi tiêu đã tính ở từng giao dịch quẹt thẻ).
  if (/thanh toan no the tin dung|thanh toan the tin dung|tt the tin dung|credit card payment|thanh toan sao ke the/.test(d)) {
    return { kind: 'cc_payment', category: '' };
  }
  // Mua hàng chuyển sang trả góp: món mua và khoản "chuyển sang trả góp" triệt tiêu nhau,
  // chi tiêu được tính dần theo từng kỳ trả góp.
  if (INSTALLMENT_CONVERT.test(d) || ctx.installmentPairs.has(t.id)) {
    return { kind: 'transfer', category: '', note: 'Đã chuyển sang trả góp, tính theo từng kỳ' };
  }
  if (/tra gop hang ky|installment repayment|gd goc tra gop|tra gop ky han \d+\/\d+/.test(d)) return { kind: 'expense', category: 'Trả góp' };
  if (/phi (chuyen doi )?tra gop/.test(d)) return { kind: 'expense', category: 'Phí & lãi ngân hàng' };

  // Khoản vay: trả nợ là tiền ra; tiền giải ngân là tiền vay, không phải thu nhập.
  const compact = d.replace(/[^0-9a-z]/g, '');
  if (t.amount < 0 && (ctx.loanIds.some((x) => compact.includes(x))
    || /thu no vay|tra no vay|tra no khoan vay|thanh toan khoan vay|thanh toan no vay|thu goc vay|thu lai vay|tra goc vay|tra lai vay|loan repayment|tat toan khoan vay/.test(d))) {
    return { kind: 'expense', category: 'Trả nợ vay' };
  }
  if (t.amount > 0 && /giai ngan|loan disbursement/.test(d)) {
    return { kind: 'transfer', category: '', note: 'Giải ngân khoản vay (tiền vay, không phải thu nhập)' };
  }

  // Lãi tiền gửi / sinh lời: thu nhập.
  if (t.amount > 0 && /tra lai so du|tra lai tien gui|loi nhuan sinh loi|lai tien gui|\binterest\b/.test(d)) {
    return { kind: 'income', category: 'Lãi tiết kiệm' };
  }
  // Gửi/rút tiết kiệm của chính mình: chuyển nội bộ.
  if (/mo moi tien gui|tat toan tiet kiem|rut goc|rut tien thong minh|gui tiet kiem|tien gui online/.test(d)) {
    return { kind: 'savings', category: '' };
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
  const m = mccCategory(t.mcc);
  if (m) return { kind: 'expense', category: m };
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
    if (!(c.amount > 0 && INSTALLMENT_CONVERT.test(norm(c.description)))) continue;
    const buy = txs
      .filter((t) => t.account === c.account && Math.abs(t.amount + c.amount) < 1 && t.date <= c.date
        && (Date.parse(c.date) - Date.parse(t.date)) / 864e5 <= 45 && !installmentPairs.has(t.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (buy) installmentPairs.add(buy.id);
  }
  const incomeCats = new Set(categoryLists(data).income);
  const loanIds = (data.loans || []).flatMap((l) => [l.accountNo, l.contract])
    .map((x) => String(x || '').replace(/[^0-9a-z]/gi, '').toLowerCase()).filter((x) => x.length >= 6);
  return { family, rules, overrides: data.overrides, installmentPairs, incomeCats, loanIds };
}

export function classify(t, ctx) {
  const key = merchantKey(t);
  const o = ctx.overrides[t.id];
  if (o) return { ...o, key, source: 'manual' };
  const r = ctx.rules.get(key) || ctx.rules.get(legacyKey(t));
  if (r) {
    const kind = isCounted(r.kind) ? (ctx.incomeCats.has(r.category) ? 'income' : 'expense') : r.kind;
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
    .map((t) => ({ ...t, party: partyName(t), ...classify(t, ctx) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
