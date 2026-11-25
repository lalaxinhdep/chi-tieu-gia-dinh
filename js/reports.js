// Tổng hợp số liệu báo cáo từ giao dịch đã phân loại.

export const monthOf = (iso) => iso.slice(0, 7);

export function monthsAvailable(txs) {
  return [...new Set(txs.map((t) => monthOf(t.date)))].sort().reverse();
}

/** month: 'YYYY-MM' hoặc '' (tất cả). */
export function summarize(txs, month) {
  const list = month ? txs.filter((t) => t.date.startsWith(month)) : txs;
  let income = 0, expense = 0, excluded = 0, excludedCount = 0, uncategorized = 0, ignoredCount = 0;
  const excludedByKind = {};
  const byCat = new Map();
  const incomeByCat = new Map();
  for (const t of list) {
    if (t.kind === 'expense') {
      expense -= t.amount; // hoàn tiền (số dương) làm giảm chi
      byCat.set(t.category, (byCat.get(t.category) || 0) - t.amount);
      if (t.category === 'Chưa phân loại') uncategorized++;
    } else if (t.kind === 'income') {
      income += t.amount;
      incomeByCat.set(t.category, (incomeByCat.get(t.category) || 0) + t.amount);
    } else {
      excluded += Math.abs(t.amount);
      excludedCount++;
      if (t.kind === 'ignore') ignoredCount++;
      const e = excludedByKind[t.kind] ||= { count: 0, total: 0 };
      e.count++; e.total += Math.abs(t.amount);
    }
  }
  const sortDesc = (m) => [...m.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  return {
    income, expense, net: income - expense, excluded, excludedCount, uncategorized, ignoredCount, excludedByKind,
    categories: sortDesc(byCat), incomeCategories: sortDesc(incomeByCat), count: list.length,
  };
}

/** Thu/chi theo tháng, tăng dần theo thời gian. */
export function byMonth(txs) {
  const m = new Map();
  for (const t of txs) {
    if (t.kind !== 'expense' && t.kind !== 'income') continue;
    const k = monthOf(t.date);
    const row = m.get(k) || { month: k, income: 0, expense: 0 };
    if (t.kind === 'expense') row.expense -= t.amount; else row.income += t.amount;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

const inMonth = (txs, month) => (month ? txs.filter((t) => t.date.startsWith(month)) : txs);
const isCountedKind = (k) => k === 'expense' || k === 'income';

/**
 * Gom theo đối tác (người nhận / người gửi / nơi bán), nhận theo khóa t.key.
 * includeAll: tính cả khoản không vào báo cáo (chuyển nội bộ, tiết kiệm…), trừ trả nợ thẻ.
 */
export function byParty(txs, month, includeAll = false) {
  const m = new Map();
  for (const t of inMonth(txs, month)) {
    if (!(includeAll ? t.kind !== 'cc_payment' : isCountedKind(t.kind))) continue;
    const k = t.key || '(không rõ)';
    const row = m.get(k) || { key: k, names: new Map(), banks: new Set(), outCount: 0, out: 0, inCount: 0, in: 0 };
    const name = (t.party || t.merchant || t.counterparty || t.description || '').trim();
    row.names.set(name, (row.names.get(name) || 0) + 1);
    if (t.counterpartyBank) row.banks.add(t.counterpartyBank.trim());
    if (t.amount < 0) { row.outCount++; row.out -= t.amount; } else { row.inCount++; row.in += t.amount; }
    m.set(k, row);
  }
  return [...m.values()].map((r) => ({
    key: r.key,
    name: [...r.names.entries()].sort((a, b) => b[1] - a[1])[0][0] || r.key,
    bank: [...r.banks].filter(Boolean).join(', '),
    outCount: r.outCount, out: r.out, inCount: r.inCount, in: r.in,
  })).sort((a, b) => (b.out + b.in) - (a.out + a.in));
}

/** Thu/chi (có tính) theo từng tài khoản của mình. */
export function byAccount(txs, month) {
  const m = new Map();
  for (const t of inMonth(txs, month)) {
    if (!isCountedKind(t.kind)) continue;
    const row = m.get(t.account) || { account: t.account, outCount: 0, out: 0, inCount: 0, in: 0 };
    if (t.kind === 'expense') { if (t.amount < 0) row.outCount++; row.out -= t.amount; } else { row.inCount++; row.in += t.amount; }
    m.set(t.account, row);
  }
  return [...m.values()].sort((a, b) => b.out - a.out);
}

/**
 * Số dư tiết kiệm từ số dư đầu kỳ người dùng nhập (tính từ đầu ngày asOf) cộng các khoản gửi, trừ các khoản rút.
 * Giao dịch tiết kiệm ghi trên tài khoản thanh toán: tiền ra (âm) = gửi vào sổ, tiền vào (dương) = rút ra.
 */
export function savingsReport(txs, savings, month) {
  if (savings?.opening == null || !savings.asOf) return null;
  const flows = txs.filter((t) => t.kind === 'savings').map((t) => ({ date: t.date, v: -t.amount }));
  // Số dư cuối ngày d.
  const balanceAt = (d) => {
    let b = savings.opening;
    for (const f of flows) {
      if (d >= savings.asOf) { if (f.date >= savings.asOf && f.date <= d) b += f.v; }
      else if (f.date > d && f.date < savings.asOf) b -= f.v;
    }
    return b;
  };
  let from, to;
  if (month) {
    const [y, mo] = month.split('-').map(Number);
    from = `${month}-01`;
    to = `${month}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
  } else {
    from = savings.asOf;
    to = flows.reduce((mx, f) => (f.date > mx ? f.date : mx), savings.asOf);
  }
  const prev = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const start = month ? balanceAt(prev(from)) : savings.opening;
  let deposit = 0, withdraw = 0, count = 0;
  for (const f of flows) {
    if (f.date < from || f.date > to) continue;
    count++;
    if (f.v > 0) deposit += f.v; else withdraw -= f.v;
  }
  return { from, to, start, deposit, withdraw, end: start + deposit - withdraw, count };
}
