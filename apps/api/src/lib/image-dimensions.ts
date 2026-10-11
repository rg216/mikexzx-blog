/*
 * 从文件开头的字节里读出图片的宽高（不解码像素）。上传确认时 API 只下载文件的前 128KB 来读，
 * 不信任浏览器报的尺寸——渲染时这些数字会变成 <img width height> 和 srcset，填错了页面会变形。
 * 各格式的宽高都写在文件头里，位置是固定的或者能顺着结构找到：
 *   PNG   第一个块 IHDR，偏移 16 起 4 字节宽、4 字节高（大端）
 *   GIF   偏移 6 起 2 字节宽、2 字节高（小端）
 *   JPEG  顺着 0xFF 标记段往后找 SOF（帧头），里面有高、宽
 *   WebP  RIFF 容器，按 VP8 / VP8L / VP8X 三种子格式各自的位置读
 *   AVIF  ISO BMFF 容器，找 ispe（图像空间范围）属性
 * 读不出来返回 null（调用方当作"尺寸未知"，不影响图片使用）。
 */

export type Dimensions = { width: number; height: number };

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

function png(b: DataView): Dimensions | null {
  if (b.byteLength < 24 || b.getUint32(0) !== 0x89504e47 || b.getUint32(12) !== 0x49484452) return null;
  return { width: b.getUint32(16), height: b.getUint32(20) };
}

function gif(bytes: Uint8Array, b: DataView): Dimensions | null {
  if (b.byteLength < 10 || !ascii(bytes, 0, 4).startsWith("GIF8")) return null;
  return { width: b.getUint16(6, true), height: b.getUint16(8, true) };
}

function jpeg(b: DataView): Dimensions | null {
  if (b.byteLength < 4 || b.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < b.byteLength) {
    if (b.getUint8(offset) !== 0xff) return null;
    const marker = b.getUint8(offset + 1);
    // 填充字节
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // SOF0–SOF15 是帧头，但 C4（哈夫曼表）、C8（保留）、CC（算术编码表）不是
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.getUint16(offset + 5), width: b.getUint16(offset + 7) };
    }
    offset += 2 + b.getUint16(offset + 2);
  }
  return null;
}

function webp(bytes: Uint8Array, b: DataView): Dimensions | null {
  if (b.byteLength < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  // 各子格式需要的最少字节数不同，分别检查
  if (chunk === "VP8 " && b.byteLength >= 30) {
    // 有损：14 位宽、14 位高（小端），高 2 位是缩放标记
    return { width: b.getUint16(26, true) & 0x3fff, height: b.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L" && b.byteLength >= 25) {
    // 无损：签名 0x2f 之后，14 位宽减一、14 位高减一，紧挨着打包在 4 个字节里
    const bits = b.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && b.byteLength >= 30) {
    // 扩展格式（带透明、动画等）：24 位宽减一、24 位高减一
    const width = 1 + (b.getUint8(24) | (b.getUint8(25) << 8) | (b.getUint8(26) << 16));
    const height = 1 + (b.getUint8(27) | (b.getUint8(28) << 8) | (b.getUint8(29) << 16));
    return { width, height };
  }
  return null;
}

function avif(bytes: Uint8Array, b: DataView): Dimensions | null {
  if (b.byteLength < 16 || ascii(bytes, 4, 4) !== "ftyp") return null;
  // ispe 盒：4 字节长度 + "ispe" + 1 字节版本 + 3 字节标志 + 4 字节宽 + 4 字节高。
  // 完整解析要遍历 meta/iprp/ipco 的嵌套结构；文件头里 "ispe" 这四个字节只会作为盒类型出现，直接查找就够了
  for (let i = 8; i + 16 <= b.byteLength; i++) {
    if (bytes[i] === 0x69 && ascii(bytes, i, 4) === "ispe") {
      return { width: b.getUint32(i + 8), height: b.getUint32(i + 12) };
    }
  }
  return null;
}

export function readImageDimensions(bytes: Uint8Array): Dimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = png(view) ?? gif(bytes, view) ?? jpeg(view) ?? webp(bytes, view) ?? avif(bytes, view);
  // 宽高为 0 说明文件头是坏的
  return result && result.width > 0 && result.height > 0 ? result : null;
}
