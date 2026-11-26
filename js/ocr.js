// Đọc chữ trong ảnh ngay trên máy (Tesseract chạy bằng WebAssembly). Ảnh không gửi đi đâu:
// chỉ tải mã thư viện và dữ liệu mô hình chữ từ cdn.jsdelivr.net (lần đầu ~15 MB, sau đó lưu trên máy).
// Dùng hai mô hình: tiếng Việt cho chữ, tiếng Anh cho số (mô hình tiếng Việt hay nhầm 3 thành 5).
const CDN = 'https://cdn.jsdelivr.net/npm/';
const TESS = `${CDN}tesseract.js@5.1.1/dist/tesseract.esm.min.js`;

let workers = null;

function getWorkers() {
  workers ??= (async () => {
    const T = (await import(TESS)).default;
    const opt = (lang) => ({
      workerPath: `${CDN}tesseract.js@5.1.1/dist/worker.min.js`,
      corePath: `${CDN}tesseract.js-core@5.1.0`,
      langPath: `${CDN}@tesseract.js-data/${lang}/4.0.0_best_int`,
    });
    const [vie, eng] = await Promise.all([T.createWorker('vie', 1, opt('vie')), T.createWorker('eng', 1, opt('eng'))]);
    return { vie, eng };
  })().catch((e) => { workers = null; throw e; });
  return workers;
}

/** Giải phóng bộ nhớ (khi khóa app). */
export async function releaseOcr() {
  if (!workers) return;
  const w = workers;
  workers = null;
  try { const { vie, eng } = await w; await Promise.all([vie.terminate(), eng.terminate()]); } catch { /* bỏ qua */ }
}

async function toCanvas(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch {
    throw new Error('Không mở được ảnh này. Hãy dùng ảnh chụp màn hình dạng PNG hoặc JPG.');
  }
  // Ảnh nhỏ thì phóng to cho dễ đọc, ảnh chụp bằng camera quá lớn thì thu nhỏ cho nhanh.
  const scale = bmp.width < 700 ? 2 : bmp.width > 2400 ? 2400 / bmp.width : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

const overlap = (a, b) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Đọc ảnh, trả về các dòng chữ theo thứ tự từ trên xuống:
 * { y0, y1, x0, x1, text, label, value, labelEng, num } — num là chữ của dòng theo mô hình tiếng Anh (số chính xác hơn).
 * label/value: tách tại khoảng trống lớn nhất trong dòng (nhãn bên trái, giá trị bên phải).
 */
export async function readImage(file, onStatus = () => {}) {
  onStatus('Đang tải bộ đọc chữ (lần đầu hơi lâu)…');
  const { vie, eng } = await getWorkers();
  const canvas = await toCanvas(file);
  onStatus('Đang đọc chữ trong ảnh…');
  const [rv, re] = await Promise.all([vie.recognize(canvas), eng.recognize(canvas)]);
  const W = canvas.width;
  const box = (b) => ({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
  const engLines = re.data.lines.map((l) => ({ ...box(l.bbox), words: l.words.map((w) => ({ t: w.text, ...box(w.bbox) })) }));

  const rows = [];
  for (const l of rv.data.lines) {
    const words = l.words.map((w) => ({ t: w.text, ...box(w.bbox) })).filter((w) => w.t.trim());
    if (!words.length) continue;
    const r = box(l.bbox);
    const h = r.y1 - r.y0;
    // Tách nhãn / giá trị tại khoảng trống lớn nhất (nếu đủ rộng).
    let split = -1, gap = 0;
    for (let i = 1; i < words.length; i++) {
      const g = words[i].x0 - words[i - 1].x1;
      if (g > gap) { gap = g; split = i; }
    }
    const hasSplit = gap > Math.max(h * 1.2, W * 0.04);
    const en = engLines.filter((e) => overlap(e, r) > h * 0.4).sort((a, b) => overlap(b, r) - overlap(a, r))[0];
    const engWords = en ? en.words : [];
    const splitX = hasSplit ? words[split].x0 - gap / 2 : null;
    const join = (ws) => ws.map((w) => w.t).join(' ').trim();
    rows.push({
      ...r,
      text: join(words),
      num: join(engWords),
      label: hasSplit ? join(words.slice(0, split)) : '',
      value: hasSplit ? join(words.slice(split)) : '',
      labelEng: hasSplit ? join(engWords.filter((w) => w.x1 <= splitX)) : '',
      valueEng: hasSplit ? join(engWords.filter((w) => w.x0 >= splitX)) : '',
      left: r.x0 < W * 0.3,
    });
  }
  rows.sort((a, b) => a.y0 - b.y0);
  return { rows, width: W, height: canvas.height, text: rows.map((r) => r.text).join('\n') };
}
