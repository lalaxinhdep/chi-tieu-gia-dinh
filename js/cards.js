// Thẻ tín dụng: số phải trả kỳ này, hạn thanh toán, các khoản trả góp đang trả và dự kiến các tháng tới.
// Lấy từ sao kê mới nhất của mỗi thẻ (thông tin "statement" do bộ đọc PDF ghi lại khi nhập file).
import * as store from './store.js';
import { addMonths, daysBetween, today } from './loans.js';
import { esc, fmtMoney, fmtDate, norm, hideNumbers } from './util.js';

const $ = (s) => document.querySelector(s);
const money = (n) => (n == null ? '—' : `${fmtMoney(n)} đ`);
const monthLabel = (iso) => { const [y, m] = iso.split('-'); return `${+m}/${y}`; };

/** Tên món của khoản trả góp VIB: tìm giao dịch mua có số tiền ≈ mỗi kỳ × số kỳ trên cùng thẻ. */
function guessItem(account, p, txs) {
  const target = p.payment * p.periods;
  const near = (t) => t.account === account && Math.abs(Math.abs(t.amount) - target) <= p.periods + 1;
  const hit = txs.filter((t) => near(t) && t.amount < 0 && !/tra gop/.test(norm(t.description)))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (hit) return { item: hideNumbers(hit.merchant || hit.description), date: hit.date };
  // Món mua nằm ở sao kê chưa nhập: ít nhất lấy ngày chuyển trả góp.
  const conv = txs.find((t) => near(t) && t.amount > 0 && /tra gop/.test(norm(t.description)));
  return conv ? { item: '', date: conv.date } : null;
}

/** Mỗi thẻ một mục, theo sao kê mới nhất. */
export function cardSummaries(txs, now = today()) {
  const latest = {};
  for (const f of store.data.files) {
    if (!f.statement?.date) continue;
    const cur = latest[f.account];
    if (!cur || f.statement.date > cur.statement.date || (f.statement.date === cur.statement.date && f.importedAt > cur.importedAt)) latest[f.account] = f;
  }
  return Object.entries(latest).map(([account, f]) => {
    const s = f.statement;
    // Khoản trả nợ thẻ ghi trên chính tài khoản thẻ sau ngày sao kê (có khi nhập sao kê kỳ sau).
    const payments = txs.filter((t) => t.account === account && t.amount > 0 && t.kind === 'cc_payment' && t.date > s.date);
    const paid = payments.reduce((a, t) => a + t.amount, 0);
    const plans = (s.installments || []).map((p) => {
      const g = p.item ? null : guessItem(account, p, txs);
      const last = p.remaining > 0 ? p.outstanding - p.payment * (p.remaining - 1) : 0; // kỳ cuối có thể lệch vài đồng
      return {
        ...p, item: p.item || g?.item || '', boughtOn: g?.date || p.convDate || null,
        lastStatement: addMonths(s.date, p.remaining), lastDue: s.dueDate ? addMonths(s.dueDate, p.remaining) : null, lastPayment: last,
      };
    });
    const daysLeft = s.dueDate ? daysBetween(now, s.dueDate) : null;
    const status = s.balance === 0 ? 'none' : paid >= (s.balance || 0) - 1 ? 'paid' : daysLeft == null ? 'unknown' : daysLeft < 0 ? 'past' : 'due';
    return { account, file: f, statement: s, paid, payments, plans, daysLeft, status };
  }).sort((a, b) => (a.statement.dueDate || '9') < (b.statement.dueDate || '9') ? -1 : 1);
}

/** Trả góp các kỳ sao kê tới: [{ month, byCard: {account: amount}, total }]. */
function forecast(cards) {
  const rows = new Map();
  for (const c of cards) {
    for (const p of c.plans) {
      for (let k = 1; k <= p.remaining; k++) {
        const month = addMonths(c.statement.date, k).slice(0, 7);
        const r = rows.get(month) || { month, byCard: {}, total: 0 };
        const amt = k === p.remaining ? p.lastPayment : p.payment;
        r.byCard[c.account] = (r.byCard[c.account] || 0) + amt;
        r.total += amt;
        rows.set(month, r);
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

const STATUS = {
  due: (c) => (c.daysLeft === 0 ? 'Hạn hôm nay' : `Còn ${c.daysLeft} ngày`),
  past: () => 'Đã qua hạn của sao kê này',
  paid: () => 'Đã trả đủ',
  none: () => 'Không có dư nợ',
  unknown: () => '',
};

export function renderCards(txs, accLabel) {
  const cards = cardSummaries(txs);
  const hasCredit = Object.values(store.data.accounts).some((a) => a.type === 'credit');
  if (!cards.length) {
    $('#cardsBody').innerHTML = hasCredit ? `<h2 class="sec-title">Thẻ tín dụng</h2><div class="card empty small">
      Sao kê thẻ đã nhập trước đây chưa có thông tin hạn thanh toán và trả góp. Vào <b>Nhập file</b> và nhập lại các file PDF sao kê thẻ (không bị nhân đôi giao dịch) để app đọc thêm.</div>` : '';
    return;
  }
  const upcoming = cards.filter((c) => c.status === 'due');
  const dueTotal = upcoming.reduce((a, c) => a + (c.statement.balance || 0) - c.paid, 0);
  const minTotal = upcoming.reduce((a, c) => a + (c.statement.minDue || 0), 0);
  const instLeft = cards.reduce((a, c) => a + c.plans.reduce((b, p) => b + (p.outstanding || 0), 0), 0);
  const fc = forecast(cards);
  const list = upcoming.map((c) => `<li><b>${fmtDate(c.statement.dueDate)}</b> · ${esc(accLabel(c.account))}: <b>${money((c.statement.balance || 0) - c.paid)}</b> <span class="muted">(tối thiểu ${money(c.statement.minDue)})</span></li>`).join('');

  const fcCards = cards.filter((c) => c.plans.length);
  const fcTable = fc.length ? `<details class="loan-sec" open><summary>Trả góp các tháng tới</summary>
      <p class="small muted">Tiền trả góp sẽ có trong mỗi kỳ sao kê tới, chưa gồm chi tiêu mới quẹt thẻ. Hạn trả thường vào đầu tháng sau tháng sao kê.</p>
      <div class="scroll-table"><table class="tx sched"><thead><tr><th>Sao kê tháng</th>${fcCards.map((c) => `<th class="amt">${esc(accLabel(c.account))}</th>`).join('')}<th class="amt">Tổng</th></tr></thead>
      <tbody>${fc.map((r) => `<tr><td class="date">${monthLabel(r.month)}</td>${fcCards.map((c) => `<td class="amt">${r.byCard[c.account] ? fmtMoney(r.byCard[c.account]) : '—'}</td>`).join('')}<td class="amt"><b>${fmtMoney(r.total)}</b></td></tr>`).join('')}</tbody></table></div>
    </details>` : '';

  $('#cardsBody').innerHTML = `<h2 class="sec-title">Thẻ tín dụng</h2>
    <dl class="kpis">
      <div class="card kpi"><dt>Phải trả sắp tới</dt><dd class="out">${fmtMoney(dueTotal)}</dd></div>
      <div class="card kpi"><dt>Tối thiểu</dt><dd>${fmtMoney(minTotal)}</dd></div>
      <div class="card kpi net"><dt>Trả góp còn lại (mọi thẻ)</dt><dd>${fmtMoney(instLeft)}</dd></div>
    </dl>
    <div class="card">
      ${list ? `<p class="small">Theo sao kê mới nhất của từng thẻ, cần trả:</p><ul class="due-list">${list}</ul>` : '<p class="small muted">Không còn khoản nào chờ trả theo các sao kê đã nhập. Nhập sao kê kỳ mới để cập nhật.</p>'}
      ${fcTable}
    </div>
    ${cards.map((c) => cardBlock(c, accLabel)).join('')}`;
}

function cardBlock(c, accLabel) {
  const s = c.statement;
  const instTotal = c.plans.reduce((a, p) => a + p.payment, 0);
  const instLeft = c.plans.reduce((a, p) => a + (p.outstanding || 0), 0);
  const rows = c.plans.map((p) => `<tr>
      <td><div class="main">${esc(hideNumbers(p.item) || `Khoản trả góp ${fmtMoney(p.total)} đ`)}</div>
        <div class="inst-left">${p.remaining
          ? `Còn ${p.remaining} kỳ · ${money(p.outstanding)} · trả đến sao kê ${monthLabel(p.lastStatement)}${p.lastDue ? ` (hạn ≈ ${fmtDate(p.lastDue)})` : ''}`
          : 'Kỳ này là kỳ cuối'}</div>
        <div class="detail">Tổng ${money(p.total)}${p.boughtOn ? ` · chuyển trả góp ${fmtDate(p.boughtOn)}` : ''}</div></td>
      <td class="amt">${p.paid}/${p.periods}</td>
      <td class="amt">${fmtMoney(p.payment)}</td>
    </tr>`).join('');
  const st = STATUS[c.status](c);
  return `<article class="card loan">
    <div class="file-head"><div><div class="file-name">${esc(accLabel(c.account))}</div><div class="detail small muted">Sao kê ngày ${fmtDate(s.date)}${s.autoDebit ? ` · ${esc(s.autoDebit)}` : ''}</div></div>
      ${st ? `<span class="tag">${esc(st)}</span>` : ''}</div>
    ${c.status === 'due' && c.daysLeft <= 7 ? `<ul class="checks"><li class="info">⏰ Hạn thanh toán ${fmtDate(s.dueDate)}: trả ${money((s.balance || 0) - c.paid)} để không bị tính lãi (tối thiểu ${money(s.minDue)}).</li></ul>` : ''}
    ${c.status === 'past' ? `<ul class="checks"><li class="info">ℹ Hạn ${fmtDate(s.dueDate)} đã qua. Nhập sao kê kỳ mới của thẻ này để xem số phải trả tiếp theo.</li></ul>` : ''}
    <dl class="stats">
      <div><dt>Phải trả (dư nợ cuối kỳ)</dt><dd class="out">${money(s.balance)}</dd></div>
      <div><dt>Tối thiểu</dt><dd>${money(s.minDue)}</dd></div>
      <div><dt>Hạn thanh toán</dt><dd>${s.dueDate ? fmtDate(s.dueDate) : '—'}</dd></div>
      ${c.paid ? `<div><dt>Đã trả sau ngày sao kê</dt><dd class="in">${money(c.paid)}</dd></div>` : ''}
      ${c.plans.length ? `<div><dt>Trả góp mỗi kỳ (${c.plans.length} khoản)</dt><dd>${money(instTotal)}</dd></div><div><dt>Trả góp còn lại</dt><dd>${money(instLeft)}</dd></div>` : ''}
    </dl>
    ${c.plans.length ? `<details class="loan-sec" open><summary>Các khoản trả góp</summary>
      <div class="scroll-table"><table class="tx sched inst"><thead><tr><th>Món</th><th class="amt">Kỳ</th><th class="amt">Mỗi kỳ</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted">"Kỳ" là kỳ đã tính trong sao kê này, ví dụ 9/12 là kỳ thứ 9 trên 12 kỳ. "Trả đến sao kê" là tháng có kỳ trả góp cuối cùng.</p>
    </details>` : ''}
  </article>`;
}

/** Thẻ ngắn ở Tổng quan. */
export function cardsOverviewCard(txs, accLabel) {
  const cards = cardSummaries(txs).filter((c) => c.status === 'due');
  if (!cards.length) return '';
  const total = cards.reduce((a, c) => a + (c.statement.balance || 0) - c.paid, 0);
  return `<div class="card">
      <div class="row-between"><h2>Thẻ tín dụng phải trả</h2><button class="btn small" type="button" data-goloans>Xem chi tiết</button></div>
      <dl class="stats"><div><dt>Tổng (${cards.length} thẻ)</dt><dd class="out">${money(total)}</dd></div></dl>
      <ul class="due-list small">${cards.map((c) => `<li><b>${fmtDate(c.statement.dueDate)}</b> · ${esc(accLabel(c.account))}: ${money((c.statement.balance || 0) - c.paid)}</li>`).join('')}</ul>
    </div>`;
}
