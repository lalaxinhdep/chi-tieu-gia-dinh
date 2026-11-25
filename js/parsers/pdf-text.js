// Đọc chữ và tọa độ từ PDF bằng pdf.js, chạy hoàn toàn trong trình duyệt.
// Chỉ tải mã thư viện từ CDN (được service worker lưu lại để dùng offline); nội dung file không rời máy.
import { norm } from '../util.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let libPromise;
function lib() {
  libPromise ??= import(PDFJS + 'pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    return m;
  });
  return libPromise;
}

/**
 * @param {ArrayBuffer} buf
 * @param {(retry:boolean)=>Promise<string|null>} askPassword
 * @returns {Promise<Array<{width:number,height:number,items:Array}>>}
 *   items: { s: chữ gốc, n: chữ chuẩn hóa, x, y (từ trên xuống, theo baseline), w, cx }
 */
export async function readPdf(buf, askPassword) {
  const pdfjs = await lib();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });
  let cancelled = false;
  task.onPassword = (update, reason) => {
    const retry = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    Promise.resolve(askPassword(retry)).then((pw) => {
      if (!pw) { cancelled = true; task.destroy(); } else update(pw);
    });
  };

  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (cancelled) throw new Error('Đã bỏ qua file vì chưa nhập mật khẩu.');
    throw new Error('Không mở được PDF: ' + (e?.message || e));
  }

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const [x, y] = pdfjs.Util.applyTransform([it.transform[4], it.transform[5]], vp.transform);
      items.push({ s, n: norm(s), x, y, w: it.width, cx: x + it.width / 2 });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ width: vp.width, height: vp.height, items });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
