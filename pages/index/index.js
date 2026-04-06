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
    pixelationMode: 'dominant',
    generating: false,
    gridData: null,
    colorList: [],
    totalCount: 0,
    canvasWidth: 300,
    canvasHeight: 300,
    statusText: '',
  },

  _timer: null,

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

  onGranularityChange(e) { this.setData({ granularity: e.detail.value }); },
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
            this.setData({
              gridData: result.grid,
              colorList: result.list,
              totalCount: result.total,
              canvasWidth: N * 6,
              canvasHeight: M * 6,
              generating: false,
              statusText: '',
            });
            this._drawGrid(result.grid, N, M);
          },
          fail: err => {
            console.error('canvasGetImageData 失败:', err);
            this.setData({ generating: false, statusText: '处理失败，请重试' });
            wx.showToast({ title: '不支持此图片，请换一张', icon: 'none' });
          },
        });
      }, 500); // 等待足够时间让 draw 完成
    });

    // 20秒超时
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.setData({ generating: false, statusText: '处理超时' });
      wx.showToast({ title: '处理超时，请换一张图片', icon: 'none' });
    }, 20000);
  },

  // ---- 绘制网格到 canvas ----
  _drawGrid(grid, N, M) {
    const cell = 6;
    const ctx = wx.createCanvasContext('gridCanvas');
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
