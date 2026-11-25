// Techcombank — "Sổ phụ kiêm phiếu báo nợ/có" (tài khoản thanh toán), bản PDF tải từ ngân hàng điện tử.
// Bảng: Ngày GD | Đối tác | NH đối tác | Diễn giải | Số bút toán | Nợ TKTT | Có TKTT | Số dư
import { parseMoney, parseDate, isDateStr, sumCheck } from '../util.js';
import { lineAt, findItem, joinCell, lastMoney, valueRightOf, groupByAnchors } from './pdf-layout.js';

export const id = 'tcb-account';

export function detect(text) {
  return text.includes('so phu kiem phieu bao no') && text.includes('techcombank');
}

const COLS = [
  /^ngay giao dich/, /^doi tac/, /^nh doi tac/, /^dien giai/,
  /^so but toan/, /^no tktt/, /^co tktt/, /^so du(?! dau| cuoi)/,
];
const C = { date: 0, party: 1, bank: 2, desc: 3, ref: 4, debit: 5, credit: 6, balance: 7 };
const MAX_DIST = 24; // pt: nửa chiều cao dòng cao nhất

export function parse(pages) {
  const first = pages[0].items;
  const accountNo = valueRightOf(first, /^so tai khoan\/ ?account no/).replace(/\D/g, '');
  const holder = valueRightOf(first, /^ten khach hang/);
  const periodText = lineAt(first, findItem(first, /^tu ngay/)?.y ?? -999, 3).map((i) => i.s).join(' ');
  const periodDates = (periodText.match(/\d{2}\/\d{2}\/\d{4}/g) || []).map(parseDate);

  const txs = [];
  const warnings = [];
  let bounds = null;
  let opening = null, ending = null, totalDebit = null, totalCredit = null;
  const colOf = (x) => { let i = 0; while (i < bounds.length && x + 3 > bounds[i]) i++; return i; };

  for (const page of pages) {
    const items = page.items;
    let top = -Infinity;
    let bottom = Infinity;
    const markers = [];

    const footer = findItem(items, /^phieu nay duoc in/);
    if (footer) bottom = footer.y - 2;

    const hdr = findItem(items, /^no tktt/);
    if (hdr) {
      const line = lineAt(items, hdr.y, 4);
      const centers = COLS.map((re) => line.find((i) => re.test(i.n))?.cx);
      if (centers.some((c) => c == null)) throw new Error('Không nhận ra tiêu đề bảng giao dịch của sổ phụ Techcombank.');
      bounds = centers.slice(1).map((c, i) => (centers[i] + c) / 2);
      const eng = findItem(items, /^transaction date/);
      top = Math.max(hdr.y, eng?.y ?? -Infinity) + 2;
    }
    if (!bounds) continue;

    const ob = findItem(items, /^so du dau ky/);
    if (ob) { markers.push(ob.y); opening = lastMoney(lineAt(items, ob.y)); }

    let done = false;
    const tot = findItem(items, /^cong doanh so/);
    if (tot) {
      const nums = lineAt(items, tot.y).filter((i) => parseMoney(i.s) != null);
      for (const it of nums) {
        const c = colOf(it.x);
        if (c === C.debit) totalDebit = parseMoney(it.s);
        else if (c === C.credit) totalCredit = parseMoney(it.s);
      }
      const end = findItem(items, /^so du cuoi ky/);
      if (end) ending = lastMoney(lineAt(items, end.y));
      markers.push(tot.y);
      bottom = Math.min(bottom, tot.y + 2);
      done = true;
    }

    const inRange = items.filter((i) => i.y > top && i.y < bottom);
    const anchors = inRange
      .filter((i) => colOf(i.x) === C.date && isDateStr(i.s))
      .map((i) => ({ y: i.y, date: i.s, src: i, items: [] }));
    const anchorSet = new Set(anchors.map((a) => a.src));
    groupByAnchors(inRange.filter((i) => !anchorSet.has(i)), anchors.concat(markers.map((y) => ({ y, marker: true }))), MAX_DIST);

    for (const a of anchors) {
      const cols = Array.from({ length: 8 }, () => []);
      for (const it of a.items) cols[colOf(it.x)].push(it);
      const t = cols.map(joinCell);
      const debit = Math.abs(parseMoney(t[C.debit]) ?? 0);
      const credit = Math.abs(parseMoney(t[C.credit]) ?? 0);
      if (!debit && !credit) { warnings.push(`Dòng ngày ${a.date} không đọc được số tiền nên đã bỏ qua.`); continue; }
      // Tên nơi nhận tiền: quẹt thẻ "… TAI <nơi bán> APPCODE …"; thanh toán QR qua trung gian "MSxxx,<TÊN>,…"
      let merchant = t[C.desc].match(/\bTAI\s+(.+?)\s+APPCODE/i)?.[1];
      if (!merchant && /TRUNG GIAN/i.test(t[C.party])) merchant = t[C.desc].split(',')[1]?.trim();
      if (!merchant && /QUA MOCA/i.test(t[C.desc])) merchant = 'Moca (Grab)';
      txs.push({
        date: parseDate(a.date),
        description: t[C.desc],
        counterparty: t[C.party],
        counterpartyBank: t[C.bank],
        merchant: merchant || t[C.party] || t[C.desc],
        ref: t[C.ref],
        debit, credit,
        amount: credit - debit,
        balance: parseMoney(t[C.balance]),
      });
    }
    if (done) break;
  }

  if (!bounds) throw new Error('Không tìm thấy bảng giao dịch trong sổ phụ Techcombank.');

  const checks = [];
  sumCheck(checks, 'Tổng tiền ra (Nợ TKTT)', txs, 'debit', totalDebit);
  sumCheck(checks, 'Tổng tiền vào (Có TKTT)', txs, 'credit', totalCredit);

  return {
    parser: id,
    bank: 'Techcombank',
    accountType: 'bank',
    accountTypeLabel: 'Tài khoản thanh toán',
    accountNo,
    holder,
    period: { from: periodDates[0] || null, to: periodDates[1] || null },
    opening, ending,
    transactions: txs,
    checks, warnings,
  };
}
