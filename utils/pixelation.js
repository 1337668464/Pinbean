/**
 * 像素化算法 - PinBean 小程序版
 * 移植自 perler-beads/src/utils/pixelation.ts
 */

const { hexToRgb, findClosestPaletteColor } = require('./colorSystem.js');

// 像素化模式
const PixelationMode = {
  Dominant: 'dominant',  // 卡通模式：取众数色（色块纯净）
  Average: 'average'     // 真实模式：取平均色（过渡自然）
};

// 透明像素数据
const transparentColorData = {
  key: 'TRANSPARENT',
  color: '#FFFFFF',
  isExternal: true
};

/**
 * 计算图像指定区域的代表色
 * @param imageData   ImageData 对象（通过 canvas.getImageData 获取）
 * @param startX      区域起始 X
 * @param startY      区域起始 Y
 * @param width       区域宽度
 * @param height      区域高度
 * @param mode        'dominant' | 'average'
 */
function calculateCellRepresentativeColor(imageData, startX, startY, width, height, mode) {
  const data = imageData.data;
  const imgWidth = imageData.width;

  let rSum = 0, gSum = 0, bSum = 0;
  let pixelCount = 0;
  const colorCounts = {};
  let dominantRgb = null;
  let maxCount = 0;

  const endX = Math.min(startX + width, imgWidth);
  const endY = Math.min(startY + height, imageData.height);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * imgWidth + x) * 4;
      // 跳过透明像素（alpha < 128）
      if (data[idx + 3] < 128) continue;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      pixelCount++;

      if (mode === PixelationMode.Average) {
        rSum += r; gSum += g; bSum += b;
      } else {
        // Dominant 模式：统计颜色频率
        const key = `${r},${g},${b}`;
        colorCounts[key] = (colorCounts[key] || 0) + 1;
        if (colorCounts[key] > maxCount) {
          maxCount = colorCounts[key];
          dominantRgb = { r, g, b };
        }
      }
    }
  }

  if (pixelCount === 0) return null;

  if (mode === PixelationMode.Average) {
    return {
      r: Math.round(rSum / pixelCount),
      g: Math.round(gSum / pixelCount),
      b: Math.round(bSum / pixelCount)
    };
  } else {
    return dominantRgb;
  }
}

/**
 * 计算像素化网格
 * @param canvasId      Canvas 组件的 canvas-id
 * @param imgWidth      原图宽度
 * @param imgHeight     原图高度
 * @param N             横向格子数
 * @param M             纵向格子数
 * @param palette       当前活跃调色板
 * @param mode          'dominant' | 'average'
 * @returns             MappedPixel[][] 二维网格数据
 */
function calculatePixelGrid(canvasId, imgWidth, imgHeight, N, M, palette, mode) {
  const ctx = wx.createCanvasContext(canvasId);
  const imageData = ctx.getImageData
    ? ctx.getImageData(0, 0, imgWidth, imgHeight)
    : null;

  if (!imageData) {
    console.error('无法获取图像数据');
    return [];
  }

  const mappedData = Array(M).fill(null).map(() =>
    Array(N).fill({ key: '?', color: '#FFFFFF' })
  );

  const cellW = imgWidth / N;
  const cellH = imgHeight / M;

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < N; i++) {
      const sx = Math.floor(i * cellW);
      const sy = Math.floor(j * cellH);
      const ew = Math.max(1, Math.ceil((i + 1) * cellW) - sx);
      const eh = Math.max(1, Math.ceil((j + 1) * cellH) - sy);

      const representative = calculateCellRepresentativeColor(imageData, sx, sy, ew, eh, mode);

      if (representative) {
        const closest = findClosestPaletteColor(representative, palette);
        mappedData[j][i] = { key: closest.key, color: closest.hex };
      } else {
        mappedData[j][i] = { ...transparentColorData };
      }
    }
  }

  return mappedData;
}

/**
 * 统计各颜色的珠子数量
 * @param mappedData  MappedPixel[][] 网格数据
 * @returns           { [hex]: { count, color } }
 */
function countColors(mappedData) {
  const counts = {};
  for (const row of mappedData) {
    for (const cell of row) {
      if (!cell.isExternal && cell.color) {
        if (!counts[cell.color]) {
          counts[cell.color] = { count: 0, color: cell.color };
        }
        counts[cell.color].count++;
      }
    }
  }
  return counts;
}

module.exports = {
  PixelationMode,
  transparentColorData,
  calculateCellRepresentativeColor,
  calculatePixelGrid,
  countColors
};
