# PinBean 微信小程序

> 项目目录：`projects/pinbean/miniapp/`

---

## 技术架构

```
主线程（UI渲染）
    │
    ├── 用户操作（上传/点击/滑动）
    ├── Canvas 渲染（drawGrid）
    └── wx.createWorker()  →  后台线程
                                      │
                                      ├── pixelate() 像素化算法
                                      └── postMessage() 返回结果
```

**核心改进（v2）：**
- 删除了隐藏的临时 canvas（消除 `removedNode` 渲染层错误）
- 像素计算搬到 Worker 后台线程（消除主线程超时）
- 图片先缩至最大 200px 再处理，计算量可控

---

## 已知限制

1. `wx.canvasGetImageData` 需要基础库 ≥ 2.7.0
2. Worker 调试无法断点，只能靠 console.log
3. 色板切换后需重新生成图纸（暂未做增量更新）
