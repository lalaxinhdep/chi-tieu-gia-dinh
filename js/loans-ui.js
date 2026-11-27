// Giao diện mục Khoản vay: danh sách, form thông tin, lịch trả dự kiến, thử trả trước, lịch sử trả nợ.
import * as store from './store.js';
import { LOAN_FIELDS, METHODS, emptyLoan, derived, schedule, prepay, matchTxs, parseField, loanTitle, today, daysBetween, addMonths } from './loans.js';
import { esc, fmtMoney, fmtDate, hideNumbers } from './util.js';

const $ = (s) => document.querySelector(s);
let ctx = null; // { getTxs, toast, confirmBox, refresh }

export function initLoans(c) { ctx = c; }

const money = (n) => (n == null ? '—' : `${fmtMoney(n)} đ`);
const pct = (n) => (n == null ? '—' : `${String(n).replace('.', ',')}%`);
const digits = (s) => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();

/** Số phải trả kỳ tới: số bạn nhập, không có thì ước tính. */
function nextDue(l, sch) {
  if (l.monthlyPayment != null) return { amount: l.monthlyPayment, est: false };
  return sch?.rows[0] ? { amount: sch.rows[0].total, est: true } : null;
}

// ---------- Nhắc nhở (dùng cả ở Tổng quan) ----------
export function loanAlerts(l, now = today()) {
  const d = derived(l, now);
  const sch = schedule(l);
  const due = nextDue(l, sch);
  const out = [];
  if (d.next) {
    const n = daysBetween(now, d.next);
    if (n <= 7) out.push({ level: 'warn', text: `${n === 0 ? 'Hôm nay' : `Còn ${n} ngày`} đến kỳ trả ${fmtDate(d.next)}${due ? `: ${due.est ? 'khoảng ' : ''}${money(due.amount)}` : ''}.` });
  }
  if (d.floatStart && !d.floating) {
    const n = daysBetween(now, d.floatStart);
    if (n <= 90) {
      const row = sch?.rows.find((r) => r.date >= d.floatStart);
      out.push({ level: 'warn', text: `Còn ${n} ngày hết lãi suất cố định (${fmtDate(d.floatStart)}).${row ? ` Ước tính kỳ đầu thả nổi: ${money(row.total)} với lãi ${pct(row.rate)}.` : ''}${d.floatRateMissing ? ' Chưa có lãi suất thả nổi nên đang tạm tính bằng lãi suất hiện tại. Hãy điền khi ngân hàng báo.' : ''}` });
    }
  }
  if (d.floating && d.floatRateMissing) out.push({ level: 'warn', text: 'Đã sang giai đoạn thả nổi nhưng chưa nhập lãi suất thả nổi hiện tại.' });
  if (!sch) out.push({ level: 'info', text: 'Cần dư nợ, lãi suất, ngày đáo hạn (hoặc kỳ hạn) và ngày thanh toán để ước tính lịch trả nợ.' });
  if (l.outstandingAsOf && daysBetween(l.outstandingAsOf, now) > 62) {
    out.push({ level: 'info', text: `Dư nợ cập nhật lần cuối ${fmtDate(l.outstandingAsOf)}. Chụp màn hình khoản vay trong app ngân hàng rồi bấm "Cập nhật từ ảnh" để cập nhật.` });
  }
  return out;
}

/** Thẻ ngắn ở Tổng quan. */
export function loansOverviewCard() {
  const loans = store.data.loans;
  if (!loans.length) return '';
  const alerts = loans.flatMap((l) => loanAlerts(l).filter((a) => a.level === 'warn').map((a) => `<li><b>${esc(loanTitle(l))}:</b> ${esc(a.text)}</li>`));
  let total = 0, monthly = 0;
  for (const l of loans) {
    total += derived(l).balance || 0;
    monthly += nextDue(l, schedule(l))?.amount || 0;
  }
  return `<div class="card">
      <div class="row-between"><h2>Khoản vay</h2><button class="btn small" type="button" data-goloans>Xem chi tiết</button></div>
      <dl class="stats"><div><dt>Tổng dư nợ (${loans.length} khoản)</dt><dd>${money(total)}</dd></div><div><dt>Phải trả kỳ tới</dt><dd class="out">${money(monthly)}</dd></div></dl>
      ${alerts.length ? `<ul class="loan-alerts">${alerts.join('')}</ul>` : ''}
    </div>`;
}

// ---------- Mục Khoản vay ----------
export function renderLoans() {
  const loans = store.data.loans;
  let total = 0, monthly = 0, interest = 0;
  for (const l of loans) {
    const s = schedule(l);
    total += derived(l).balance || 0;
    monthly += nextDue(l, s)?.amount || 0;
    interest += s?.totalInterest || 0;
  }
  const head = `<div class="row-between wrap"><h2>Khoản vay</h2>
      <div class="actions"><label class="btn small">📷 Nhập từ ảnh<input type="file" accept="image/*" data-loanimg hidden></label>
      <button class="btn small primary" type="button" data-loanadd>+ Thêm khoản vay</button></div></div>`;
  if (!loans.length) {
    $('#loansBody').innerHTML = `${head}<div class="card empty">
      <p>Chưa có khoản vay nào.</p>
      <p class="small">Cách nhanh nhất: mở app ngân hàng, vào màn hình thông tin khoản vay, chụp màn hình rồi bấm <b>📷 Nhập từ ảnh</b>. App đọc chữ ngay trên máy, điền sẵn vào form để bạn kiểm tra. Hoặc bấm <b>+ Thêm khoản vay</b> để tự điền.</p></div>`;
    return;
  }
  $('#loansBody').innerHTML = `${head}
    <dl class="kpis">
      <div class="card kpi"><dt>Tổng dư nợ</dt><dd>${fmtMoney(total)}</dd></div>
      <div class="card kpi"><dt>Phải trả kỳ tới</dt><dd class="out">${fmtMoney(monthly)}</dd></div>
      <div class="card kpi net"><dt>Lãi còn phải trả (ước tính)</dt><dd>${fmtMoney(interest)}</dd></div>
    </dl>
    ${loans.map(loanCard).join('')}`;
}

function loanCard(l) {
  const d = derived(l);
  const sch = schedule(l);
  const due = nextDue(l, sch);
  const alerts = loanAlerts(l);
  const paidPct = l.disbursed && d.paidPrincipal != null ? Math.min(100, Math.max(0, (d.paidPrincipal / l.disbursed) * 100)) : null;
  const rateLabel = d.currentRate == null ? '—'
    : `${pct(d.currentRate)} ${d.floating ? 'thả nổi' : d.floatStart ? `cố định đến ${fmtDate(d.floatStart)}` : ''}`;
  const sub = [l.bank, l.product].filter(Boolean).join(' · ');
  const remain = sch ? sch.rows.length : d.dates.length || null;
  return `<article class="card loan" data-loan="${esc(l.id)}">
    <div class="file-head"><div><div class="file-name">${esc(loanTitle(l))}</div>${sub && sub !== loanTitle(l) ? `<div class="detail small muted">${esc(sub)}</div>` : ''}</div>
      <span class="tag">${d.floating ? 'Thả nổi' : 'Cố định'}</span></div>
    ${alerts.length ? `<ul class="checks">${alerts.map((a) => `<li class="info">${a.level === 'warn' ? '⏰' : 'ℹ'} ${esc(a.text)}</li>`).join('')}</ul>` : ''}
    ${paidPct != null ? `<div class="progress" role="img" aria-label="Đã trả ${Math.round(paidPct)}% gốc"><span style="width:${paidPct}%"></span></div>
      <p class="small muted">Đã trả ${money(d.paidPrincipal)} gốc trên ${money(l.disbursed)} đã giải ngân (${paidPct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%).</p>` : ''}
    <dl class="stats">
      <div><dt>Dư nợ${l.outstandingAsOf ? ` (${fmtDate(l.outstandingAsOf)})` : ''}</dt><dd>${money(d.balance)}</dd></div>
      <div><dt>Đã trả gốc</dt><dd>${money(d.paidPrincipal)}${l.paidPrincipal == null && d.paidPrincipal != null ? ' <small class="muted">(tính)</small>' : ''}</dd></div>
      ${l.paidInterest != null ? `<div><dt>Đã trả lãi</dt><dd>${money(l.paidInterest)}</dd></div>` : ''}
      <div><dt>Lãi suất đang áp dụng</dt><dd>${esc(rateLabel)}</dd></div>
      <div><dt>Kỳ tới${d.next ? ` (${fmtDate(d.next)})` : ''}</dt><dd class="out">${due ? `${due.est ? '≈ ' : ''}${money(due.amount)}` : '—'}</dd></div>
      <div><dt>Còn lại</dt><dd>${remain ? `${remain} kỳ` : '—'}${d.maturity ? ` <small class="muted">đến ${fmtDate(d.maturity)}</small>` : ''}</dd></div>
      ${l.accruedInterest != null ? `<div><dt>Lãi cộng dồn</dt><dd>${money(l.accruedInterest)}</dd></div>` : ''}
      ${l.limit != null ? `<div><dt>Hạn mức</dt><dd>${money(l.limit)}</dd></div>` : ''}
    </dl>
    ${sch ? scheduleBlock(l, d, sch, due) : ''}
    ${sch ? `<details class="loan-sec"><summary>Thử trả trước một khoản</summary>
      <form class="prepay-form" data-prepay>
        <label class="field">Số tiền trả trước (đ)<input name="extra" inputmode="numeric" autocomplete="off" placeholder="Ví dụ 100.000.000"></label>
        <label class="field">Sau khi trả trước<select name="keep"><option value="term">Giữ kỳ hạn, giảm tiền trả hằng tháng</option><option value="payment">Giữ mức trả, trả xong sớm hơn</option></select></label>
        <div class="actions"><button class="btn small primary" type="submit">Tính</button></div>
        <div class="prepay-out small" aria-live="polite"></div>
      </form></details>` : ''}
    ${paymentsBlock(l)}
    ${otherInfo(l, d)}
    <div class="actions">
      <button class="btn small" type="button" data-loandel>Xóa</button>
      <label class="btn small">📷 Cập nhật từ ảnh<input type="file" accept="image/*" data-loanimg hidden></label>
      <button class="btn small primary" type="button" data-loanedit>Sửa thông tin</button>
    </div>
  </article>`;
}

function scheduleBlock(l, d, sch, due) {
  const est = due && !due.est && sch.rows[0] && Math.abs(due.amount - sch.rows[0].total) > Math.max(1000, due.amount * 0.03)
    ? `<p class="small muted">App ước tính kỳ tới ${money(sch.rows[0].total)}, khác số bạn nhập ${money(due.amount)}. Chênh lệch thường do ngân hàng tính lãi theo số ngày thực tế, hoặc thông tin dư nợ / lãi suất chưa cập nhật.</p>` : '';
  const body = sch.rows.map((r, i) => {
    const change = i > 0 && Math.abs(r.rate - sch.rows[i - 1].rate) > 1e-9;
    return `<tr class="${change ? 'rate-change' : ''}"><td class="date">${fmtDate(r.date)}${change ? ` <span class="chip unc">lãi ${pct(r.rate)}</span>` : ''}</td>
      <td class="amt">${fmtMoney(r.principal)}</td><td class="amt">${fmtMoney(r.interest)}</td><td class="amt">${fmtMoney(r.total)}</td><td class="amt detail">${fmtMoney(r.balance)}</td></tr>`;
  }).join('');
  return `<details class="loan-sec"><summary>Lịch trả nợ dự kiến (${sch.rows.length} kỳ)</summary>
      <dl class="stats">
        <div><dt>Tổng lãi còn phải trả</dt><dd>${money(sch.totalInterest)}</dd></div>
        <div><dt>Tổng gốc + lãi còn phải trả</dt><dd>${money(sch.totalPaid)}</dd></div>
        <div><dt>Trả xong</dt><dd>${fmtDate(sch.end)}</dd></div>
      </dl>
      <p class="small muted">Ước tính theo cách trả "${esc(METHODS[l.method] || METHODS.principal)}", lãi mỗi kỳ = dư nợ × lãi năm ÷ 12${d.floatStart ? `, từ ${fmtDate(d.floatStart)} dùng lãi thả nổi ${d.floatRateMissing ? '(chưa nhập, tạm dùng lãi hiện tại)' : pct(l.floatRate)}` : ''}. Số thật của ngân hàng có thể lệch vài phần trăm.</p>
      ${est}
      <div class="scroll-table"><table class="tx sched"><thead><tr><th>Kỳ</th><th class="amt">Gốc</th><th class="amt">Lãi</th><th class="amt">Tổng trả</th><th class="amt">Dư nợ còn</th></tr></thead><tbody>${body}</tbody></table></div>
    </details>`;
}

function paymentsBlock(l) {
  const pays = l.payments || [];
  const cands = matchTxs(l, ctx.getTxs()).slice(0, 8);
  const payRows = pays.map((p) => `<div class="list-row"><div><div>${fmtDate(p.date)} · <b>${money(p.amount)}</b></div>
      <div class="detail">${[p.principal ? `gốc ${fmtMoney(p.principal)}` : '', p.interest ? `lãi ${fmtMoney(p.interest)}` : '', p.note, p.txId ? 'từ sao kê' : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      <button class="btn small" type="button" data-paydel="${esc(p.id)}">Xóa</button></div>`).join('');
  const candRows = cands.map((t) => `<div class="list-row"><div><div>${fmtDate(t.date)} · <b class="out">${fmtMoney(-t.amount)} đ</b></div>
      <div class="detail">${esc(hideNumbers(t.description))}</div></div>
      <button class="btn small" type="button" data-paytx="${esc(t.id)}">Ghi nhận</button></div>`).join('');
  const sum = pays.reduce((s, p) => s + (p.amount || 0), 0);
  return `<details class="loan-sec"><summary>Lịch sử trả nợ (${pays.length} lần${pays.length ? `, ${fmtMoney(sum)} đ` : ''})${cands.length ? ` · ${cands.length} giao dịch chờ ghi nhận` : ''}</summary>
      ${payRows || '<p class="empty">Chưa ghi nhận lần trả nào.</p>'}
      ${cands.length ? `<h4 class="small">Giao dịch trong sao kê có vẻ là trả khoản vay này</h4>${candRows}` : ''}
      <div class="actions left"><button class="btn small" type="button" data-payadd>+ Ghi nhận khoản trả</button></div>
    </details>`;
}

function otherInfo(l, d) {
  const shown = new Set(['name', 'bank', 'product', 'accountNo', 'outstanding', 'outstandingAsOf', 'paidPrincipal', 'paidInterest', 'accruedInterest', 'limit', 'monthlyPayment', 'nextPayment', 'note']);
  const items = LOAN_FIELDS.filter((f) => f.k && !shown.has(f.k)).map((f) => {
    let v = l[f.k];
    if (f.k === 'termMonths' && v == null && d.term) v = d.term;
    if (f.k === 'floatStart' && !v && d.floatStart) v = d.floatStart;
    if (v == null || v === '') return '';
    const txt = f.type === 'money' ? money(v) : f.type === 'pct' ? pct(v) : f.type === 'date' ? fmtDate(v) : f.type === 'select' ? f.options[v] : String(v);
    return `<div><dt>${esc(f.label)}</dt><dd>${esc(txt)}</dd></div>`;
  }).join('');
  return `<details class="loan-sec"><summary>Thông tin khác</summary><dl class="stats">${items}</dl>${l.note ? `<p class="small">📝 ${esc(l.note)}</p>` : ''}</details>`;
}

// ---------- Form thông tin khoản vay ----------
/** Mở form. fromImage: các trường đọc được từ ảnh (tô màu để kiểm tra). */
export function openLoanForm(loan, fromImage = null) {
  const l = { ...emptyLoan(), ...loan };
  const dlg = $('#loanDialog');
  const filled = new Set(Object.keys(fromImage || {}));
  if (fromImage) Object.assign(l, fromImage);
  const d = derived(l);
  $('#loanTitle').textContent = loan.id ? `Sửa: ${loanTitle(loan)}` : 'Thêm khoản vay';
  $('#loanNote').innerHTML = fromImage
    ? `Đã điền <b>${filled.size}</b> mục đọc từ ảnh (ô viền màu). Ảnh không gửi đi đâu. Hãy kiểm tra lại các con số trước khi lưu.`
    : 'Không có thông tin nào bắt buộc. Mục nào chưa biết thì để trống, cập nhật lúc nào cũng được.';
  $('#loanFields').innerHTML = LOAN_FIELDS.map((f) => {
    if (f.group) return `<h4>${esc(f.group)}</h4>`;
    const v = l[f.k];
    const cls = filled.has(f.k) ? ' class="ocr"' : '';
    let ph = f.ph || '';
    if (f.k === 'termMonths' && d.term) ph = String(d.term);
    if (f.k === 'floatStart' && d.floatStart && !l.floatStart) ph = fmtDate(d.floatStart);
    if (f.k === 'paidPrincipal' && d.paidPrincipal != null && l.paidPrincipal == null) ph = fmtMoney(d.paidPrincipal);
    let input;
    if (f.type === 'select') input = `<select name="${f.k}"${cls}>${Object.entries(f.options).map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.k}" rows="2"${cls}>${esc(v || '')}</textarea>`;
    else {
      const val = v == null || v === '' ? '' : f.type === 'money' ? fmtMoney(v) : f.type === 'pct' ? String(v).replace('.', ',') : String(v);
      const type = f.type === 'date' ? 'date' : 'text';
      const mode = f.type === 'money' || f.type === 'int' ? ' inputmode="numeric"' : f.type === 'pct' ? ' inputmode="decimal"' : '';
      input = `<input name="${f.k}" type="${type}"${mode} autocomplete="off" value="${esc(val)}" placeholder="${esc(ph)}"${cls}>`;
    }
    return `<label class="field${f.type === 'textarea' ? ' full' : ''}">${esc(f.label)}${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  }).join('');
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const form = dlg.querySelector('form');
    const out = { ...l };
    for (const f of LOAN_FIELDS) if (f.k) out[f.k] = parseField(f, form.elements[f.k].value);
    if (out.outstanding != null && out.outstanding !== loan.outstanding && !form.elements.outstandingAsOf.value) out.outstandingAsOf = today();
    await store.saveLoan(out);
    ctx.toast(loan.id ? 'Đã lưu khoản vay.' : 'Đã thêm khoản vay.');
    ctx.refresh();
  }, { once: true });
  dlg.showModal();
  dlg.scrollTop = 0;
}

/** Kết quả đọc ảnh khoản vay: cập nhật khoản đã có (cùng số tài khoản / hợp đồng) hoặc thêm mới. */
export function loanFromImage(fields, targetId = null) {
  const loans = store.data.loans;
  const match = (targetId && loans.find((l) => l.id === targetId))
    || loans.find((l) => (fields.accountNo && digits(l.accountNo) === digits(fields.accountNo)) || (fields.contract && digits(l.contract) === digits(fields.contract)));
  if (fields.outstanding != null && !fields.outstandingAsOf) fields.outstandingAsOf = today();
  openLoanForm(match || {}, fields);
  return match;
}

// ---------- Ghi nhận khoản trả ----------
function openPayment(l, tx = null) {
  const dlg = $('#payDialog');
  const sch = schedule(l);
  const amount = tx ? -tx.amount : l.monthlyPayment ?? sch?.rows[0]?.total ?? null;
  const est = sch?.rows[0];
  let interest = null, principal = null;
  if (amount != null && est) {
    interest = Math.min(amount, Math.round(est.interest));
    principal = Math.max(0, Math.round(amount - interest));
  }
  const f = dlg.querySelector('form');
  $('#payTitle').textContent = `Ghi nhận khoản trả · ${loanTitle(l)}`;
  f.date.value = tx?.date || today();
  f.amount.value = amount != null ? fmtMoney(amount) : '';
  f.principal.value = principal != null ? fmtMoney(principal) : '';
  f.interest.value = interest != null ? fmtMoney(interest) : '';
  f.note.value = tx ? hideNumbers(tx.description).slice(0, 100) : '';
  f.apply.checked = true;
  $('#paySplitNote').textContent = est ? 'Phần gốc / lãi đang điền theo ước tính. Sửa lại theo thông báo của ngân hàng nếu có.' : '';
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const num = (el) => parseField({ type: 'money' }, el.value);
    const p = { date: f.date.value || today(), amount: num(f.amount), principal: num(f.principal), interest: num(f.interest), note: f.note.value.trim(), txId: tx?.id || '' };
    if (!p.amount && (p.principal || p.interest)) p.amount = (p.principal || 0) + (p.interest || 0);
    if (!p.amount) { ctx.toast('Chưa nhập số tiền nên chưa lưu.'); return; }
    // Trả trong vòng 25 ngày trước kỳ tới (hoặc sau đó) = đã trả kỳ này, kỳ tới lùi sang tháng sau.
    const d = derived(l);
    if (f.apply.checked && d.next && daysBetween(p.date, d.next) <= 25) {
      p.prevNext = l.nextPayment || '';
      l.nextPayment = addMonths(d.next, 1);
    }
    await store.addLoanPayment(l.id, p, f.apply.checked);
    ctx.toast('Đã ghi nhận khoản trả.');
    ctx.refresh();
  }, { once: true });
  dlg.showModal();
}

// ---------- Sự kiện ----------
export function bindLoanEvents(onImage) {
  const body = $('#loansBody');
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-loanadd]')) return openLoanForm({});
    const card = e.target.closest('[data-loan]');
    if (!card) return;
    const l = store.data.loans.find((x) => x.id === card.dataset.loan);
    if (e.target.closest('[data-loanedit]')) return openLoanForm(l);
    if (e.target.closest('[data-payadd]')) return openPayment(l);
    const txId = e.target.closest('[data-paytx]')?.dataset.paytx;
    if (txId) return openPayment(l, ctx.getTxs().find((t) => t.id === txId));
    const payId = e.target.closest('[data-paydel]')?.dataset.paydel;
    if (payId) {
      const p = l.payments.find((x) => x.id === payId);
      if (!(await ctx.confirmBox('Xóa lần trả này?', `${fmtDate(p.date)} · ${money(p.amount)}.${p.applied ? ' Phần gốc đã trừ vào dư nợ sẽ được cộng lại.' : ''}`, 'Xóa'))) return;
      await store.removeLoanPayment(l.id, payId);
      ctx.refresh();
      return;
    }
    if (e.target.closest('[data-loandel]')) {
      if (!(await ctx.confirmBox('Xóa khoản vay?', `Xóa "${loanTitle(l)}" cùng lịch sử trả nợ đã ghi nhận. Giao dịch trong sao kê vẫn giữ nguyên.`, 'Xóa'))) return;
      await store.removeLoan(l.id);
      ctx.refresh();
    }
  });
  body.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-loanimg]');
    if (!inp) return;
    const f = inp.files[0];
    inp.value = '';
    if (f) onImage(f, e.target.closest('[data-loan]')?.dataset.loan || null);
  });
  body.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-prepay]');
    if (!form) return;
    e.preventDefault();
    const l = store.data.loans.find((x) => x.id === form.closest('[data-loan]').dataset.loan);
    const extra = parseField({ type: 'money' }, form.extra.value);
    const out = form.querySelector('.prepay-out');
    const r = prepay(l, extra, form.keep.value);
    if (!r) { out.textContent = 'Hãy nhập số tiền trả trước.'; return; }
    const keepTerm = form.keep.value === 'term';
    out.innerHTML = `<ul class="checks">
      <li class="ok">Tiết kiệm khoảng <b>${money(r.saved)}</b> tiền lãi${r.fee ? `, trừ phí trả trước ${money(r.fee)} còn <b>${money(r.saved - r.fee)}</b>` : ''}.</li>
      ${keepTerm ? `<li class="info">Kỳ tới giảm từ ${money(r.oldFirst)} còn ${money(r.newFirst)}.</li>` : `<li class="info">Trả xong sớm ${r.monthsLess} tháng (${fmtDate(r.newEnd)}).</li>`}
      ${l.prepayFee == null ? '<li class="info">Chưa nhập phí trả nợ trước hạn. Phí thường 1–3% số tiền trả trước trong vài năm đầu, xem trong hợp đồng.</li>' : ''}
    </ul>`;
  });
}
