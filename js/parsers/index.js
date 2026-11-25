// Điểm vào: nhận File, chọn bộ đọc phù hợp, trả về kết quả chuẩn hóa.
import { norm, hash } from '../util.js';
import * as tcbCredit from './techcombank-credit.js';
import * as tcbAccount from './techcombank-account.js';

// Thêm ngân hàng mới: viết module có detect(text) + parse(pages) rồi thêm vào đây.
const PDF_PARSERS = [tcbCredit, tcbAccount];

/**
 * Kết quả: { bank, accountType: 'bank'|'credit'|'wallet'|'unknown', accountTypeLabel, accountNo, holder,
 *   period:{from,to}, transactions:[{id,date,description,merchant,counterparty,debit,credit,amount,...}],
 *   checks:[{ok,label,expected,actual}], warnings:[], inflow, outflow, fileName }
 */
export async function parseFile(file, { askPassword }) {
  const buf = await file.arrayBuffer();
  const magic = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));

  if (magic.startsWith('%PDF')) {
    const { readPdf } = await import('./pdf-text.js');
    const pages = await readPdf(buf, askPassword);
    const text = norm(pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' '));
    if (!text) throw new Error('PDF không có lớp chữ (có thể là ảnh scan). Hãy tải bản PDF gốc từ ngân hàng.');
    const parser = PDF_PARSERS.find((p) => p.detect(text));
    if (!parser) throw new Error('Chưa hỗ trợ mẫu sao kê PDF này. Hiện đọc được: Techcombank (thẻ tín dụng, tài khoản thanh toán).');
    return finalize(parser.parse(pages), file);
  }

  const ext = file.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) {
    const { parseExcel } = await import('./excel-generic.js');
    return finalize(await parseExcel(buf, file.name), file);
  }
  throw new Error('Định dạng chưa hỗ trợ. Hãy dùng PDF, Excel (.xlsx, .xls) hoặc CSV.');
}

function finalize(r, file) {
  const txs = r.transactions.filter((t) => t.date);
  const seen = new Map();
  for (const t of txs) {
    const key = [r.bank, r.accountNo, t.date, t.amount, t.ref || '', t.description || ''].join('|');
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    t.id = hash(key + '|' + n);
  }
  txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const dates = txs.map((t) => t.date).sort();
  r.period = { from: r.period?.from || dates[0] || null, to: r.period?.to || dates.at(-1) || null };
  r.inflow = txs.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  r.outflow = txs.reduce((s, t) => s + (t.amount < 0 ? -t.amount : 0), 0);
  r.transactions = txs;
  r.fileName = file.name;
  r.fileSize = file.size;
  return r;
}
