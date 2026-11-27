// Kho dữ liệu đã mã hóa. Bản giải mã chỉ nằm trong bộ nhớ khi app đang mở khóa.
// IndexedDB chỉ chứa: 'meta' = { salt, iter } (không bí mật) và 'vault' = { iv, ct } (đã mã hóa).
import * as idb from './idb.js';
import { KDF_ITER, randomBytes, deriveKey, encryptJSON, decryptJSON, toB64, fromB64 } from './crypto.js';
import { norm } from './util.js';

const BACKUP_FORMAT = 'chi-tieu-gia-dinh-backup';

let key = null;
let salt = null;
let iter = KDF_ITER;
export let data = null;

const emptyData = () => ({
  version: 1,
  accounts: {},      // key -> { key, bank, type, typeLabel, accountNo, holder, name }
  transactions: {},  // id -> giao dịch (kèm account, file)
  files: [],         // lịch sử nhập file
  rules: [],         // quy tắc học từ lần sửa tay: { key, kind, category, createdAt }
  overrides: {},     // id giao dịch -> { kind, category } sửa tay riêng từng dòng
  family: [],        // tên chủ tài khoản trong gia đình (chuyển giữa họ = nội bộ)
  categories: { expense: [], income: [] }, // danh mục tự thêm
  savings: { opening: null, asOf: '' },     // số dư tiết kiệm đầu kỳ (tính từ đầu ngày asOf)
  loans: [],         // khoản vay: { id, ...trường thông tin, payments: [{ id, date, amount, principal, interest, note, txId, applied }] }
});

function migrate(d) {
  const base = emptyData();
  for (const k of Object.keys(base)) if (d[k] == null) d[k] = base[k];
  return d;
}

export const hasVault = async () => !!(await idb.get('vault'));
export const isUnlocked = () => !!key;

export async function create(password, initial = null) {
  salt = randomBytes(16);
  iter = KDF_ITER;
  key = await deriveKey(password, salt, iter);
  data = migrate(initial || emptyData());
  await idb.set('meta', { salt, iter, created: Date.now() });
  await save();
}

export async function unlock(password) {
  const meta = await idb.get('meta');
  const vault = await idb.get('vault');
  if (!meta || !vault) throw new Error('Chưa có dữ liệu trên máy này.');
  const k = await deriveKey(password, meta.salt, meta.iter);
  try {
    data = migrate(await decryptJSON(k, vault.iv, vault.ct));
  } catch {
    throw new Error('Mật khẩu không đúng.');
  }
  key = k; salt = meta.salt; iter = meta.iter;
}

export function lock() { key = null; data = null; }

let chain = Promise.resolve();
export function save() {
  const k = key, d = data;
  if (!k || !d) return chain;
  chain = chain.then(async () => {
    const { iv, ct } = await encryptJSON(k, d);
    await idb.set('vault', { iv, ct, savedAt: Date.now() });
  });
  return chain;
}

export async function changePassword(oldPw, newPw) {
  const meta = await idb.get('meta');
  const vault = await idb.get('vault');
  try { await decryptJSON(await deriveKey(oldPw, meta.salt, meta.iter), vault.iv, vault.ct); }
  catch { throw new Error('Mật khẩu hiện tại không đúng.'); }
  await create(newPw, data);
}

export async function wipe() {
  await chain;
  await idb.del('vault');
  await idb.del('meta');
  lock();
}

// ---------- Nhập kết quả đọc file ----------
export function accountLabel(acc) {
  if (!acc) return '';
  if (acc.name) return acc.name;
  const tail = acc.accountNo ? ' ••' + acc.accountNo.slice(-4) : '';
  return `${acc.bank || 'Tài khoản'} ${acc.type === 'credit' ? 'thẻ' : acc.type === 'bank' ? 'TK' : ''}${tail}`.replace(/\s+/g, ' ').trim();
}

export function addFamily(name) {
  const n = norm(name);
  if (n && !data.family.some((f) => norm(f) === n)) data.family.push(name.trim());
}

export async function importResult(r) {
  const accKey = r.accountKey || `${r.bank || r.fileName}|${r.accountType}|${r.accountNo || ''}`;
  data.accounts[accKey] ??= {
    key: accKey, bank: r.bank, type: r.accountType, typeLabel: r.accountTypeLabel,
    accountNo: r.accountNo, holder: r.holder || '', name: '',
  };
  if (r.holder) addFamily(r.holder);
  const fileId = `${r.fileName}|${r.fileSize}|${Date.now()}`;
  let added = 0, dup = 0;
  for (const t of r.transactions) {
    const old = data.transactions[t.id];
    if (old) {
      // Đã có: cập nhật thông tin đọc được (vd. tên món trả góp), giữ tài khoản và file gốc.
      data.transactions[t.id] = { ...t, account: old.account, file: old.file };
      dup++;
      continue;
    }
    data.transactions[t.id] = { ...t, account: accKey, file: fileId };
    added++;
  }
  data.files.push({
    id: fileId, name: r.fileName, size: r.fileSize, importedAt: new Date().toISOString(),
    account: accKey, period: r.period, count: r.transactions.length, added, dup,
    checksOk: r.checks.every((c) => c.ok !== false),
    ...(r.statement && { statement: r.statement }), // thẻ tín dụng: hạn thanh toán, số phải trả, trả góp
  });
  await save();
  return { added, dup };
}

export async function removeFile(fileId) {
  for (const [id, t] of Object.entries(data.transactions)) {
    if (t.file === fileId) { delete data.transactions[id]; delete data.overrides[id]; }
  }
  data.files = data.files.filter((f) => f.id !== fileId);
  await save();
}

// ---------- Sửa tay & quy tắc ----------
export async function setOverride(id, value) {
  if (value) data.overrides[id] = value; else delete data.overrides[id];
  await save();
}

export async function upsertRule(rule) {
  data.rules = data.rules.filter((r) => r.key !== rule.key);
  data.rules.push({ ...rule, createdAt: new Date().toISOString() });
  await save();
}

export async function removeRule(ruleKey) {
  data.rules = data.rules.filter((r) => r.key !== ruleKey);
  await save();
}

// ---------- Danh mục tự thêm ----------
export async function addCategory(kind, name) {
  const list = data.categories[kind];
  if (!list.some((c) => norm(c) === norm(name))) list.push(name);
  await save();
}

/** Xóa danh mục: quy tắc và sửa tay đang dùng nó bị bỏ, giao dịch quay về phân loại tự động. */
export async function removeCategory(kind, name) {
  data.categories[kind] = data.categories[kind].filter((c) => c !== name);
  data.rules = data.rules.filter((r) => r.category !== name);
  for (const [id, o] of Object.entries(data.overrides)) if (o.category === name) delete data.overrides[id];
  await save();
}

export async function setSavings(opening, asOf) {
  data.savings = { opening, asOf };
  await save();
}

// ---------- Khoản vay ----------
const newId = () => toB64(randomBytes(9)).replace(/[+/=]/g, '');

export async function saveLoan(loan) {
  if (!loan.id) loan.id = newId();
  loan.payments ??= [];
  const i = data.loans.findIndex((l) => l.id === loan.id);
  if (i >= 0) data.loans[i] = loan; else data.loans.push(loan);
  await save();
  return loan;
}

export async function removeLoan(id) {
  data.loans = data.loans.filter((l) => l.id !== id);
  await save();
}

/** Ghi nhận một lần trả nợ. applied: trừ phần gốc vào dư nợ, cộng vào số đã trả. */
export async function addLoanPayment(loanId, p, apply) {
  const l = data.loans.find((x) => x.id === loanId);
  const pay = { ...p, id: newId(), applied: false, prev: null };
  if (apply && (p.principal || p.interest)) {
    pay.prev = { outstanding: l.outstanding ?? null, outstandingAsOf: l.outstandingAsOf || '', paidPrincipal: l.paidPrincipal ?? null, paidInterest: l.paidInterest ?? null };
    const paidBefore = l.paidPrincipal ?? (l.disbursed != null && l.outstanding != null ? l.disbursed - l.outstanding : 0);
    if (p.principal) {
      if (l.outstanding != null) l.outstanding = Math.max(0, l.outstanding - p.principal);
      l.paidPrincipal = paidBefore + p.principal;
    }
    if (p.interest) l.paidInterest = (l.paidInterest || 0) + p.interest;
    if (!l.outstandingAsOf || p.date > l.outstandingAsOf) l.outstandingAsOf = p.date;
    pay.applied = true;
  }
  l.payments.push(pay);
  l.payments.sort((a, b) => (a.date < b.date ? 1 : -1));
  await save();
}

/** Xóa một lần trả; nếu đã trừ vào dư nợ thì cộng lại. */
export async function removeLoanPayment(loanId, payId) {
  const l = data.loans.find((x) => x.id === loanId);
  const p = l.payments.find((x) => x.id === payId);
  if (!p) return;
  if (p.applied) {
    if (p.principal) {
      if (l.outstanding != null) l.outstanding += p.principal;
      if (l.paidPrincipal != null) l.paidPrincipal = p.prev?.paidPrincipal ?? Math.max(0, l.paidPrincipal - p.principal);
    }
    if (p.interest && l.paidInterest != null) l.paidInterest = Math.max(0, l.paidInterest - p.interest);
  }
  if (p.prevNext != null) l.nextPayment = p.prevNext;
  l.payments = l.payments.filter((x) => x.id !== payId);
  await save();
}

// ---------- Backup ----------
export async function exportBackup() {
  const { iv, ct } = await encryptJSON(key, data);
  return JSON.stringify({
    format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2-SHA256', iterations: iter, salt: toB64(salt) },
    cipher: 'AES-GCM-256', iv: toB64(iv), ct: toB64(ct),
  });
}

export async function readBackup(text, password) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('File không phải backup của app.'); }
  if (b?.format !== BACKUP_FORMAT) throw new Error('File không phải backup của app.');
  const k = await deriveKey(password, fromB64(b.kdf.salt), b.kdf.iterations);
  try { return migrate(await decryptJSON(k, fromB64(b.iv), fromB64(b.ct))); }
  catch { throw new Error('Sai mật khẩu của file backup, hoặc file đã bị hỏng.'); }
}

/** Gộp backup vào dữ liệu hiện có: thêm cái chưa có, không ghi đè cái đang có. */
export async function mergeData(other) {
  let added = 0;
  for (const [k, a] of Object.entries(other.accounts)) data.accounts[k] ??= a;
  for (const [id, t] of Object.entries(other.transactions)) {
    if (!data.transactions[id]) { data.transactions[id] = t; added++; }
  }
  const fileIds = new Set(data.files.map((f) => f.id));
  for (const f of other.files) if (!fileIds.has(f.id)) data.files.push(f);
  const ruleKeys = new Set(data.rules.map((r) => r.key));
  for (const r of other.rules) if (!ruleKeys.has(r.key)) data.rules.push(r);
  for (const [id, o] of Object.entries(other.overrides)) data.overrides[id] ??= o;
  for (const f of other.family) addFamily(f);
  for (const k of ['expense', 'income']) {
    for (const c of other.categories[k]) if (!data.categories[k].includes(c)) data.categories[k].push(c);
  }
  if (data.savings.opening == null && other.savings.opening != null) data.savings = other.savings;
  for (const l of other.loans) if (!data.loans.some((x) => x.id === l.id)) data.loans.push(l);
  await save();
  return { added };
}
