// Techcombank — "Sao kê tài khoản thẻ tín dụng" (PDF hằng tháng).
// Mục A: Ngày GD | Ngày cập nhật hệ thống | Số tiền gốc | Ghi nợ | Ghi có | Diễn giải
import { parseMoney, parseDate, isDateStr, sumCheck, fmtMoney, norm } from '../util.js';
import { lineAt, findItem, joinCell, lastMoney, valueRightOf, groupByAnchors } from './pdf-layout.js';

export const id = 'tcb-credit';

export function detect(text) {
  return text.includes('sao ke tai khoan the tin dung') && text.includes('techcombank');
}

const COLS = [/^ngay giao dich/, /^ngay cap nhat he thong/, /^so tien giao dich goc/, /^ghi no/, /^ghi co/, /^dien giai/];
const C = { txDate: 0, postDate: 1, orig: 2, debit: 3, credit: 4, desc: 5 };
const MAX_DIST = 22;

/**
 * Mục B: mỗi khoản trả góp có Số tiền chuyển trả góp | Số tiền trả góp trong kỳ (âm) | … | Diễn giải
 * ("THEGIOIDIDONG.COM_13 (kỳ trả thứ 9/12)", có thể xuống dòng).
 */
function installmentPlans(pages) {
  const plans = [];
  let started = false;
  for (const page of pages) {
    const items = page.items;
    const sec = findItem(items, /^b\. thong tin tra gop/);
    if (!started && !sec) continue;
    started = true;
    const hPay = findItem(items, /^so tien tra gop$/, sec ? sec.y : -Infinity);
    const hAmt = findItem(items, /^so tien chuyen$/, sec ? sec.y : -Infinity);
    const hDesc = findItem(items, /^dien giai$/, sec ? sec.y : -Infinity);
    const hRemain = findItem(items, /^so ky tra gop/, sec ? sec.y : -Infinity);
    const hLeft = findItem(items, /^so tien tra gop con/, sec ? sec.y : -Infinity);
    const hConv = findItem(items, /^ngay chuyen/, sec ? sec.y : -Infinity);
    if (!hPay || !hDesc) continue;
    const rows = items.filter((i) => i.y > hPay.y + 20 && Math.abs(i.x - hPay.x) < 40 && (parseMoney(i.s) ?? 0) < 0);
    for (const r of rows) {
      const near = items.filter((i) => Math.abs(i.y - r.y) <= 14 && i.x >= hDesc.x - 4);
      const desc = near.sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
      const term = norm(desc).match(/ky tra thu\s*(\d+\s*\/\s*\d+)/)?.[1].replace(/\s/g, '');
      if (!term) continue;
      const cell = (h) => h && items.find((i) => Math.abs(i.y - r.y) <= 3 && Math.abs(i.x - h.x) < 40);
      const amt = cell(hAmt), remain = cell(hRemain), left = cell(hLeft), conv = cell(hConv);
      const [paid, periods] = term.split('/').map(Number);
      plans.push({
        payment: Math.abs(parseMoney(r.s)),
        total: amt ? parseMoney(amt.s) : null,
        term, paid, periods,
        remaining: remain && /^\d+$/.test(remain.s.trim()) ? +remain.s.trim() : periods - paid,
        outstanding: left ? parseMoney(left.s) : null,
        convDate: conv ? parseDate(conv.s) : null,
        item: desc.replace(/\s*\(\s*k[ỳy] tr[ảa].*$/i, '').trim(),
      });
    }
  }
  return plans;
}

export function parse(pages) {
  const first = pages[0].items;
  const accountNo = valueRightOf(first, /^so tai khoan the tin dung/).replace(/\D/g, '');
  const holder = valueRightOf(first, /^ong\/ba/);
  const statementDate = parseDate(valueRightOf(first, /^ngay sao ke/));

  const txs = [];
  const warnings = [];
  let starts = null;
  let started = false;
  let finished = false;
  let totalDebit = null, totalCredit = null;
  const cards = new Set();
  const colOf = (x) => { let i = 0; while (i + 1 < starts.length && x + 4 >= starts[i + 1]) i++; return i; };

  for (const page of pages) {
    if (finished) break;
    const items = page.items;
    let top = -Infinity;
    let bottom = Infinity;

    if (!started) {
      const s = findItem(items, /thong tin chi tiet/);
      if (!s) continue;
      started = true;
      top = s.y + 2;
    }

    const hdr = findItem(items, /^ngay cap nhat he thong/, top);
    if (hdr) {
      const line = lineAt(items, hdr.y, 4);
      const xs = COLS.map((re) => line.find((i) => re.test(i.n))?.x);
      if (xs.some((x) => x == null)) throw new Error('Không nhận ra tiêu đề bảng giao dịch của sao kê thẻ Techcombank.');
      starts = xs;
      const eng = findItem(items, /^post date/, hdr.y);
      top = Math.max(top, hdr.y, eng?.y ?? -Infinity) + 2;
    }
    if (!starts) continue;

    const end = findItem(items, /^tong ghi no trong ky/, top);
    if (end) {
      bottom = end.y - 2;
      finished = true;
      totalDebit = lastMoney(lineAt(items, end.y));
      const endC = findItem(items, /^tong ghi co trong ky/, end.y);
      // Số tổng ghi có được in lệch lên vài pt so với nhãn.
      if (endC) totalCredit = lastMoney(lineAt(items, endC.y, 6).filter((i) => i.x > endC.x + endC.w));
    }
    const foot = items.find((i) => i.y > top && /^tc\d{2,}$/.test(i.n));
    if (foot) bottom = Math.min(bottom, foot.y - 2);

    const inRange = items.filter((i) => i.y > top && i.y < bottom);
    const anchors = inRange
      .filter((i) => colOf(i.x) === C.postDate && isDateStr(i.s))
      .map((i) => ({ y: i.y, date: i.s, src: i, items: [] }));
    const anchorSet = new Set(anchors.map((a) => a.src));
    groupByAnchors(inRange.filter((i) => !anchorSet.has(i)), anchors, MAX_DIST);

    for (const a of anchors) {
      const cols = Array.from({ length: 6 }, () => []);
      for (const it of a.items) cols[colOf(it.x)].push(it);
      const t = cols.map(joinCell);
      const debit = Math.abs(parseMoney(t[C.debit]) ?? 0);
      const credit = Math.abs(parseMoney(t[C.credit]) ?? 0);
      if (!debit && !credit) { warnings.push(`Dòng ngày ${a.date} không đọc được số tiền nên đã bỏ qua.`); continue; }

      const desc = t[C.desc];
      // "Giao dịch thanh toán/Purchase - Số Thẻ/Card No: 1234...5678 Google One 650-2530000 US"
      const m = desc.match(/^(.*?)\s+-\s+.{0,14}Card No:?\s*([\d.…]+)\s*(.*)$/i);
      const card = m?.[2].match(/(\d{4})$/)?.[1];
      if (card) cards.add(card);
      txs.push({
        date: parseDate(t[C.txDate]) || parseDate(a.date),
        postDate: parseDate(a.date),
        description: desc,
        kind: m ? m[1] : '',
        merchant: m ? m[3] || desc : desc,
        card: card || '',
        debit, credit,
        amount: credit - debit,
      });
    }
  }

  if (!starts) throw new Error('Không tìm thấy mục "Thông tin chi tiết" trong sao kê thẻ Techcombank.');

  // Ghi rõ từng kỳ trả góp: món nào, kỳ thứ mấy, theo mục "B. Thông tin trả góp".
  const plans = installmentPlans(pages);
  for (const t of txs) {
    if (!/tra gop hang ky|installment repayment/i.test(norm(t.description))) continue;
    const p = plans.find((x) => !x.used && Math.abs(x.payment - t.debit) < 1);
    if (!p) continue;
    p.used = true;
    t.installment = { term: p.term, item: p.item, total: p.total };
    t.merchant = `Trả góp kỳ ${p.term} · ${p.item}${p.total ? ` (khoản ${fmtMoney(p.total)} đ)` : ''}`;
  }

  const checks = [];
  sumCheck(checks, 'Tổng ghi nợ trong kỳ', txs, 'debit', totalDebit);
  sumCheck(checks, 'Tổng ghi có trong kỳ', txs, 'credit', totalCredit);

  // Mục 1 (trang đầu): Dư nợ kỳ trước | Tổng ghi nợ | Tổng ghi có | Dư nợ cuối kỳ | Mức trả tối thiểu | Thời hạn thanh toán.
  // Dư nợ in số âm khi đang nợ.
  const statement = { date: statementDate, dueDate: null, balance: null, minDue: null, installments: plans.map(({ used, ...p }) => p) };
  const dueLabel = findItem(first, /^payment due date/);
  const dueItem = dueLabel && first.find((i) => i.y > dueLabel.y + 4 && i.y < dueLabel.y + 60 && /\d{2}\/\d{2}\/\d{4}/.test(i.s));
  if (dueItem) {
    statement.dueDate = parseDate(dueItem.s.match(/\d{2}\/\d{2}\/\d{4}/)[0]);
    const nums = lineAt(first, dueItem.y, 4).filter((i) => i !== dueItem).map((i) => parseMoney(i.s)).filter((v) => v != null);
    if (nums.length >= 5) {
      statement.balance = Math.max(0, -nums[3]);
      statement.minDue = Math.abs(nums[4]);
    }
  }
  // Mục 2: Tổng giá trị khoản trả góp còn hiệu lực — đối chiếu với tổng các khoản ở mục B.
  const instLabel = findItem(first, /^total outstanding installment balance/);
  if (instLabel && plans.length) {
    const below = first.filter((i) => i.y > instLabel.y + 4 && i.y < instLabel.y + 40).sort((a, b) => a.y - b.y || a.x - b.x);
    const v = lastMoney(below);
    if (v != null) {
      const sum = plans.reduce((s, p) => s + (p.outstanding || 0), 0);
      checks.push({ ok: Math.abs(sum - v) < plans.length + 1, label: 'Tổng trả góp còn lại', expected: v, actual: sum });
    }
  }

  return {
    parser: id,
    bank: 'Techcombank',
    accountType: 'credit',
    accountTypeLabel: 'Thẻ tín dụng',
    accountNo,
    cards: [...cards],
    holder,
    period: { from: null, to: statementDate },
    transactions: txs,
    statement,
    checks, warnings,
  };
}
