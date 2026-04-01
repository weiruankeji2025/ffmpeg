# 威软FFmpeg - 在线视频音频处理工具

基于 **FFmpeg.wasm**（WebAssembly）的纯前端在线多媒体处理工具。所有文件在本地浏览器中处理，不上传至任何服务器，完全保护用户隐私。

## 功能特性

| 功能 | 描述 |
|------|------|
| 🔄 格式转换 | 支持 MP4、WebM、AVI、MOV、MKV、MP3、AAC、WAV、FLAC 等主流格式互转 |
| 📦 视频压缩 | 调整 CRF 质量参数和编码预设，显著减小文件体积 |
| ✂️ 视频裁剪 | 按时间点精确裁剪视频片段，支持快速复制流或重新编码 |
| 🎵 提取音频 | 从视频中提取音轨，支持多种音频格式和码率选项 |
| ↔️ 调整尺寸 | 缩放视频分辨率，内置 4K/1080p/720p 等预设 |
| 🔗 视频合并 | 将两个视频文件拼接为一个，支持快速合并和重新编码 |
| 🖼️ 转为 GIF | 将视频片段转换为高质量 GIF 动图（双通道调色板优化） |
| 💧 添加水印 | 为视频添加文字水印，可自定义位置、字体、颜色和透明度 |
| 🔍 媒体信息 | 查看文件的详细媒体信息（编码、分辨率、码率、时长等） |
| ⌨️ 自定义命令 | 高级用户可直接输入任意 FFmpeg 参数执行 |

## 技术栈

- **FFmpeg.wasm 0.12.6** — 将 FFmpeg 编译为 WebAssembly 在浏览器中运行
- **纯原生 JS/HTML/CSS** — 无框架依赖，轻量快速
- **现代暗色 UI** — GitHub 风格暗色主题，响应式布局

## 使用说明

1. 直接用浏览器打开 `index.html`（推荐通过本地 HTTP 服务器）
2. 由于 FFmpeg.wasm 需要 `SharedArrayBuffer`，建议通过以下方式启用：
   - **Chrome/Edge** 默认支持（需启用 COOP/COEP 响应头）
   - 本地开发可用 `npx serve .` 或 `python -m http.server`

```bash
# 快速启动本地服务
npx serve .
# 或
python3 -m http.server 8080
```

## 项目结构

```
ffmpeg/
├── index.html          # 主页面
├── css/
│   └── style.css       # 暗色主题样式
├── js/
│   └── app.js          # 核心逻辑 (FFmpeg.wasm 集成)
└── README.md
```

## 隐私说明

本工具完全在浏览器本地运行，不会将您的文件上传到任何服务器。所有处理均通过 WebAssembly 在您的设备上完成。

---

**威软FFmpeg** &copy; 2024 · Powered by [FFmpeg.wasm](https://ffmpegwasm.netlify.app/)
