// Công cụ dựng lại bảng từ các mảnh chữ có tọa độ của PDF.
import { parseMoney } from '../util.js';

/** Các mảnh chữ nằm cùng một dòng (lệch y không quá tol), xếp trái → phải. */
export const lineAt = (items, y, tol = 3) =>
  items.filter((i) => Math.abs(i.y - y) <= tol).sort((a, b) => a.x - b.x);

/** Mảnh chữ đầu tiên (từ trên xuống) có chữ chuẩn hóa khớp re, nằm dưới vị trí `below`. */
export const findItem = (items, re, below = -Infinity) => items.find((i) => i.y > below && re.test(i.n));

/** Ghép chữ trong một ô: trên → dưới, trái → phải. */
export const joinCell = (items) =>
  items.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();

/** Số tiền cuối cùng trên một dòng. */
export function lastMoney(line) {
  for (let i = line.length - 1; i >= 0; i--) {
    const v = parseMoney(line[i].s);
    if (v != null) return v;
  }
  return null;
}

/** Giá trị nằm bên phải nhãn trên cùng dòng, dừng ở nhãn kế tiếp (chữ kết thúc bằng ':'). */
export function valueRightOf(items, re) {
  const label = findItem(items, re);
  if (!label) return '';
  const out = [];
  for (const it of lineAt(items, label.y, 3)) {
    if (it.x <= label.x + label.w - 1) continue;
    if (/:\s*$/.test(it.s)) break;
    out.push(it.s);
  }
  return out.join(' ').trim();
}

/**
 * Gán từng mảnh chữ về mốc (dòng giao dịch) gần nhất theo trục y.
 * Ô nhiều dòng trong các sao kê này được căn giữa theo chiều dọc, nên mốc ngày nằm ở giữa dòng.
 * Mốc `marker` (tiêu đề, dòng tổng…) hút các mảnh chữ của nó để chúng không lẫn vào giao dịch.
 */
export function groupByAnchors(items, anchors, maxDist) {
  for (const it of items) {
    let best = null;
    let bd = Infinity;
    for (const a of anchors) {
      const d = Math.abs(a.y - it.y);
      if (d < bd) { bd = d; best = a; }
    }
    if (best && bd <= maxDist && !best.marker) best.items.push(it);
  }
}
