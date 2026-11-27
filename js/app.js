// Giao diện chính: khóa/mở khóa, tổng quan, giao dịch, nhập file, cài đặt.
import { parseFile, finalize } from './parsers/index.js';
import * as store from './store.js';
import { initLoans, bindLoanEvents, renderLoans, loansOverviewCard, loanFromImage } from './loans-ui.js';
import { readImage, releaseOcr } from './ocr.js';
import { renderCards, cardsOverviewCard } from './cards.js';
import { loanFromRows, txsFromRows } from './parsers/image.js';
import { classifyAll, categoryLists, EXPENSE_CATS, INCOME_CATS, KINDS, isCounted, UNCATEGORIZED } from './classify.js';
import { summarize, byMonth, monthsAvailable, byParty, byAccount, savingsReport } from './reports.js';
import { esc, fmtMoney, fmtSigned, fmtDate, hideNumbers, norm, parseMoney } from './util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const PAGE = 200;
const AUTO_LOCK_MS = 5 * 60 * 1000;

let lockMode = 'unlock';
let view = 'overview';
let txs = [];               // giao dịch đã phân loại
let session = { results: [], pending: [], reviews: [] }; // kết quả đọc file trong lần mở này; reviews: giao dịch đọc từ ảnh chờ soát
let shown = PAGE;
let partyFilter = null;      // { key, name } khi xem giao dịch của một đối tác
let partyAll = false;        // bảng đối tác: gồm cả khoản không tính
let partyExpanded = false;
const PARTY_TOP = 10;
const cats = () => categoryLists(store.data);

// =============== Hộp thoại dùng chung ===============
function askSecret(title, msg, okLabel = 'Mở') {
  const dlg = $('#pwDialog');
  $('#pwTitle').textContent = title;
  $('#pwMsg').textContent = msg;
  dlg.querySelector('button[value="ok"]').textContent = okLabel;
  $('#pwInput').value = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue === 'ok' ? $('#pwInput').value : null;
      $('#pwInput').value = '';
      resolve(v || null);
    }, { once: true });
    dlg.showModal();
    $('#pwInput').focus();
  });
}

function confirmBox(title, msg, okLabel = 'Đồng ý') {
  const dlg = $('#confirmDialog');
  $('#cfTitle').textContent = title;
  $('#cfMsg').textContent = msg;
  $('#cfOk').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'chart-tip';
  el.style.cssText = 'left:50%;bottom:90px;transform:translateX(-50%)';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// =============== Khóa / mở khóa ===============
async function showLock() {
  const has = await store.hasVault();
  lockMode = has ? 'unlock' : 'create';
  $('#lockTitle').textContent = has ? 'Mở khóa' : 'Tạo mật khẩu cho app';
  $('#lockMsg').textContent = has
    ? 'Nhập mật khẩu để giải mã dữ liệu trên máy này.'
    : 'Mọi dữ liệu được mã hóa bằng mật khẩu này và chỉ lưu trên máy. Quên mật khẩu thì không ai khôi phục được, kể cả người làm app, nên hãy xuất file backup thường xuyên.';
  $('#lockBtn').textContent = has ? 'Mở khóa' : 'Tạo và bắt đầu';
  $('#lockPw').autocomplete = has ? 'current-password' : 'new-password';
  $('#lockPw2').hidden = has;
  $('#lockRestore').hidden = has;
  $('#lockErr').textContent = '';
  $('#lockPw').value = '';
  $('#lockPw2').value = '';
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lockPw').focus();
}

$('#lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#lockPw').value;
  const err = (m) => { $('#lockErr').textContent = m; };
  if (lockMode === 'create') {
    if (pw.length < 8) return err('Mật khẩu cần ít nhất 8 ký tự.');
    if (pw !== $('#lockPw2').value) return err('Hai lần nhập không khớp.');
  } else if (!pw) return err('Hãy nhập mật khẩu.');
  const btn = $('#lockBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Đang xử lý…';
  try {
    if (lockMode === 'create') await store.create(pw); else await store.unlock(pw);
  } catch (ex) {
    err(ex.message);
    return;
  } finally {
    btn.disabled = false; btn.textContent = label;
    $('#lockPw').value = ''; $('#lockPw2').value = '';
  }
  openApp();
});

$('#restoreFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const pw = await askSecret('Khôi phục backup', `Nhập mật khẩu đã dùng khi tạo "${f.name}". Sau khi khôi phục, đây cũng là mật khẩu mở app trên máy này.`);
  if (!pw) return;
  try {
    const d = await store.readBackup(await f.text(), pw);
    await store.create(pw, d);
    openApp();
    toast(`Đã khôi phục ${Object.keys(d.transactions).length} giao dịch.`);
  } catch (ex) {
    $('#lockErr').textContent = ex.message;
  }
});

function openApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  navigator.storage?.persist?.().catch(() => {});
  refresh();
  go(Object.keys(store.data.transactions).length ? 'overview' : 'import');
}

function doLock() {
  store.lock();
  txs = [];
  session = { results: [], pending: [], reviews: [] };
  partyFilter = null; partyAll = false; partyExpanded = false;
  for (const id of ['#ovBody', '#txList', '#files', '#history', '#accounts', '#rules', '#cats', '#loansBody', '#cardsBody']) $(id).innerHTML = '';
  for (const d of ['#loanDialog', '#payDialog', '#txDialog']) if ($(d).open) $(d).close('cancel');
  releaseOcr();
  delete $('#ovMonth').dataset.init;
  $('#family').value = '';
  showLock();
}
$('#lockNow').addEventListener('click', doLock);

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (store.isUnlocked() && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) doLock();
});

// =============== Điều hướng ===============
$$('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

function go(v) {
  view = v;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.go === v));
  $$('section[data-view]').forEach((s) => { s.hidden = s.dataset.view !== v; });
  render();
  window.scrollTo(0, 0);
}

function refresh() {
  txs = classifyAll(store.data);
  render();
}

function render() {
  if (!store.isUnlocked()) return;
  if (view === 'overview') renderOverview();
  else if (view === 'tx') renderTx();
  else if (view === 'loans') { renderCards(txs, accLabel); renderLoans(); }
  else if (view === 'import') renderImport();
  else if (view === 'settings') renderSettings();
}

const accLabel = (key) => store.accountLabel(store.data.accounts[key]);
const monthLabel = (m) => { const [y, mo] = m.split('-'); return `Tháng ${+mo}/${y}`; };
function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (a >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (a >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

function fillMonthSelect(sel, months, allLabel, keep = true) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  if (keep && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  return sel.value;
}

// =============== Tổng quan ===============
$('#ovMonth').addEventListener('change', () => { partyExpanded = false; renderOverview(); });

function renderOverview() {
  const months = monthsAvailable(txs);
  const sel = $('#ovMonth');
  fillMonthSelect(sel, months, 'Tất cả thời gian');
  if (!sel.dataset.init && months.length) { sel.value = months[0]; sel.dataset.init = '1'; }
  const month = sel.value;

  if (!txs.length) {
    $('#ovBody').innerHTML = `<div class="card empty">Chưa có dữ liệu. Vào <b>Nhập file</b> để thêm sao kê.</div>${loansOverviewCard()}`;
    return;
  }
  const s = summarize(txs, month);
  const maxCat = Math.max(1, ...s.categories.map((c) => c.total));
  const catRows = s.categories.filter((c) => Math.abs(c.total) >= 1).map((c) => {
    const pct = s.expense > 0 ? Math.round((c.total / s.expense) * 100) : 0;
    return `<button class="bar-row" data-cat="${esc(c.category)}" title="Xem giao dịch ${esc(c.category)}">
      <span class="bar-label">${esc(c.category)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, (c.total / maxCat) * 100)}%; display:block"></span></span>
      <span class="bar-val">${fmtMoney(c.total)}<small>${pct}%</small></span>
    </button>`;
  }).join('');
  const maxInc = Math.max(1, ...s.incomeCategories.map((c) => c.total));
  const incRows = s.incomeCategories.map((c) => `<button class="bar-row" data-cat="${esc(c.category)}" data-kind="income">
      <span class="bar-label">${esc(c.category)}</span>
      <span class="bar-track"><span class="bar-fill in" style="width:${(c.total / maxInc) * 100}%; display:block"></span></span>
      <span class="bar-val">${fmtMoney(c.total)}</span>
    </button>`).join('');

  const months12 = byMonth(txs).slice(-12);
  $('#ovBody').innerHTML = `
    <dl class="kpis">
      <div class="card kpi clickable" data-kpi="income" role="button" tabindex="0" title="Xem các khoản tiền vào"><dt>Tiền vào ›</dt><dd class="in">${fmtMoney(s.income)}</dd></div>
      <div class="card kpi clickable" data-kpi="expense" role="button" tabindex="0" title="Xem các khoản tiền ra"><dt>Tiền ra ›</dt><dd class="out">${fmtMoney(s.expense)}</dd></div>
      <div class="card kpi net clickable" data-kpi="counted" role="button" tabindex="0" title="Xem mọi khoản có tính"><dt>Chênh lệch ›</dt><dd>${fmtSigned(s.net)}</dd></div>
    </dl>
    ${s.uncategorized ? `<p class="notice">Có ${s.uncategorized} giao dịch chưa phân loại. <button type="button" data-uncat>Phân loại ngay</button>. App sẽ nhớ cho những lần sau.</p>` : ''}
    ${excludedNote(s)}
    <div class="card">
      <h2>Chi theo danh mục</h2>
      <div class="bars">${catRows || '<p class="empty">Không có khoản chi.</p>'}</div>
    </div>
    <div class="card">
      <h2>Thu theo nguồn</h2>
      <div class="bars">${incRows || '<p class="empty">Không có khoản thu.</p>'}</div>
    </div>
    ${partyCard(month)}
    ${accountCard(month)}
    ${savingsCard(month)}
    ${cardsOverviewCard(txs, accLabel)}
    ${loansOverviewCard()}
    <div class="card chart">
      <h2>Thu và chi theo tháng</h2>
      <div class="legend"><span><i style="background:var(--s-in)"></i>Tiền vào</span><span><i style="background:var(--s-out)"></i>Tiền ra</span></div>
      ${monthlyChart(months12)}
      <details class="table-view"><summary>Xem dạng bảng</summary>
        <table><thead><tr><th>Tháng</th><th>Tiền vào</th><th>Tiền ra</th><th>Chênh lệch</th></tr></thead>
        <tbody>${months12.slice().reverse().map((m) => `<tr><td>${monthLabel(m.month)}</td><td>${fmtMoney(m.income)}</td><td>${fmtMoney(m.expense)}</td><td>${fmtSigned(m.income - m.expense)}</td></tr>`).join('')}</tbody></table>
      </details>
    </div>`;
}

const lots = (n) => `${n} lần`;

// Giải thích vì sao có giao dịch không tính vào Tiền vào / Tiền ra, tách theo từng loại.
const EXCLUDED_WHY = {
  cc_payment: ['trả nợ thẻ tín dụng', 'tiền quẹt thẻ đã tính ở từng món mua, tính thêm khoản trả nợ là trùng'],
  transfer: ['chuyển giữa tài khoản trong gia đình', 'tiền chỉ đổi chỗ, không phải chi hay thu; gồm cả món mua đã chuyển sang trả góp (tính theo từng kỳ) và tiền giải ngân khoản vay'],
  savings: ['gửi / rút tiết kiệm', 'tiền vẫn là của mình, xem ở thẻ Tiết kiệm'],
  ignore: ['bạn tự loại khỏi báo cáo', 'ví dụ chuyển nhầm rồi trả lại'],
};
function excludedNote(s) {
  if (!s.excludedCount) return '';
  const items = Object.entries(EXCLUDED_WHY).filter(([k]) => s.excludedByKind[k]).map(([k, [label, why]]) => {
    const e = s.excludedByKind[k];
    return `<li><button type="button" class="link" data-excl="${k}">${e.count} lần ${label}</button>: ${fmtMoney(e.total)} đ. <span class="muted">${why}.</span></li>`;
  }).join('');
  return `<details class="excluded-note small"><summary>Có ${s.excludedCount} giao dịch (${fmtMoney(s.excluded)} đ) không tính vào Tiền vào / Tiền ra để tránh tính trùng. Vì sao?</summary>
      <ul>${items}</ul>
      <p class="muted">Bấm từng dòng để xem giao dịch. Thấy khoản nào xếp sai thì mở giao dịch đó và đổi lại loại.</p>
    </details>`;
}
// "NGAN HANG TMCP NGOAI THUONG VIET NAM (VIETCOMBANK)" → "VIETCOMBANK"
const shortBank = (b) => b.split(', ').map((x) => x.match(/\(([^)]+)\)/)?.[1] || x.replace(/^NGAN HANG (TMCP )?/i, '')).join(', ');

function partyCard(month) {
  const rows = byParty(txs, month, partyAll);
  const list = partyExpanded ? rows : rows.slice(0, PARTY_TOP);
  const cell = (v, n, cls) => (n ? `<td class="amt ${cls}">${fmtMoney(v)}<div class="detail">${lots(n)}</div></td>` : '<td class="amt detail">—</td>');
  const body = list.map((r) => `<tr class="clickable" data-party="${esc(r.key)}" data-name="${esc(r.name)}">
      <td><div class="main">${esc(hideNumbers(r.name))}</div>${r.bank ? `<div class="detail">${esc(shortBank(r.bank))}</div>` : ''}</td>
      ${cell(r.out, r.outCount, 'out')}${cell(r.in, r.inCount, 'in')}
    </tr>`).join('');
  return `<div class="card">
      <div class="row-between wrap"><h2>Theo đối tác</h2>
        <label class="check inline"><input type="checkbox" data-partyall ${partyAll ? 'checked' : ''}> Gồm cả khoản không tính</label></div>
      <p class="muted small">Chuyển cho ai, nhận từ ai, mua ở đâu: bao nhiêu lần, bao nhiêu tiền. Bấm một dòng để xem từng giao dịch.</p>
      ${rows.length ? `<table class="tx party"><thead><tr><th>Đối tác</th><th class="amt">Tiền ra</th><th class="amt">Tiền vào</th></tr></thead><tbody>${body}</tbody></table>
      ${rows.length > PARTY_TOP ? `<div class="more"><button class="btn small" type="button" data-partymore>${partyExpanded ? 'Thu gọn' : `Xem tất cả ${rows.length} đối tác`}</button></div>` : ''}`
        : '<p class="empty">Không có giao dịch.</p>'}
    </div>`;
}

function accountCard(month) {
  const rows = byAccount(txs, month);
  if (!rows.length) return '';
  const body = rows.map((r) => `<tr class="clickable" data-acc="${esc(r.account)}">
      <td><div class="main">${esc(accLabel(r.account))}</div></td>
      <td class="amt out">${fmtMoney(r.out)}<div class="detail">${lots(r.outCount)}</div></td>
      <td class="amt in">${r.inCount ? fmtMoney(r.in) + `<div class="detail">${lots(r.inCount)}</div>` : '—'}</td>
    </tr>`).join('');
  return `<div class="card">
      <h2>Theo tài khoản của tôi</h2>
      <p class="muted small">Chi tiêu và thu nhập (chỉ khoản có tính) trên từng tài khoản, thẻ. Bấm một dòng để xem giao dịch.</p>
      <table class="tx party"><thead><tr><th>Tài khoản</th><th class="amt">Chi</th><th class="amt">Thu</th></tr></thead><tbody>${body}</tbody></table>
    </div>`;
}

function savingsCard(month) {
  const sv = store.data.savings;
  const r = savingsReport(txs, sv, month);
  const form = `<form class="savings-form" data-savings>
      <label class="field">Số dư tiết kiệm (đ)<input name="opening" inputmode="numeric" autocomplete="off" placeholder="Ví dụ 150.000.000" value="${sv.opening != null ? fmtMoney(sv.opening) : ''}"></label>
      <label class="field">Tính từ đầu ngày<input name="asOf" type="date" value="${esc(sv.asOf || '')}"></label>
      <div class="actions">${sv.opening != null ? '<button class="btn small" type="button" data-savingsclear>Xóa</button>' : ''}<button class="btn small primary" type="submit">Lưu</button></div>
    </form>`;
  if (!r) {
    return `<div class="card">
        <h2>Tiết kiệm</h2>
        <p class="muted small">Nhập tổng số dư các sổ tiết kiệm tại một ngày. App cộng các khoản gửi thêm, trừ các khoản rút có trong sao kê để tính số dư theo tháng.</p>
        ${form}
      </div>`;
  }
  const before = month && r.to < sv.asOf;
  return `<div class="card">
      <h2>Tiết kiệm</h2>
      <dl class="stats">
        <div><dt>${month ? 'Đầu tháng' : `Đầu kỳ (${esc(fmtDate(sv.asOf))})`}</dt><dd>${fmtMoney(r.start)}</dd></div>
        <div><dt>Gửi thêm</dt><dd class="in">+${fmtMoney(r.deposit)}</dd></div>
        <div><dt>Rút ra</dt><dd class="out">−${fmtMoney(r.withdraw)}</dd></div>
        <div><dt>${month ? 'Cuối tháng' : 'Hiện tại'}</dt><dd>${fmtMoney(r.end)}</dd></div>
      </dl>
      <p class="muted small">Tính từ số dư ${fmtMoney(sv.opening)} đ đầu ngày ${esc(fmtDate(sv.asOf))}, cộng tiền gửi và trừ tiền rút có trong sao kê (${r.count} giao dịch${r.count ? `, <button type="button" class="link" data-savingstx>xem</button>` : ''}).${before ? ' Tháng này trước ngày bạn nhập số dư nên app tính ngược lại.' : ''} Lãi trả vào tài khoản thanh toán được tính là thu nhập, không cộng vào đây.</p>
      <details><summary class="small">Sửa số dư đầu kỳ</summary>${form}</details>
    </div>`;
}

function openTx({ kind = '', cat = '', acc = '', party = null, dir = '' } = {}) {
  $('#fDir').value = dir;
  $('#fSort').value = 'new';
  partyFilter = party;
  go('tx');
  fillTxFilters();
  $('#q').value = '';
  $('#fMonth').value = $('#ovMonth').value;
  $('#fKind').value = kind;
  fillCatFilter();
  $('#fCat').value = cat;
  $('#fAcc').value = acc;
  shown = PAGE;
  renderTx();
}

$('#ovBody').addEventListener('click', async (e) => {
  if (e.target.closest('[data-goloans]')) return go('loans');
  const row = e.target.closest('.bar-row');
  if (row) return openTx({ kind: row.dataset.kind || 'expense', cat: row.dataset.cat });
  if (e.target.closest('[data-uncat]')) return openTx({ kind: 'expense', cat: UNCATEGORIZED });
  const ex = e.target.closest('[data-excl]');
  if (ex) return openTx({ kind: ex.dataset.excl });
  const kpi = e.target.closest('[data-kpi]');
  if (kpi) return openTx({ kind: kpi.dataset.kpi });
  if (e.target.closest('[data-savingstx]')) return openTx({ kind: 'savings' });
  const pr = e.target.closest('tr[data-party]');
  if (pr) return openTx({ kind: partyAll ? '' : 'counted', party: { key: pr.dataset.party, name: pr.dataset.name } });
  const ar = e.target.closest('tr[data-acc]');
  if (ar) return openTx({ kind: 'counted', acc: ar.dataset.acc });
  if (e.target.closest('[data-partymore]')) { partyExpanded = !partyExpanded; renderOverview(); return; }
  if (e.target.closest('[data-savingsclear]')) {
    await store.setSavings(null, '');
    renderOverview();
  }
});

$('#ovBody').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-kpi]')) { e.preventDefault(); e.target.click(); }
});

$('#ovBody').addEventListener('change', (e) => {
  if (e.target.matches('[data-partyall]')) { partyAll = e.target.checked; partyExpanded = false; renderOverview(); }
});

$('#ovBody').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-savings]');
  if (!f) return;
  e.preventDefault();
  const opening = parseMoney(f.opening.value);
  const asOf = f.asOf.value;
  if (opening == null || opening < 0) { toast('Hãy nhập số dư tiết kiệm (số tiền).'); return; }
  if (!asOf) { toast('Hãy chọn ngày của số dư này.'); return; }
  await store.setSavings(opening, asOf);
  renderOverview();
  toast('Đã lưu số dư tiết kiệm.');
});

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Biểu đồ cột nhóm theo tháng, một trục, hai dãy (vào/ra). */
function monthlyChart(rows) {
  if (!rows.length) return '<p class="empty">Chưa có dữ liệu.</p>';
  // Vẽ theo đúng bề rộng màn hình để chữ trên trục không bị thu nhỏ trên điện thoại.
  const W = Math.round(Math.max(300, Math.min(640, window.innerWidth - 64))), H = 230, L = 46, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => [r.income, r.expense])));
  const ph = H - T - B;
  const gw = (W - L - R) / rows.length;
  const bw = Math.max(4, Math.min(22, (gw - 12) / 2));
  const y = (v) => T + ph - (Math.max(0, v) / max) * ph;
  const bar = (x, v, cls) => {
    const h = (Math.max(0, v) / max) * ph;
    if (h < 0.5) return '';
    const r = Math.min(4, h, bw / 2);
    const y0 = T + ph;
    return `<path class="${cls}" d="M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z"/>`;
  };
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtShort(v)}</text>`;
  }
  const groups = rows.map((r, i) => {
    const cx = L + gw * i + gw / 2;
    const [yy, mm] = r.month.split('-');
    return `<g>
      ${bar(cx - bw - 1, r.income, 'b-in')}${bar(cx + 1, r.expense, 'b-out')}
      <text x="${cx}" y="${H - 8}" text-anchor="middle">${mm}/${yy.slice(2)}</text>
      <rect class="hit" x="${L + gw * i}" y="${T}" width="${gw}" height="${ph}" data-tip="${esc(`${monthLabel(r.month)}|Tiền vào: ${fmtMoney(r.income)} đ|Tiền ra: ${fmtMoney(r.expense)} đ`)}"/>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu và chi theo tháng">${grid}${groups}</svg>`;
}

// Chú thích khi rê chuột / chạm vào cột.
const tip = document.createElement('div');
tip.className = 'chart-tip';
tip.hidden = true;
document.body.append(tip);
document.addEventListener('pointermove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  const [head, ...lines] = t.dataset.tip.split('|');
  tip.innerHTML = `<b>${esc(head)}</b><br>${lines.map(esc).join('<br>')}`;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px';
  tip.style.top = (e.clientY - tip.offsetHeight - 12) + 'px';
});

// =============== Giao dịch ===============
for (const id of ['#q', '#fMonth', '#fKind', '#fCat', '#fAcc', '#fDir', '#fSort']) {
  $(id).addEventListener(id === '#q' ? 'input' : 'change', () => {
    if (id === '#fKind') fillCatFilter();
    shown = PAGE;
    renderTx();
  });
}

function fillCatFilter() {
  const k = $('#fKind').value;
  const c = cats();
  const list = k === 'income' ? c.income : k === 'expense' ? c.expense : [...c.expense, ...c.income];
  const cur = $('#fCat').value;
  $('#fCat').innerHTML = `<option value="">Mọi danh mục</option>` + list.map((x) => `<option>${esc(x)}</option>`).join('');
  if (list.includes(cur)) $('#fCat').value = cur;
}

function fillTxFilters() {
  fillMonthSelect($('#fMonth'), monthsAvailable(txs), 'Mọi tháng');
  const kSel = $('#fKind');
  if (!kSel.options.length) {
    kSel.innerHTML = `<option value="">Mọi loại</option><option value="counted">Có tính (thu + chi)</option><option value="excluded">Không tính (mọi loại)</option>` +
      Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  }
  fillCatFilter();
  const aSel = $('#fAcc');
  const cur = aSel.value;
  aSel.innerHTML = `<option value="">Mọi tài khoản</option>` +
    Object.keys(store.data.accounts).map((k) => `<option value="${esc(k)}">${esc(accLabel(k))}</option>`).join('');
  if ([...aSel.options].some((o) => o.value === cur)) aSel.value = cur;
}

function renderTx() {
  fillTxFilters();
  const q = norm($('#q').value);
  const m = $('#fMonth').value, k = $('#fKind').value, c = $('#fCat').value, a = $('#fAcc').value;
  const dir = $('#fDir').value, sort = $('#fSort').value;
  const list = txs.filter((t) =>
    (!m || t.date.startsWith(m)) &&
    (!k || (k === 'counted' ? isCounted(t.kind) : k === 'excluded' ? !isCounted(t.kind) : t.kind === k)) &&
    (!dir || (dir === 'in' ? t.amount > 0 : t.amount < 0)) &&
    (!c || t.category === c) &&
    (!a || t.account === a) &&
    (!partyFilter || t.key === partyFilter.key) &&
    (!q || norm(`${t.party} ${t.merchant} ${t.description} ${t.counterparty} ${t.note || ''}`).includes(q)));
  // txs đã xếp mới nhất trước.
  if (sort === 'old') list.reverse();
  else if (sort === 'big') list.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
  else if (sort === 'small') list.sort((x, y) => Math.abs(x.amount) - Math.abs(y.amount));

  let out = 0, outN = 0, inc = 0, incN = 0;
  for (const t of list) { if (t.amount < 0) { out -= t.amount; outN++; } else { inc += t.amount; incN++; } }
  const party = partyFilter ? `<span class="chip filter">Đối tác: ${esc(hideNumbers(partyFilter.name))} <button type="button" data-clearparty aria-label="Bỏ lọc đối tác">✕</button></span> ` : '';
  $('#txSummary').innerHTML = `${party}${list.length} giao dịch · Tiền ra <b class="out">${fmtMoney(out)} đ</b> (${lots(outN)}) · Tiền vào <b class="in">${fmtMoney(inc)} đ</b> (${lots(incN)})`;
  const body = list.slice(0, shown).map((t) => {
    const main = hideNumbers(t.party || t.merchant || t.counterparty || t.description);
    const detail = t.description && hideNumbers(t.description) !== main ? hideNumbers(t.description) : '';
    const counted = isCounted(t.kind);
    const chip = counted
      ? `<span class="chip ${t.category === UNCATEGORIZED ? 'unc' : ''}">${esc(t.category)}${t.source === 'manual' || t.source === 'rule' ? ' ✎' : ''}</span>`
      : `<span class="chip">${esc(KINDS[t.kind])}</span>`;
    return `<tr class="clickable ${counted ? '' : 'excluded'}" data-id="${esc(t.id)}">
      <td class="date">${esc(fmtDate(t.date))}</td>
      <td><div class="main">${esc(main)}</div>${chip}${t.source === 'manual' && t.note ? `<div class="detail">📝 ${esc(t.note)}</div>` : ''}${detail ? `<div class="detail">${esc(detail)}</div>` : ''}</td>
      <td class="acc detail">${esc(accLabel(t.account))}</td>
      <td class="amt ${t.amount > 0 ? 'in' : 'out'}">${fmtSigned(t.amount)}</td>
    </tr>`;
  }).join('');
  const more = list.length > shown ? `<div class="more"><button class="btn small" data-more>Xem thêm</button></div>` : '';
  $('#txList').innerHTML = list.length
    ? `<table class="tx"><thead><tr><th>Ngày</th><th>Nội dung</th><th>Tài khoản</th><th class="amt">Số tiền</th></tr></thead><tbody>${body}</tbody></table>${more}`
    : '<p class="empty">Không có giao dịch phù hợp.</p>';
}

$('#txSummary').addEventListener('click', (e) => {
  if (!e.target.closest('[data-clearparty]')) return;
  partyFilter = null;
  shown = PAGE;
  renderTx();
});

$('#txList').addEventListener('click', (e) => {
  if (e.target.closest('[data-more]')) { shown += PAGE; renderTx(); return; }
  const row = e.target.closest('tr[data-id]');
  if (row) editTx(row.dataset.id);
});

// ----- Sửa phân loại -----
function editTx(id) {
  const t = txs.find((x) => x.id === id);
  if (!t) return;
  const dlg = $('#txDialog');
  $('#txdTitle').textContent = hideNumbers(`${fmtSigned(t.amount)} đ · ${t.merchant || t.counterparty || ''}`.trim());
  $('#txdInfo').textContent = `${fmtDate(t.date)} · ${accLabel(t.account)}\n${hideNumbers(t.description)}`;
  $('#txdKind').innerHTML = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#txdKind').value = t.kind;
  $('#txdNote').value = t.source === 'manual' ? t.note || '' : '';
  $('#txdNewCat').value = '';

  // Khoản ngược chiều cùng số tiền trong 30 ngày (vd. nhận nhầm rồi chuyển trả lại).
  const pair = txs
    .filter((x) => x.id !== t.id && x.kind !== 'ignore' && Math.abs(x.amount + t.amount) < 1
      && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 30 * 864e5)
    .sort((a, b) => (b.key === t.key) - (a.key === t.key)
      || Math.abs(Date.parse(a.date) - Date.parse(t.date)) - Math.abs(Date.parse(b.date) - Date.parse(t.date)))[0];
  $('#txdPairText').textContent = pair
    ? `Loại luôn khoản ngược chiều: ${fmtDate(pair.date)} · ${fmtSigned(pair.amount)} đ · ${hideNumbers(pair.merchant || pair.counterparty || pair.description)}`
    : '';

  const similar = txs.filter((x) => x.key === t.key).length;
  const fillCats = (kind) => {
    const list = kind === 'income' ? cats().income : cats().expense;
    const cur = $('#txdCat').value;
    $('#txdCat').innerHTML = list.map((c) => `<option>${esc(c)}</option>`).join('') + '<option value="__new">➕ Thêm danh mục mới…</option>';
    if (list.includes(cur)) $('#txdCat').value = cur;
    $('#txdCatWrap').hidden = !isCounted(kind);
    $('#txdNewCatWrap').hidden = !isCounted(kind) || $('#txdCat').value !== '__new';
    // Loại khỏi báo cáo thường chỉ cho đúng giao dịch này, không áp cho mọi giao dịch cùng người.
    $('#txdRemember').checked = kind !== 'ignore';
    $('#txdPairWrap').hidden = !(kind === 'ignore' && pair);
    $('#txdPair').checked = true;
  };
  fillCats(t.kind);
  if (t.category) $('#txdCat').value = t.category;
  $('#txdKind').onchange = () => fillCats($('#txdKind').value);
  $('#txdCat').onchange = () => {
    $('#txdNewCatWrap').hidden = $('#txdCat').value !== '__new';
    if ($('#txdCat').value === '__new') $('#txdNewCat').focus();
  };
  $('#txdRememberText').textContent = `Nhớ cho các giao dịch giống vậy, cả lần nhập sau (nhận theo “${t.key || '—'}”, hiện có ${similar} giao dịch)`;
  $('#txdSource').textContent = {
    manual: 'Đang dùng: bạn đã sửa tay giao dịch này.',
    rule: 'Đang dùng: quy tắc bạn đã dạy.',
    system: `Đang dùng: quy tắc có sẵn${t.note ? ` (${t.note})` : ''}.`,
    auto: 'Đang dùng: đoán theo từ khóa.',
  }[t.source] || '';
  $('#txdReset').hidden = t.source !== 'manual';

  dlg.addEventListener('close', async () => {
    if (dlg.returnValue === 'reset') {
      await store.setOverride(t.id, null);
      refresh();
      return;
    }
    if (dlg.returnValue !== 'ok') return;
    const kind = $('#txdKind').value;
    let category = isCounted(kind) ? $('#txdCat').value : '';
    if (category === '__new') {
      category = $('#txdNewCat').value.trim().replace(/\s+/g, ' ');
      if (!category) { toast('Chưa nhập tên danh mục mới nên chưa lưu.'); return; }
      const existing = [...cats().expense, ...cats().income].find((c) => norm(c) === norm(category));
      if (existing) category = existing;
      else await store.addCategory(kind === 'income' ? 'income' : 'expense', category);
    }
    const note = $('#txdNote').value.trim();
    if ($('#txdRemember').checked && t.key) {
      await store.upsertRule({ key: t.key, kind, category });
      // Dòng này theo quy tắc chung; chỉ giữ sửa tay riêng khi có ghi chú.
      await store.setOverride(t.id, note ? { kind, category, note } : null);
    } else {
      await store.setOverride(t.id, { kind, category, ...(note && { note }) });
    }
    if (kind === 'ignore' && pair && $('#txdPair').checked) {
      await store.setOverride(pair.id, { kind: 'ignore', category: '', note: note || 'Cặp với khoản ngày ' + fmtDate(t.date) });
    }
    refresh();
  }, { once: true });
  dlg.showModal();
}

// Enter trong ô chữ = Lưu (nếu không, form sẽ bấm nút đầu tiên là "Về mặc định").
$('#txDialog').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[type="text"]')) {
    e.preventDefault();
    $('#txDialog').close('ok');
  }
});

// =============== Nhập file ===============
$('#file').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); handleFiles([...e.dataTransfer.files]); });

const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|gif|bmp)$/i.test(f.name);

/** Ảnh chụp: đọc chữ trên máy rồi đoán là màn hình khoản vay hay lịch sử giao dịch. */
async function handleImage(f, { loanId = null, loanOnly = false } = {}) {
  const status = (s) => { pendingStatus.set(f.name, s); renderImport(); };
  session.pending.push(f.name);
  if (loanOnly) toast('Đang đọc chữ trong ảnh…');
  try {
    const ocr = await readImage(f, status);
    if (!store.isUnlocked()) return;
    const loan = loanFromRows(ocr.rows);
    const list = loanOnly ? [] : txsFromRows(ocr.rows);
    if (loan.found >= 4 || (loanOnly && loan.found) || (loan.found >= 2 && list.length < 2)) {
      const match = loanFromImage(loan.fields, loanId);
      session.results.unshift({ fileName: f.name, info: `Ảnh thông tin khoản vay: đọc được ${loan.found} mục, đã mở form để bạn kiểm tra${match ? ' và cập nhật khoản vay đã có' : ''}.` });
    } else if (list.length) {
      const existing = txs.map((t) => `${t.date}|${Math.round(t.amount)}`);
      session.reviews.unshift({
        id: Math.random().toString(36).slice(2), fileName: f.name, fileSize: f.size, text: ocr.text,
        account: Object.keys(store.data.accounts)[0] || '__new', newName: 'Ảnh chụp',
        rows: list.map((t) => {
          const dup = existing.includes(`${t.date}|${Math.round(t.amount)}`);
          return { date: t.date, description: t.description, sign: t.amount > 0 ? 1 : -1, value: Math.abs(t.amount), signGuess: t.signGuess, dup, on: !dup };
        }),
      });
    } else {
      throw new Error(loanOnly ? 'Không thấy thông tin khoản vay trong ảnh. Hãy chụp màn hình chi tiết khoản vay trong app ngân hàng.' : 'Không tìm thấy giao dịch hay thông tin khoản vay trong ảnh. Ảnh cần rõ chữ, có ngày và số tiền.');
    }
  } catch (e) {
    console.error(e);
    session.results.unshift({ fileName: f.name, error: e?.message || String(e) });
    if (loanOnly) toast(e?.message || String(e));
  } finally {
    session.pending = session.pending.filter((n) => n !== f.name);
    pendingStatus.delete(f.name);
    renderImport();
  }
}
const pendingStatus = new Map();

async function handleFiles(files) {
  for (const f of files) {
    if (isImage(f)) { await handleImage(f); continue; }
    session.pending.push(f.name);
    renderImport();
    let r;
    try {
      r = await parseFile(f, {
        askPassword: (retry) => askSecret('File có mật khẩu',
          (retry ? 'Mật khẩu chưa đúng. ' : '') + `Nhập mật khẩu để mở "${f.name}". Mật khẩu chỉ dùng để mở file trên máy này và không được lưu lại.`),
      });
      if (!store.isUnlocked()) return;
      // Bảng tính đọc theo cột chung được lưu thành tài khoản riêng: cảnh báo nếu trùng sao kê PDF đã nhập.
      if (r.parser === 'excel-generic') {
        const have = new Set(txs.map((t) => `${t.date}|${Math.round(t.amount)}`));
        const same = r.transactions.filter((t) => have.has(`${t.date}|${Math.round(t.amount)}`)).length;
        if (same >= Math.max(2, r.transactions.length * 0.5)) {
          r.warnings.push(`${same}/${r.transactions.length} giao dịch trùng ngày và số tiền với giao dịch đã có (có thể bạn đã nhập bản PDF của cùng sao kê). Nếu vậy hãy bấm Xóa file này ở mục "File đã nhập" để không bị tính hai lần.`);
        }
      }
      r.saved = await store.importResult(r);
    } catch (e) {
      console.error(e);
      r = { fileName: f.name, error: e?.message || String(e) };
    }
    session.pending = session.pending.filter((n) => n !== f.name);
    session.results.unshift(r);
    txs = classifyAll(store.data);
    renderImport();
  }
}

function checkLine(c) {
  if (c.ok === true) return `<li class="ok">✓ ${esc(c.label)} khớp sao kê: ${fmtMoney(c.expected)}</li>`;
  if (c.ok === false) return `<li class="bad">⚠ ${esc(c.label)}: sao kê ghi ${fmtMoney(c.expected)}, app đọc được ${fmtMoney(c.actual)} (lệch ${fmtMoney(Math.abs(c.expected - c.actual))})</li>`;
  return `<li class="info">ℹ ${esc(c.label)}</li>`;
}

function reviewCard(rv) {
  const accs = Object.keys(store.data.accounts);
  const on = rv.rows.filter((r) => r.on && r.date && r.value >= 1);
  const rows = rv.rows.map((r, i) => `<tr class="${r.on ? '' : 'excluded'}" data-i="${i}">
      <td><input type="checkbox" data-f="on" ${r.on ? 'checked' : ''} aria-label="Lưu dòng này"></td>
      <td><input type="date" data-f="date" value="${esc(r.date)}" aria-label="Ngày"></td>
      <td><input type="text" data-f="description" value="${esc(r.description)}" aria-label="Nội dung">${r.dup ? '<div class="detail warn">Có thể trùng: đã có giao dịch cùng ngày, cùng số tiền</div>' : ''}</td>
      <td class="amt"><div class="amt-edit"><button type="button" class="btn small ${r.sign > 0 ? 'in' : 'out'}" data-sign title="Đổi chiều tiền vào / ra" aria-label="${r.sign > 0 ? 'Tiền vào' : 'Tiền ra'}, bấm để đổi">${r.sign > 0 ? '+' : '−'}</button><input type="text" inputmode="numeric" data-f="amount" value="${r.value ? fmtMoney(r.value) : ''}" aria-label="Số tiền"></div>${r.signGuess ? '<div class="detail">chiều tiền do app đoán</div>' : ''}</td>
    </tr>`).join('');
  return `<article class="card file review" data-rv="${esc(rv.id)}">
    <div class="file-head"><span class="file-name">${esc(rv.fileName)}</span><span class="tag">Ảnh · chờ soát</span></div>
    <p class="small muted">App đọc được ${rv.rows.length} giao dịch từ ảnh. Hãy soát ngày, nội dung, số tiền và chiều tiền (+ vào, − ra) rồi bấm Lưu. Bỏ chọn những dòng không phải giao dịch.</p>
    <div class="review-acc">
      <label class="field">Lưu vào tài khoản<select data-acc>${accs.map((k) => `<option value="${esc(k)}" ${rv.account === k ? 'selected' : ''}>${esc(accLabel(k))}</option>`).join('')}<option value="__new" ${rv.account === '__new' ? 'selected' : ''}>➕ Tài khoản mới…</option></select></label>
      ${rv.account === '__new' ? `<label class="field">Tên tài khoản mới<input type="text" data-newname value="${esc(rv.newName)}" maxlength="40"></label>` : ''}
    </div>
    <div class="scroll-table"><table class="tx review-table"><thead><tr><th></th><th>Ngày</th><th>Nội dung</th><th class="amt">Số tiền</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details class="small"><summary>Chữ app đọc được trong ảnh</summary><pre class="ocr-text">${esc(rv.text)}</pre></details>
    <div class="actions">
      <button class="btn small" type="button" data-rvdrop>Bỏ ảnh này</button>
      <button class="btn small" type="button" data-rvadd>+ Thêm dòng</button>
      <button class="btn small primary" type="button" data-rvsave>Lưu ${on.length} giao dịch</button>
    </div>
  </article>`;
}

function renderImport() {
  const reviews = session.reviews.map(reviewCard);
  const cards = session.results.map((r) => {
    if (r.error) {
      return `<article class="card file error"><div class="file-head"><span class="file-name">${esc(r.fileName)}</span><span class="tag">Lỗi</span></div><p class="err">${esc(r.error)}</p></article>`;
    }
    if (r.info) {
      return `<article class="card file"><div class="file-head"><span class="file-name">${esc(r.fileName)}</span><span class="tag">Ảnh</span></div><p class="small">${esc(r.info)}</p></article>`;
    }
    const label = [r.bank, r.accountTypeLabel].filter(Boolean).join(' · ');
    return `<article class="card file">
      <div class="file-head"><span class="file-name">${esc(r.fileName)}</span><span class="tag">${esc(label)}</span></div>
      <dl class="stats">
        <div><dt>Tài khoản</dt><dd>${esc(accLabel(r.saved.account)) || '—'}</dd></div>
        <div><dt>Kỳ sao kê</dt><dd>${esc(fmtDate(r.period.from))} – ${esc(fmtDate(r.period.to))}</dd></div>
        <div><dt>Đã lưu</dt><dd>${r.saved.added} mới${r.saved.dup ? ` · ${r.saved.dup} đã có (cập nhật lại)` : ''}</dd></div>
        <div><dt>Tiền vào (thô)</dt><dd class="in">+${fmtMoney(r.inflow)}</dd></div>
        <div><dt>Tiền ra (thô)</dt><dd class="out">−${fmtMoney(r.outflow)}</dd></div>
      </dl>
      <ul class="checks">${r.checks.map(checkLine).join('')}${r.warnings.map((w) => `<li class="info">ℹ ${esc(w)}</li>`).join('')}</ul>
    </article>`;
  });
  const pending = session.pending.map((n) => `<article class="card file pending"><span class="file-name">${esc(n)}</span> <span class="muted">${esc(pendingStatus.get(n) || 'đang đọc…')}</span></article>`);
  $('#files').innerHTML = pending.concat(reviews, cards).join('');

  const files = store.data.files.slice().reverse();
  $('#history').innerHTML = files.length ? files.map((f) => `<div class="list-row">
      <div><div>${esc(f.name)} ${f.checksOk ? '' : '<span class="chip unc">tổng chưa khớp</span>'}</div>
      <div class="detail">${esc(accLabel(f.account))} · ${esc(fmtDate(f.period?.from))} – ${esc(fmtDate(f.period?.to))} · ${f.added} giao dịch mới · nhập ${esc(new Date(f.importedAt).toLocaleDateString('vi-VN'))}</div></div>
      <button class="btn small" data-delfile="${esc(f.id)}">Xóa</button>
    </div>`).join('') : '<p class="empty">Chưa nhập file nào.</p>';
}

// ----- Soát giao dịch đọc từ ảnh -----
const reviewOf = (el) => session.reviews.find((r) => r.id === el.closest('[data-rv]')?.dataset.rv);

$('#files').addEventListener('change', (e) => {
  const rv = reviewOf(e.target);
  if (!rv) return;
  if (e.target.matches('[data-acc]')) { rv.account = e.target.value; renderImport(); return; }
  if (e.target.matches('[data-newname]')) { rv.newName = e.target.value.trim(); return; }
  const tr = e.target.closest('tr[data-i]');
  const f = e.target.dataset.f;
  if (!tr || !f) return;
  const row = rv.rows[+tr.dataset.i];
  if (f === 'on') row.on = e.target.checked;
  else if (f === 'amount') row.value = Math.abs(parseMoney(e.target.value) ?? 0);
  else row[f] = e.target.value;
  renderImport();
});

$('#files').addEventListener('click', async (e) => {
  const rv = reviewOf(e.target);
  if (!rv) return;
  const tr = e.target.closest('tr[data-i]');
  if (e.target.closest('[data-sign]') && tr) {
    const row = rv.rows[+tr.dataset.i];
    row.sign = -row.sign;
    row.signGuess = false;
    renderImport();
    return;
  }
  if (e.target.closest('[data-rvadd]')) { rv.rows.push({ date: '', description: '', sign: -1, value: 0, on: true }); renderImport(); return; }
  if (e.target.closest('[data-rvdrop]')) { session.reviews = session.reviews.filter((x) => x !== rv); renderImport(); return; }
  if (!e.target.closest('[data-rvsave]')) return;
  const rows = rv.rows.filter((r) => r.on && r.date && r.value >= 1);
  if (!rows.length) { toast('Chưa có dòng nào đủ ngày và số tiền.'); return; }
  const isNew = rv.account === '__new';
  const name = rv.newName || 'Ảnh chụp';
  const acc = isNew ? null : store.data.accounts[rv.account];
  const r = finalize({
    parser: 'image',
    accountKey: isNew ? `img|${norm(name)}` : rv.account,
    bank: acc ? acc.bank : name,
    accountType: acc ? acc.type : 'unknown',
    accountTypeLabel: acc ? acc.typeLabel : 'Ảnh chụp',
    accountNo: acc ? acc.accountNo : '',
    transactions: rows.map((t) => {
      const amount = t.sign * Math.round(t.value);
      return { date: t.date, description: t.description.trim(), merchant: t.description.trim(), counterparty: '', debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0, amount, fromImage: true };
    }),
    checks: [{ ok: null, label: 'Đọc từ ảnh chụp, đã được bạn soát lại trước khi lưu.' }],
    warnings: [],
  }, { name: rv.fileName, size: rv.fileSize });
  r.saved = await store.importResult(r);
  session.reviews = session.reviews.filter((x) => x !== rv);
  session.results.unshift(r);
  refresh();
  toast(`Đã lưu ${r.saved.added} giao dịch từ ảnh.`);
});

$('#history').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-delfile]')?.dataset.delfile;
  if (!id) return;
  const f = store.data.files.find((x) => x.id === id);
  if (!(await confirmBox('Xóa file đã nhập?', `Xóa "${f.name}" và ${f.added} giao dịch được thêm từ file này. Quy tắc đã học vẫn giữ nguyên.`, 'Xóa'))) return;
  await store.removeFile(id);
  refresh();
});

// =============== Cài đặt ===============
function renderSettings() {
  const d = store.data;
  $('#family').value = d.family.join('\n');
  const accs = Object.values(d.accounts);
  $('#accounts').innerHTML = accs.length ? accs.map((a) => `<div class="list-row">
      <div class="detail" style="min-width:120px">${esc([a.bank, a.typeLabel].filter(Boolean).join(' · '))}</div>
      <input data-acc="${esc(a.key)}" value="${esc(a.name)}" placeholder="${esc(store.accountLabel({ ...a, name: '' }))}" aria-label="Tên tài khoản">
    </div>`).join('') : '<p class="empty">Chưa có tài khoản nào.</p>';
  const rules = d.rules.slice().reverse();
  $('#rules').innerHTML = rules.length ? rules.map((r) => `<div class="list-row">
      <div><div>“${esc(r.key)}”</div><div class="detail">→ ${esc(isCounted(r.kind) ? r.category : KINDS[r.kind])}</div></div>
      <button class="btn small" data-delrule="${esc(r.key)}">Xóa</button>
    </div>`).join('') : '<p class="empty">Chưa có quy tắc nào. Sửa danh mục một giao dịch trong mục Giao dịch để dạy app.</p>';
  renderCategories();
}

function renderCategories() {
  const d = store.data;
  const used = (c) => txs.filter((t) => t.category === c).length;
  const group = (kind, builtIn, title) => `<div class="cat-group"><h3 class="small muted">${title}</h3><div class="chips">
      ${builtIn.filter((c) => c !== UNCATEGORIZED).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}
      ${d.categories[kind].map((c) => `<span class="chip mine">${esc(c)} <button type="button" data-delcat="${esc(c)}" data-kind="${kind}" aria-label="Xóa ${esc(c)}">✕</button></span>`).join('')}
    </div></div>`;
  $('#cats').innerHTML = group('expense', EXPENSE_CATS, 'Chi tiêu') + group('income', INCOME_CATS, 'Thu nhập');
  $('#cats').dataset.used = JSON.stringify(Object.fromEntries([...d.categories.expense, ...d.categories.income].map((c) => [c, used(c)])));
}

$('#catForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#catName').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const all = [...cats().expense, ...cats().income];
  if (all.some((c) => norm(c) === norm(name))) { toast(`Đã có danh mục “${name}”.`); return; }
  await store.addCategory($('#catKind').value, name);
  $('#catName').value = '';
  renderCategories();
  toast(`Đã thêm danh mục “${name}”.`);
});

$('#cats').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-delcat]');
  if (!b) return;
  const name = b.dataset.delcat;
  const n = JSON.parse($('#cats').dataset.used || '{}')[name] || 0;
  const msg = n
    ? `${n} giao dịch đang thuộc “${name}” sẽ quay về phân loại tự động. Quy tắc đã học cho danh mục này cũng bị xóa.`
    : `Chưa có giao dịch nào thuộc “${name}”.`;
  if (!(await confirmBox('Xóa danh mục?', msg, 'Xóa'))) return;
  await store.removeCategory(b.dataset.kind, name);
  refresh();
});

$('#saveFamily').addEventListener('click', async () => {
  store.data.family = [];
  for (const line of $('#family').value.split('\n')) if (line.trim()) store.addFamily(line);
  await store.save();
  refresh();
  toast('Đã lưu danh sách thành viên.');
});

$('#accounts').addEventListener('change', async (e) => {
  const key = e.target.dataset.acc;
  if (!key) return;
  store.data.accounts[key].name = e.target.value.trim();
  await store.save();
  refresh();
});

$('#rules').addEventListener('click', async (e) => {
  const key = e.target.closest('[data-delrule]')?.dataset.delrule;
  if (key == null) return;
  await store.removeRule(key);
  refresh();
});

$('#exportBackup').addEventListener('click', async () => {
  const text = await store.exportBackup();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chi-tieu-backup-${new Date().toISOString().slice(0, 10)}.ctgd`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Đã xuất file backup (đã mã hóa).');
});

$('#importBackup').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const pw = await askSecret('Nhập backup', `Nhập mật khẩu của file "${f.name}". Dữ liệu trong file sẽ được gộp vào dữ liệu hiện có, không ghi đè.`);
  if (!pw) return;
  try {
    const other = await store.readBackup(await f.text(), pw);
    const { added } = await store.mergeData(other);
    refresh();
    toast(`Đã gộp backup: thêm ${added} giao dịch.`);
  } catch (ex) {
    toast(ex.message);
  }
});

$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = (m) => { $('#pwErr').textContent = m; };
  const [o, n, n2] = ['#pwOld', '#pwNew', '#pwNew2'].map((s) => $(s).value);
  if (n.length < 8) return err('Mật khẩu mới cần ít nhất 8 ký tự.');
  if (n !== n2) return err('Hai lần nhập mật khẩu mới không khớp.');
  try {
    await store.changePassword(o, n);
    ['#pwOld', '#pwNew', '#pwNew2'].forEach((s) => { $(s).value = ''; });
    err('');
    toast('Đã đổi mật khẩu. Các file backup cũ vẫn mở bằng mật khẩu cũ.');
  } catch (ex) {
    err(ex.message);
  }
});

$('#wipe').addEventListener('click', async () => {
  const n = Object.keys(store.data.transactions).length;
  if (!(await confirmBox('Xóa toàn bộ dữ liệu?', `Xóa vĩnh viễn ${n} giao dịch, mọi quy tắc và mật khẩu khỏi máy này. Không thể hoàn tác nếu bạn chưa có file backup.`, 'Xóa vĩnh viễn'))) return;
  await store.wipe();
  doLock();
});

// =============== Khoản vay ===============
initLoans({ getTxs: () => txs, toast, confirmBox, refresh });
bindLoanEvents((file, loanId) => handleImage(file, { loanId, loanOnly: true }));
// Enter trong form dài: không đóng hộp thoại (nút đầu là Hủy); trong hộp ghi nhận khoản trả: Lưu.
$('#loanDialog').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.preventDefault(); });
$('#payDialog').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input:not([type="checkbox"])')) { e.preventDefault(); $('#payDialog').close('ok'); }
});

// =============== Khởi động ===============
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Không đăng ký được service worker', e));
}
if (!window.isSecureContext || !crypto.subtle) {
  document.body.innerHTML = '<p style="padding:20px">App cần chạy qua HTTPS (hoặc localhost) để mã hóa dữ liệu.</p>';
} else {
  showLock();
}
