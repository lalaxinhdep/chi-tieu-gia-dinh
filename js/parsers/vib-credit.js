// VIB — "Sao kê giao dịch thẻ tín dụng VIB / Credit Card Monthly Statement" (PDF hằng tháng).
// Bảng: Ngày giao dịch | Ngày hạch toán | Diễn giải | MCC | Ghi nợ/Debit | Ghi có/Credit (ghi có in số âm).
// Bản khổ dọc bị cắt đôi theo chiều ngang: cột Ghi nợ/Ghi có nằm ở trang kế tiếp, cùng tọa độ y.
import { parseMoney, parseDate, isDateStr, sumCheck, fmtMoney } from '../util.js';
import { lineAt, findItem, valueRightOf, groupByAnchors } from './pdf-layout.js';

export const id = 'vib-credit';

export function detect(text) {
  return text.includes('sao ke giao dich the tin dung vib') || (text.includes('credit card monthly statement') && /\bvib\b/.test(text));
}

const MAX_DIST = 8;

/** Ghép các trang thành một mặt phẳng: trang "nửa phải" (không có ngày) đặt bên phải trang trước. */
function mergePages(pages) {
  const out = [];
  let yOff = 0, prev = null, prevWasRight = false;
  for (const p of pages) {
    const portrait = prev && prev.width < prev.height;
    const isRight = portrait && !prevWasRight && !p.items.some((i) => isDateStr(i.s));
    const dx = isRight ? prev.width : 0;
    const dy = isRight ? yOff - prev.height : yOff;
    for (const i of p.items) out.push({ ...i, x: i.x + dx, y: i.y + dy, cx: (i.cx ?? i.x + i.w / 2) + dx });
    if (!isRight) yOff += p.height;
    prevWasRight = isRight;
    prev = p;
  }
  return out;
}

export function parse(pages) {
  const first = pages[0].items;
  const items = mergePages(pages);

  const accountNo = valueRightOf(first, /^so tai khoan the/).replace(/\D/g, '');
  const statementDate = parseDate(valueRightOf(first, /^ngay sao ke/));
  const primary = valueRightOf(first, /^so the chinh/);
  // Tên sản phẩm thẻ và chủ thẻ: hai dòng giữa tiêu đề "Credit Card Monthly Statement" và "Số thẻ chính".
  const title = findItem(first, /^credit card monthly statement/);
  const primaryLabel = findItem(first, /^so the chinh/);
  const heads = first.filter((i) => title && primaryLabel && i.y > title.y + 2 && i.y < primaryLabel.y - 2).sort((a, b) => a.y - b.y);
  const product = heads[0]?.s.trim() || '';
  const holder = heads[1]?.s.trim() || '';

  // Tổng ở phần tóm tắt (trang đầu).
  const totalDebit = parseMoney(valueRightOf(first, /^phat sinh no trong ky/));
  const totalCredit = parseMoney(valueRightOf(first, /^phat sinh co trong ky/));

  // Vùng bảng: từ dòng tiêu đề đến dòng tổng cuối bảng.
  const hdr = findItem(items, /^ngay giao dich$/);
  if (!hdr) throw new Error('Không tìm thấy bảng giao dịch trong sao kê thẻ VIB.');
  const end = findItem(items, /^phat sinh no trong ky/, hdr.y);
  const bottom = end ? end.y - 2 : Infinity;
  const hdrLine = lineAt(items, hdr.y, 3);
  const center = (re) => { const h = items.find((i) => Math.abs(i.y - hdr.y) < 14 && re.test(i.n)); return h ? h.x + h.w / 2 : null; };
  const cTx = center(/^ngay giao dich$/), cPost = center(/^ngay hach toan$/);
  const cDebit = center(/^ghi no/), cCredit = center(/^ghi co/);
  if ([cTx, cPost, cDebit, cCredit].some((v) => v == null)) throw new Error('Không nhận ra tiêu đề bảng của sao kê thẻ VIB.');
  const splitDate = (cTx + cPost) / 2;
  const splitMoney = (cDebit + cCredit) / 2;
  const top = Math.max(hdr.y, ...hdrLine.map((i) => i.y)) + 12; // bỏ dòng tiêu đề tiếng Anh ngay dưới

  const inRange = items.filter((i) => i.y > top && i.y < bottom);

  // Mỗi nhóm "Số thẻ/ Số tài khoản" mở đầu các giao dịch của một thẻ.
  const sections = inRange.filter((i) => /^so the\/ ?so tai khoan/.test(i.n)).map((l) => {
    const val = inRange.find((i) => i.y > l.y - 1 && i.y < l.y + 8 && i.x > l.x + l.w && /[\d*x]{8,}/i.test(i.s));
    return { y: l.y, card: val?.s.includes('*') ? val.s.replace(/\D/g, '').slice(-4) : '', items: [val, ...inRange.filter((i) => i.y >= l.y - 1 && i.y <= l.y + 12 && /card number|so the\//i.test(i.n))].filter(Boolean) };
  });
  const sectionItems = new Set(sections.flatMap((s) => s.items));

  const anchors = inRange
    .filter((i) => isDateStr(i.s) && i.cx < splitDate)
    .map((i) => ({ y: i.y, date: i.s, src: i, items: [] }));
  const anchorSet = new Set(anchors.map((a) => a.src));
  groupByAnchors(
    inRange.filter((i) => !anchorSet.has(i) && !sectionItems.has(i)),
    anchors.concat(sections.map((s) => ({ y: s.y + 4, marker: true }))),
    MAX_DIST,
  );

  const txs = [];
  const warnings = [];
  const cards = new Set();
  if (primary.includes('*')) cards.add(primary.replace(/\D/g, '').slice(-4));
  for (const a of anchors) {
    let postDate = null, debit = 0, credit = 0, mcc = '';
    const desc = [];
    for (const it of a.items.sort((x, y) => x.y - y.y || x.x - y.x)) {
      const money = parseMoney(it.s);
      if (isDateStr(it.s) && !postDate) postDate = it.s;
      else if (money != null && /\d[.,]\d{2}$/.test(it.s.trim())) {
        if (it.cx >= splitMoney) credit += Math.abs(money); else debit += Math.abs(money);
      } else if (/^\d{4}-/.test(it.s.trim())) mcc = it.s.trim();
      else desc.push(it.s.trim());
    }
    if (!debit && !credit) { warnings.push(`Dòng ngày ${a.date} không đọc được số tiền nên đã bỏ qua.`); continue; }
    const description = desc.join(' ').replace(/\s+/g, ' ').trim();
    const sec = sections.filter((s) => s.y < a.y).at(-1);
    if (sec?.card) cards.add(sec.card);
    const buy = description.match(/^Mua Hàng\s*\/\s*(.+)$/i);
    const inst = description.match(/TRA GOP KY HAN (\d+)\/(\d+)/i);
    const pay = /thanh toan sao ke the/i.test(description);
    // Kỳ trả góp mang ngày giao dịch gốc (ngày chuyển đổi); dùng ngày hạch toán để tính đúng tháng phải trả.
    const date = inst ? parseDate(postDate) || parseDate(a.date) : parseDate(a.date);
    txs.push({
      date,
      postDate: parseDate(postDate),
      description,
      merchant: buy ? buy[1].trim()
        : inst ? `Trả góp kỳ ${inst[1]}/${inst[2]} (khoản ${fmtMoney(debit * +inst[2])} đ)`
        : pay ? `Thanh toán thẻ VIB ${product.replace(/^VIB\s+/i, '')}`.trim()
        : description,
      mcc,
      card: sec?.card || '',
      ...(inst && { installment: { term: `${inst[1]}/${inst[2]}` } }),
      debit, credit,
      amount: credit - debit,
    });
  }

  const checks = [];
  sumCheck(checks, 'Phát sinh nợ trong kỳ', txs, 'debit', totalDebit);
  sumCheck(checks, 'Phát sinh có trong kỳ', txs, 'credit', totalCredit);

  return {
    parser: id,
    bank: 'VIB',
    accountType: 'credit',
    accountTypeLabel: product ? `Thẻ tín dụng ${product.replace(/^VIB\s+/i, '')}` : 'Thẻ tín dụng',
    accountNo,
    cards: [...cards],
    holder,
    period: { from: null, to: statementDate },
    transactions: txs,
    checks, warnings,
  };
}
