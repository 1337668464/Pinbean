// app.js
App({
  globalData: {
    // 全局色板系统，默认为 MARD
    selectedColorSystem: 'MARD',
    // 当前活跃的调色板（根据用户选择的色板系统）
    activePalette: [],
    // 用户自定义色板
    customPaletteSelections: []
  },

  onLaunch() {
    // 从本地存储恢复用户设置
    const savedSystem = wx.getStorageSync('selectedColorSystem');
    if (savedSystem) {
      this.globalData.selectedColorSystem = savedSystem;
    }
  }
})
