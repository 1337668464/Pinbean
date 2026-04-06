// pages/index/index.js
// 核心思路：所有处理在主线程，用 wx.canvasGetImageData（官方支持的API）
const { colorSystemOptions, getColorKeyByHex, getContrastColor } = require('../../utils/colorSystem.js');
const COLOR_MAPPING = require('../../utils/colorMappingData.js');

Page({
  data: {
    colorSystems: colorSystemOptions,
    currentSystem: 'MARD',
    hasImage: false,
    imagePath: '',
    imageWidth: 0,
    imageHeight: 0,
    granularity: 50,
    displayGranularity: 50, // 实时显示的格数（拖动时更新）
    pixelationMode: 'dominant',
    generating: false,
    countdown: 0, // 问题1：倒计时
    gridData: null,
    colorList: [],
    totalCount: 0,
    canvasWidth: 300,
    canvasHeight: 300,
    scaledCanvasWidth: 300,
    scaledCanvasHeight: 300,
    statusText: '',
    // 问题4：图纸导出
    exportGrid: null,
    exportN: 0,
    exportM: 0,
    exportColorList: [],
    exportTotal: 0,
    exportSystem: 'MARD',
  },

  _timer: null,
  _countdownTimer: null,

  onLoad() {
    const saved = wx.getStorageSync('selectedColorSystem');
    if (saved) this.setData({ currentSystem: saved });
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer);
  },

  // ---- 颜色工具 ----

  _hexToRgb(hex) {
    const c = hex.replace('#', '').toUpperCase();
    return c.length !== 6 ? null : {
      r: parseInt(c.substring(0, 2), 16),
      g: parseInt(c.substring(2, 4), 16),
      b: parseInt(c.substring(4, 6), 16),
    };
  },

  _colorDist(a, b) {
    return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
  },

  _buildPalette(cs) {
    const p = [], seen = {};
    for (const [hex, sys] of Object.entries(COLOR_MAPPING)) {
      const k = sys[cs];
      if (k && !seen[k]) {
        seen[k] = true;
        const rgb = this._hexToRgb(hex);
        if (rgb) p.push({ key: k, hex, rgb });
      }
    }
    return p;
  },

  _closest(rgb, palette) {
    let best = palette[0] || { key: '?', hex: '#000', rgb: {r:0,g:0,b:0} }, bestD = Infinity;
    for (const c of palette) {
      const d = this._colorDist(rgb, c.rgb);
      if (d < bestD) { bestD = d; best = c; }
      if (d === 0) break;
    }
    return best;
  },

  // ---- 像素化（同步，50x50约30ms）----
  _pixelate(imgData, W, H, N, M, cs, mode) {
    const d = imgData.data;
    const pal = this._buildPalette(cs);
    const grid = Array.from({length: M}, () => Array.from({length: N}, () => ({color:'#FFF',key:'?'})));
    const cw = W/N, ch = H/M;

    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const sx = Math.floor(i*cw), sy = Math.floor(j*ch);
        const ew = Math.max(1, Math.ceil((i+1)*cw) - sx);
        const eh = Math.max(1, Math.ceil((j+1)*ch) - sy);
        const cnt = {}; let max = 0, dom = null, rS=0, gS=0, bS=0, n=0;
        for (let dy = 0; dy < eh; dy++) {
          for (let dx = 0; dx < ew; dx++) {
            const px = sx+dx, py = sy+dy;
            if (px >= W || py >= H) continue;
            const idx = (py*W+px)*4;
            if (d[idx+3] < 128) continue;
            const r=d[idx], g=d[idx+1], b=d[idx+2]; n++;
            if (mode === 'average') { rS+=r; gS+=g; bS+=b; }
            else {
              const k = `${r},${g},${b}`;
              cnt[k] = (cnt[k]||0) + 1;
              if (cnt[k] > max) { max = cnt[k]; dom = {r,g,b}; }
            }
          }
        }
        if (!n) { grid[j][i] = {color:'#FFF',key:'?'}; continue; }
        let rgb;
        if (mode === 'average') rgb = {r:Math.round(rS/n), g:Math.round(gS/n), b:Math.round(bS/n)};
        else rgb = dom || {r:0,g:0,b:0};
        const c = this._closest(rgb, pal);
        grid[j][i] = { color: c.hex, key: c.key };
      }
    }

    const counts = {};
    for (const row of grid)
      for (const cell of row) {
        if (!counts[cell.color]) counts[cell.color] = 0;
        counts[cell.color]++;
      }
    let total = 0;
    const list = Object.entries(counts).map(([hex, count]) => {
      total += count;
      return { hex, color: hex, key: (COLOR_MAPPING[hex]||{})[cs]||'?', count };
    });
    list.sort((a,b) => b.count - a.count);
    return { grid, list, total, N, M };
  },

  // ---- UI 事件 ----

  onSelectColorSystem(e) {
    this.setData({ currentSystem: e.currentTarget.dataset.system });
    wx.setStorageSync('selectedColorSystem', e.currentTarget.dataset.system);
  },

  onChooseImage() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const path = res.tempFiles[0].tempFilePath;
        wx.getImageInfo({
          src: path,
          success: info => this.setData({
            imagePath: path,
            imageWidth: info.width,
            imageHeight: info.height,
            hasImage: true,
            gridData: null,
          }),
        });
      },
    });
  },

  // 问题2：拖动中实时更新格数
  onGranularityChanging(e) {
    this.setData({ displayGranularity: e.detail.value });
  },
  onGranularityChange(e) {
    this.setData({ granularity: e.detail.value, displayGranularity: e.detail.value });
  },
  onModeChange(e) { this.setData({ pixelationMode: e.detail.value }); },

  // ---- 生成 ----

  onGenerate() {
    if (!this.data.hasImage) return;
    this.setData({ generating: true, statusText: '准备处理...' });

    const { imagePath, imageWidth, imageHeight, granularity, pixelationMode, currentSystem } = this.data;

    // 缩放尺寸
    let W = imageWidth, H = imageHeight, max = 200;
    if (W > max || H > max) {
      if (W >= H) { W = max; H = Math.round(imageHeight * max / imageWidth); }
      else { H = max; W = Math.round(imageWidth * max / imageHeight); }
    }

    // 网格
    let N = Math.min(granularity, 100), M;
    if (W >= H) M = Math.round(H / (W/N));
    else { const tmp = N; N = Math.round(W / (H/tmp)); M = tmp; }
    N = Math.max(N,1); M = Math.max(M,1);

    this.setData({ statusText: `处理中 ${N}×${M}...` });

    // 在 __process_canvas__ 上绘制并获取像素数据
    const ctx = wx.createCanvasContext('__process_canvas__');
    ctx.drawImage(imagePath, 0, 0, W, H);
    ctx.draw(true, () => {
      setTimeout(() => {
        wx.canvasGetImageData({
          canvasId: '__process_canvas__',
          x: 0, y: 0, width: W, height: H,
          success: imgData => {
            // 像素化
            const result = this._pixelate(imgData, W, H, N, M, currentSystem, pixelationMode);
            // 问题3：canvas 尺寸限制最大 600px，等比缩放
            const rawW = N * 6, rawH = M * 6;
            const maxSize = 600;
            const scale = Math.min(1, maxSize / Math.max(rawW, rawH));
            clearInterval(this._countdownTimer);
            this.setData({
              gridData: result.grid,
              colorList: result.list,
              totalCount: result.total,
              canvasWidth: Math.round(rawW * scale),
              canvasHeight: Math.round(rawH * scale),
              scaledCanvasWidth: rawW,
              scaledCanvasHeight: rawH,
              generating: false,
              countdown: 0,
              statusText: '',
              // 问题4：保存时用的原始数据
              exportGrid: result.grid,
              exportN: N,
              exportM: M,
              exportColorList: result.list,
              exportTotal: result.total,
              exportSystem: currentSystem,
            });
            this._drawGrid(result.grid, N, M, scale);
          },
          fail: err => {
            console.error('canvasGetImageData 失败:', err);
            this.setData({ generating: false, statusText: '处理失败，请重试' });
            wx.showToast({ title: '不支持此图片，请换一张', icon: 'none' });
          },
        });
      }, 500); // 等待足够时间让 draw 完成
    });

    // 问题1：30秒超时 + 倒计时
    let remaining = 30;
    this.setData({ countdown: remaining, statusText: `处理中 ${N}×${M}，剩余 ${remaining}s...` });
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this._countdownTimer);
        return;
      }
      this.setData({ countdown: remaining, statusText: `处理中 ${N}×${M}，剩余 ${remaining}s...` });
    }, 1000);
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      clearInterval(this._countdownTimer);
      this.setData({ generating: false, countdown: 0, statusText: '处理超时' });
      wx.showToast({ title: '处理超时，请换一张图片', icon: 'none' });
    }, 30000);
  },

  // ---- 绘制网格到 canvas ----
  // 问题3：支持 scale 缩放，scale=1 时保持真实 6px/格
  _drawGrid(grid, N, M, scale = 1) {
    const cell = 6;
    const W = Math.round(N * cell * scale);
    const H = Math.round(M * cell * scale);
    const ctx = wx.createCanvasContext('gridCanvas');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, N*cell, M*cell);
    ctx.strokeStyle = '#DDDDDD'; ctx.lineWidth = 0.3;
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < N; i++) {
        const { color } = grid[j][i];
        ctx.fillStyle = color;
        ctx.fillRect(i*cell, j*cell, cell, cell);
        ctx.strokeRect(i*cell+0.3, j*cell+0.3, cell, cell);
      }
    }
    ctx.draw(true);
  },

  // ---- 问题4：绘制带表头的导出图纸（真实尺寸，不缩放）----
  _drawExportCanvas() {
    const { exportGrid, exportN, exportM, exportColorList, exportTotal, exportSystem, currentSystem } = this.data;
    if (!exportGrid) return;
    const cell = 6;
    const headerH = 60, footerH = Math.min(exportColorList.length * 28 + 40, 400);
    const W = exportN * cell, H = exportM * cell;
    const totalH = headerH + H + footerH;
    const ctx = wx.createCanvasContext('exportCanvas');
    // 背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, totalH);
    // 表头
    ctx.fillStyle = '#1A1A2E';
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`PinBean 拼豆图纸`, 12, 24);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`规格：${exportN}×${exportM}格 | 比例：${cell}px/格 | 色板：${currentSystem} | 共${exportTotal}颗`, 12, 44);
    // 网格
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, headerH, W, H);
    ctx.strokeStyle = '#DDDDDD'; ctx.lineWidth = 0.3;
    for (let j = 0; j < exportM; j++) {
      for (let i = 0; i < exportN; i++) {
        const { color } = exportGrid[j][i];
        ctx.fillStyle = color;
        ctx.fillRect(i*cell, headerH + j*cell, cell, cell);
        ctx.strokeRect(i*cell+0.3, headerH + j*cell+0.3, cell, cell);
      }
    }
    // 颜色统计
    const fy = headerH + H + 12;
    ctx.fillStyle = '#1A1A2E';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('颜色对照表', 12, fy);
    ctx.font = '12px sans-serif';
    exportColorList.slice(0, 20).forEach((c, idx) => {
      const y = fy + 20 + idx * 26;
      ctx.fillStyle = c.hex;
      ctx.fillRect(12, y - 12, 18, 18);
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.5;
      ctx.strokeRect(12, y - 12, 18, 18);
      ctx.fillStyle = '#333';
      ctx.fillText(`${c.key}  ${c.hex}  ${c.count}颗`, 36, y + 2);
    });
    if (exportColorList.length > 20) {
      ctx.fillStyle = '#888';
      ctx.font = '12px sans-serif';
      ctx.fillText(`... 还有 ${exportColorList.length - 20} 种颜色`, 12, fy + 20 + 20 * 26);
    }
    ctx.draw(true);
  },

  // 问题4：保存带表头表尾的图纸
  onExportWithLegend() {
    wx.showLoading({ title: '生成图纸...' });
    const { exportN, exportM } = this.data;
    const cell = 6;
    const headerH = 60, footerH = Math.min(this.data.exportColorList.length * 28 + 40, 400);
    const W = exportN * cell, H = exportM * cell;
    this.setData({ exportCanvasW: W, exportCanvasH: headerH + H + footerH }, () => {
      setTimeout(() => {
        this._drawExportCanvas();
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvasId: 'exportCanvas',
            success: res => wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => { wx.hideLoading(); wx.showToast({ title: '已保存图纸到相册', icon: 'success' }); },
              fail: err => { wx.hideLoading(); wx.showToast({ title: '保存失败，请授权', icon: 'none' }); },
            }),
            fail: () => { wx.hideLoading(); wx.showToast({ title: '导出失败', icon: 'none' }); },
          });
        }, 600);
      }, 100);
    });
  },

  // 原保存按钮改为保存纯图纸（无表头）
  onSaveImage() {
    wx.canvasToTempFilePath({
      canvasId: 'gridCanvas',
      success: res => wx.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: () => wx.showToast({ title: '保存失败，请授权', icon: 'none' }),
      }),
    });
  },

  // 问题4：新按钮：保存带颜色说明的完整图纸
  onSaveWithLegend() {
    if (!this.data.exportGrid) {
      wx.showToast({ title: '先生成图纸', icon: 'none' }); return;
    }
    this.onExportWithLegend();
  },

  onShare() {
    wx.showShareMenu({ withShareTicket: true });
    wx.canvasToTempFilePath({
      canvasId: 'gridCanvas',
      success: () => wx.showModal({
        title: '图纸已生成',
        content: '长按图片保存到相册，再分享给好友',
        confirmText: '知道了', showCancel: false,
      }),
    });
  },
});
