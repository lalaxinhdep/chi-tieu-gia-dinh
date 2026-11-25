// Tổng hợp số liệu báo cáo từ giao dịch đã phân loại.

export const monthOf = (iso) => iso.slice(0, 7);

export function monthsAvailable(txs) {
  return [...new Set(txs.map((t) => monthOf(t.date)))].sort().reverse();
}

/** month: 'YYYY-MM' hoặc '' (tất cả). */
export function summarize(txs, month) {
  const list = month ? txs.filter((t) => t.date.startsWith(month)) : txs;
  let income = 0, expense = 0, excluded = 0, excludedCount = 0, uncategorized = 0;
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
    }
  }
  const sortDesc = (m) => [...m.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
  return {
    income, expense, net: income - expense, excluded, excludedCount, uncategorized,
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
