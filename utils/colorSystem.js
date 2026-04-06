/**
 * 颜色系统工具 - PinBean 小程序版
 * 移植自 perler-beads/src/utils/colorSystemUtils.ts
 */

// 导入色板数据库
const COLOR_MAPPING = require('./colorMappingData.js');

// 色号系统类型
const ColorSystem = {
  MARD: 'MARD',
  COCO: 'COCO',
  MANMAN: '漫漫',
  PANPAN: '盼盼',
  MIXIAOWO: '咪小窝'
};

// 可用的色号系统选项
const colorSystemOptions = [
  { key: 'MARD', name: 'MARD（欧美）' },
  { key: 'COCO', name: 'COCO（国产）' },
  { key: '漫漫', name: '漫漫' },
  { key: '盼盼', name: '盼盼' },
  { key: '咪小窝', name: '咪小窝' }
];

// RGB 颜色距离计算（欧氏距离）
function colorDistance(rgb1, rgb2) {
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Hex → RGB
function hexToRgb(hex) {
  const clean = hex.replace('#', '').toUpperCase();
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

// RGB → Hex
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase();
}

// 根据 Hex 获取指定色号系统的色号
function getColorKeyByHex(hexValue, colorSystem) {
  const normalized = hexValue.toUpperCase();
  const mapping = COLOR_MAPPING[normalized];
  if (mapping && mapping[colorSystem]) {
    return mapping[colorSystem];
  }
  return '?'; // 找不到时显示问号
}

// 获取对比色（白/黑，用于色号文字）
function getContrastColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  // Luma 公式
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma > 0.5 ? '#000000' : '#FFFFFF';
}

// 构建完整的调色板（从 COLOR_MAPPING）
function buildFullPalette(colorSystem) {
  const palette = [];
  const seen = new Set();
  for (const [hex, systems] of Object.entries(COLOR_MAPPING)) {
    const key = systems[colorSystem];
    if (key && !seen.has(key)) {
      seen.add(key);
      const rgb = hexToRgb(hex);
      if (rgb) {
        palette.push({ key, hex, rgb });
      }
    }
  }
  return palette;
}

// 在调色板中找最接近的颜色
function findClosestPaletteColor(targetRgb, palette) {
  if (!palette || palette.length === 0) {
    return { key: '?', hex: '#000000', rgb: { r: 0, g: 0, b: 0 } };
  }
  let minDist = Infinity;
  let closest = palette[0];
  for (const color of palette) {
    const dist = colorDistance(targetRgb, color.rgb);
    if (dist < minDist) {
      minDist = dist;
      closest = color;
    }
    if (dist === 0) break;
  }
  return closest;
}

module.exports = {
  ColorSystem,
  colorSystemOptions,
  colorDistance,
  hexToRgb,
  rgbToHex,
  getColorKeyByHex,
  getContrastColor,
  buildFullPalette,
  findClosestPaletteColor
};
