// Đọc sao kê dạng bảng (Excel .xlsx/.xls, CSV) của ngân hàng/ví bất kỳ:
// tự tìm dòng tiêu đề và đoán cột Ngày / Ghi nợ / Ghi có / Số tiền / Diễn giải…
import { norm, parseMoney, parseDate } from '../util.js';

const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

// Thứ tự vai trò quan trọng: cột đã nhận vai trò trước sẽ không bị vai trò sau lấy.
const ROLES = [
  ['date', [/ngay giao dich/, /ngay gd/, /transaction date/, /ngay thuc hien/, /ngay hach toan/, /posting date/, /thoi gian/, /^ngay\b/, /\bdate\b/]],
  ['debit', [/ghi no/, /\bdebit\b/, /tien ra/, /so tien chi/, /^chi$/, /rut ra/, /^no$/]],
  ['credit', [/ghi co/, /\bcredit\b/, /tien vao/, /so tien thu/, /^thu$/, /^co$/]],
  ['balance', [/so du/, /balance/]],
  ['amount', [/so tien/, /amount/, /gia tri/]],
  ['desc', [/dien giai/, /noi dung/, /mo ta/, /description/, /details?/, /chi tiet/, /ghi chu/]],
  ['party', [/doi tac/, /doi ung/, /nguoi nhan/, /ben nhan/, /nguoi gui/, /remitter/, /beneficiary/]],
  ['ref', [/so but toan/, /ma giao dich/, /so tham chieu/, /reference/, /transaction no/, /ma gd/, /so ct/, /\bref\b/]],
];

function assignRoles(row) {
  const heads = row.map((c) => norm(c));
  const used = new Set();
  const roles = {};
  for (const [role, patterns] of ROLES) {
    outer: for (const re of patterns) {
      for (let i = 0; i < heads.length; i++) {
        if (!used.has(i) && heads[i] && heads[i].length < 60 && re.test(heads[i])) {
          roles[role] = i; used.add(i); break outer;
        }
      }
    }
  }
  return roles;
}

export async function parseExcel(buf, fileName) {
  const XLSX = await import(SHEETJS);
  // CSV: tự giải mã UTF-8 (tiêu đề tiếng Việt) và giữ nguyên chữ để không bị hiểu ngày dd/mm thành mm/dd.
  const wb = /\.csv$/i.test(fileName)
    ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const warnings = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    let hdrIdx = -1, roles = null;
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const rr = assignRoles(rows[r]);
      if (rr.date != null && (rr.debit != null || rr.credit != null || rr.amount != null)) { hdrIdx = r; roles = rr; break; }
    }
    if (hdrIdx < 0) continue;

    const txs = [];
    const twoCols = roles.debit != null || roles.credit != null;
    for (let r = hdrIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const date = parseDate(row[roles.date]);
      if (!date) continue;
      let debit = 0, credit = 0, amount;
      if (twoCols) {
        debit = Math.abs(parseMoney(row[roles.debit]) ?? 0);
        credit = Math.abs(parseMoney(row[roles.credit]) ?? 0);
        amount = credit - debit;
      } else {
        amount = parseMoney(row[roles.amount]) ?? 0;
        if (amount < 0) debit = -amount; else credit = amount;
      }
      if (!amount) continue;
      const g = (k) => (roles[k] != null ? String(row[roles[k]] ?? '').trim() : '');
      txs.push({
        date,
        description: g('desc'),
        counterparty: g('party'),
        merchant: g('party') || g('desc'),
        ref: g('ref'),
        debit, credit, amount,
        balance: roles.balance != null ? parseMoney(row[roles.balance]) : null,
      });
    }
    if (!txs.length) continue;

    if (!twoCols && txs.every((t) => t.amount > 0)) {
      warnings.push('Mọi số tiền đều dương: file có thể ghi chiều tiền (vào/ra) ở cột khác. Hãy kiểm tra lại.');
    }
    const found = Object.keys(roles).join(', ');
    return {
      parser: 'excel-generic',
      bank: '',
      accountType: 'unknown',
      accountTypeLabel: `Bảng tính · trang "${sheetName}"`,
      accountNo: '',
      period: { from: null, to: null },
      transactions: txs,
      checks: [{ ok: null, label: `Đọc theo cột tự nhận diện: ${found}. Sao kê dạng bảng không có dòng tổng để đối chiếu tự động.` }],
      warnings,
    };
  }
  throw new Error(`Không tìm thấy bảng giao dịch trong "${fileName}" (cần có cột Ngày và cột Số tiền/Ghi nợ/Ghi có).`);
}
