/**
 * 威软FFmpeg - Online FFmpeg Tool
 * Powered by FFmpeg.wasm (WebAssembly)
 * Author: 威软 (Weiruan)
 */

'use strict';

// ================================================================
// CDN 配置（多源自动降级：jsDelivr → unpkg）
// ================================================================

const CDN_LIBS = [
  {
    name: 'FFmpegWASM',
    urls: [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',
    ],
  },
  {
    name: 'FFmpegUtil',
    urls: [
      'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/util.js',
      'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/util.js',
    ],
  },
];

const CDN_CORE_LIST = [
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.4/dist/umd',
  'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd',
];

// ================================================================
// GLOBALS（声明，实际赋值在库加载后）
// ================================================================

let FFmpeg, fetchFile, toBlobURL;
let ffmpeg = null;
let isLoaded = false;
let isProcessing = false;

let inputFile = null;
let inputFile2 = null;

const $ = (id) => document.getElementById(id);

// ================================================================
// 动态加载脚本（带 CDN 降级）
// ================================================================

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error(`加载失败：${url}`));
    document.head.appendChild(s);
  });
}

async function loadLibsWithFallback() {
  // --- 1. 加载 @ffmpeg/ffmpeg（必须，无法内置替代）---
  if (typeof window.FFmpegWASM === 'undefined') {
    let loaded = false;
    for (const url of CDN_LIBS[0].urls) {
      try {
        log(`加载 FFmpegWASM（${new URL(url).hostname}）…`, 'info');
        await loadScript(url);
        if (typeof window.FFmpegWASM !== 'undefined') {
          log('FFmpegWASM 加载成功 ✓', 'info');
          loaded = true;
          break;
        }
      } catch (e) {
        log('CDN 不可用，切换备用源…', 'warn');
      }
    }
    if (!loaded) throw new Error('所有 CDN 均无法加载 FFmpegWASM，请检查网络后刷新重试');
  }
  FFmpeg = window.FFmpegWASM.FFmpeg;

  // --- 2. 加载 @ffmpeg/util（可选，CDN 失败时使用内置实现）---
  if (typeof window.FFmpegUtil === 'undefined') {
    let loaded = false;
    for (const url of CDN_LIBS[1].urls) {
      try {
        log(`加载 FFmpegUtil（${new URL(url).hostname}）…`, 'info');
        await loadScript(url);
        if (typeof window.FFmpegUtil !== 'undefined') {
          log('FFmpegUtil 加载成功 ✓', 'info');
          loaded = true;
          break;
        }
      } catch (e) {
        log('FFmpegUtil CDN 不可用，切换备用源…', 'warn');
      }
    }
    if (!loaded) {
      log('FFmpegUtil 所有 CDN 不可用，启用内置实现 ✓', 'warn');
    }
  }

  if (typeof window.FFmpegUtil !== 'undefined') {
    fetchFile = window.FFmpegUtil.fetchFile;
    toBlobURL = window.FFmpegUtil.toBlobURL;
  } else {
    // 内置实现：功能等价于 @ffmpeg/util
    fetchFile = async (input) => {
      if (typeof input === 'string') {
        const res = await fetch(input);
        if (!res.ok) throw new Error(`fetchFile: HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      }
      // File / Blob / BufferSource
      if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
      if (input instanceof ArrayBuffer) return new Uint8Array(input);
      if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      throw new Error('fetchFile: 不支持的输入类型');
    };
    toBlobURL = async (url, mimeType) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`toBlobURL: HTTP ${res.status} ${url}`);
      const blob = new Blob([await res.arrayBuffer()], { type: mimeType });
      return URL.createObjectURL(blob);
    };
  }
}

// ================================================================
// INIT
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initUpload();
  initUrlDownload();
  initRunButtons();
  initRangeDisplays();
  loadFFmpeg();
});

// ================================================================
// NAVIGATION
// ================================================================

function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      $(`tab-${tab}`)?.classList.add('active');

      // Show second file slot for merge
      const file2Row = $('file2Row');
      if (tab === 'merge') {
        file2Row.classList.remove('hidden');
      } else {
        file2Row.classList.add('hidden');
      }

      clearDownload();
    });
  });
}

// ================================================================
// UPLOAD
// ================================================================

function initUpload() {
  const zone = $('uploadZone');
  const input = $('fileInput');
  const uploadLink = $('uploadLink');
  const changeFileBtn = $('changeFileBtn');
  const changeFile2Btn = $('changeFile2Btn');

  // Click on link → open file dialog
  uploadLink.addEventListener('click', () => input.click());
  changeFileBtn.addEventListener('click', () => input.click());
  changeFile2Btn.addEventListener('click', () => {
    const input2 = document.createElement('input');
    input2.type = 'file';
    input2.accept = 'video/*,audio/*';
    input2.onchange = (e) => {
      if (e.target.files[0]) setFile2(e.target.files[0]);
    };
    input2.click();
  });

  // File input change
  input.addEventListener('change', (e) => {
    if (e.target.files[0]) setFile(e.target.files[0]);
    input.value = '';
  });

  // Drag & Drop
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length >= 1) setFile(files[0]);
    if (files.length >= 2) setFile2(files[1]);
  });
}

function setFile(file) {
  inputFile = file;
  updateFilePreview(file, 'fileThumb', 'fileName', 'fileMeta');
  $('uploadInner').classList.add('hidden');
  $('filePreview').classList.remove('hidden');
  clearDownload();
  log(`已选择文件：${file.name} (${formatSize(file.size)})`, 'info');
}

function setFile2(file) {
  inputFile2 = file;
  updateFilePreview(file, 'file2Thumb', 'file2Name', 'file2Meta');
  log(`已选择第二个文件：${file.name} (${formatSize(file.size)})`, 'info');
}

function updateFilePreview(file, thumbId, nameId, metaId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const thumb = $(thumbId);

  if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
    const url = URL.createObjectURL(file);
    thumb.innerHTML = `<img src="${url}" alt="preview" />`;
  } else if (['mp4','webm','ogv','avi','mov','mkv','flv','ts'].includes(ext)) {
    thumb.textContent = '🎬';
  } else if (['mp3','aac','wav','flac','ogg','m4a','opus'].includes(ext)) {
    thumb.textContent = '🎵';
  } else {
    thumb.textContent = '📄';
  }

  $(nameId).textContent = file.name;
  $(metaId).textContent = `${formatSize(file.size)} · ${file.type || '未知类型'} · 修改于 ${new Date(file.lastModified).toLocaleDateString()}`;
}

// ================================================================
// URL DOWNLOAD
// ================================================================

// CORS proxy options (user can choose)
const CORS_PROXY = 'https://corsproxy.io/?';

function initUrlDownload() {
  function on(id, event, fn) {
    const el = $(id);
    if (el) el.addEventListener(event, fn);
  }

  // Source tabs
  on('tabLocal', 'click', () => switchSource('local'));
  on('tabUrl',   'click', () => switchSource('url'));

  // Example URL button
  on('exampleUrlBtn', 'click', () => {
    const inp = $('urlInput');
    if (inp) inp.value = 'https://www.w3schools.com/html/mov_bbb.mp4';
    toast('已填入示例URL，点击"获取文件"下载', 'info');
  });

  // Fetch button
  on('fetchUrlBtn', 'click', () => {
    const url = ($('urlInput') || {}).value?.trim();
    if (!url) { toast('请输入文件URL', 'error'); return; }
    fetchFromUrl(url);
  });

  on('urlInput', 'keydown', (e) => {
    if (e.key === 'Enter') {
      const url = ($('urlInput') || {}).value?.trim();
      if (url) fetchFromUrl(url);
    }
  });

  // 粘贴时自动提取 URL（兼容粘贴完整 ffmpeg 命令的情况）
  on('urlInput', 'paste', (e) => {
    setTimeout(() => {
      const inp = $('urlInput');
      if (!inp) return;
      const extracted = extractUrlFromFfmpegCmd(inp.value);
      if (extracted !== inp.value) {
        inp.value = extracted;
        inp.dispatchEvent(new Event('input'));
      }
    }, 0);
  });
}

/**
 * 如果用户粘贴的是完整 ffmpeg 命令（如 ffmpeg -i "url" ...），
 * 自动提取 -i 参数后的 URL；否则原样返回。
 */
function extractUrlFromFfmpegCmd(input) {
  input = input.trim();
  // 匹配 -i "url" 或 -i 'url' 或 -i url（无引号）
  const m = input.match(/(?:^|\s)-i\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (m) {
    const extracted = m[1] || m[2] || m[3];
    if (extracted && /^https?:\/\//i.test(extracted)) return extracted;
  }
  // 如果整个字符串不像 URL 但包含 http，尝试提取第一个 http URL
  if (!/^https?:\/\//i.test(input)) {
    const urlMatch = input.match(/https?:\/\/[^\s"']+/);
    if (urlMatch) return urlMatch[0];
  }
  return input;
}

async function fetchFromUrl(rawUrl) {
  const fetchBtn = $('fetchUrlBtn');

  // 自动从粘贴的 ffmpeg 命令中提取 URL（如 ffmpeg -i "url" ...）
  rawUrl = extractUrlFromFfmpegCmd(rawUrl);

  // 更新输入框显示提取结果
  const inp = $('urlInput');
  if (inp && inp.value.trim() !== rawUrl) inp.value = rawUrl;

  // 校验 URL
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('仅支持 HTTP / HTTPS 协议');
    }
  } catch (e) {
    toast(`无效的URL：${e.message}`, 'error');
    log(`URL 解析失败：${e.message}`, 'err');
    log('请确认输入的是完整的 HTTP/HTTPS 链接，例如：https://example.com/video.mp4', 'warn');
    return;
  }

  // m3u8 / HLS 流：浏览器无法直接下载，需要用 FFmpeg 自定义命令处理
  if (rawUrl.includes('.m3u8') || rawUrl.includes('m3u8')) {
    clearLog();
    log('检测到 HLS/m3u8 流地址 🎵', 'info');
    log('浏览器无法直接下载 HLS 分片流，请使用「自定义命令」标签页：', 'warn');
    log(`示例命令（切换到侧边栏「自定义命令」标签页后粘贴）：`, 'warn');
    log(`-i "${rawUrl}" -c copy output.mp4`, 'info');
    // 自动跳转到自定义命令 Tab 并填入命令
    const customCmd = $('customCmd');
    if (customCmd) customCmd.value = `-i "${rawUrl}" -c copy output.mp4`;
    // 切换到 custom tab
    document.querySelector('[data-tab="custom"]')?.click();
    toast('已跳转到自定义命令，直接点击「执行命令」', 'info');
    return;
  }

  const useCorsProxy = $('useCorsProxy').checked;
  const targetUrl = useCorsProxy
    ? `${CORS_PROXY}${encodeURIComponent(rawUrl)}`
    : rawUrl;

  fetchBtn.disabled = true;
  fetchBtn.innerHTML = '<span class="spinner"></span> 下载中…';

  clearLog();
  setProgress(0, '连接中…');
  log(`下载地址：${rawUrl}`, 'info');
  if (useCorsProxy) log(`通过 CORS 代理：${CORS_PROXY}`, 'warn');

  try {
    const response = await fetch(targetUrl);

    if (!response.ok) {
      throw new Error(`服务器返回 HTTP ${response.status}: ${response.statusText}`);
    }

    // Detect filename from Content-Disposition or URL
    let filename = guessFilename(rawUrl, response.headers.get('Content-Disposition'));
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';

    // Stream download with progress (if Content-Length is available)
    const contentLength = response.headers.get('Content-Length');
    const totalBytes = contentLength ? parseInt(contentLength) : 0;

    log(`文件名：${filename}`, 'info');
    if (totalBytes) log(`文件大小：${formatSize(totalBytes)}`, 'info');
    else log('文件大小：未知（服务器未提供 Content-Length）', 'warn');

    let receivedBytes = 0;
    const chunks = [];

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      if (totalBytes > 0) {
        const pct = Math.round((receivedBytes / totalBytes) * 90);
        setProgress(pct, `下载中… ${formatSize(receivedBytes)} / ${formatSize(totalBytes)}`);
      } else {
        setProgress(50, `下载中… ${formatSize(receivedBytes)}`);
      }
    }

    setProgress(95, '处理文件…');

    // Merge chunks into Blob → File
    const blob = new Blob(chunks, { type: contentType.split(';')[0] });
    const file = new File([blob], filename, {
      type: blob.type,
      lastModified: Date.now()
    });

    setProgress(100, '下载完成');
    log(`下载完成：${filename} (${formatSize(file.size)})`, 'info');

    setFile(file);
    toast(`文件已就绪：${filename}`, 'success');

    // Switch back to file-preview mode
    switchSource('local');  // keeps UI consistent

  } catch (err) {
    const isCors = err.message.includes('Failed to fetch')
      || err.name === 'TypeError'
      || err.message.toLowerCase().includes('cors');

    if (isCors && !useCorsProxy) {
      log(`跨域错误（CORS）：无法直接访问该URL。`, 'err');
      log('解决方案：勾选"使用 CORS 代理"后重试。', 'warn');
      toast('跨域受限，请勾选 CORS 代理后重试', 'error');
    } else {
      log(`下载失败：${err.message}`, 'err');
      toast(`下载失败：${err.message}`, 'error');
    }
    setProgress(0, '下载失败');
  }

  fetchBtn.disabled = false;
  fetchBtn.innerHTML = '⬇️ 获取文件';
}

function guessFilename(urlStr, contentDisposition) {
  // Try Content-Disposition header first
  if (contentDisposition) {
    const match = contentDisposition.match(/filename[^;=\n]*=\s*(['"]?)([^'";\n]+)\1/i);
    if (match && match[2]) return decodeURIComponent(match[2].trim());
  }
  // Fallback: extract from URL path
  try {
    const u = new URL(urlStr);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.includes('.')) return decodeURIComponent(last);
  } catch (e) { /* ignore */ }
  return `download_${Date.now()}.mp4`;
}

function switchSource(mode) {
  if (mode === 'local') {
    $('tabLocal').classList.add('active');
    $('tabUrl').classList.remove('active');
    $('localPanel').classList.remove('hidden');
    $('urlPanel').classList.add('hidden');
  } else {
    $('tabLocal').classList.remove('active');
    $('tabUrl').classList.add('active');
    $('localPanel').classList.add('hidden');
    $('urlPanel').classList.remove('hidden');
  }
}

// ================================================================
// WORKER 跨域修复
// ================================================================

/**
 * @ffmpeg/ffmpeg 内部用 new Worker(cdnUrl) 启动代码分片 worker。
 * 在 GitHub Pages 等跨域环境下浏览器会拒绝构造跨域 Worker。
 * 解决：预先用 fetch() 拉取 worker 脚本（CORS 允许），
 * 转为 same-origin blob URL，然后 patch window.Worker 构造器，
 * 将所有跨域 Worker URL 重定向到 blob URL。
 */
async function patchCrossOriginWorker() {
  const workerChunkUrls = [
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/814.ffmpeg.js',
    'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/814.ffmpeg.js',
  ];

  let blobURL = null;
  for (const url of workerChunkUrls) {
    try {
      log(`预加载 Worker 分片（${new URL(url).hostname}）…`, 'info');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const code = await resp.text();
      blobURL = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      log('Worker 跨域已修复 ✓', 'info');
      break;
    } catch (e) {
      log(`Worker 分片加载失败（${new URL(url).hostname}）：${e.message}，切换备用…`, 'warn');
    }
  }

  if (!blobURL) {
    log('警告：无法预载 Worker 分片，跨域 Worker 可能仍会失败', 'warn');
    return;
  }

  // Patch：拦截所有跨域 Worker 构造，重定向到 blob URL
  const OrigWorker = window.Worker;
  window.Worker = function PatchedWorker(scriptURL, options) {
    const src = (scriptURL instanceof URL ? scriptURL.href : String(scriptURL));
    const isCrossOrigin = src.startsWith('http') &&
      !src.startsWith(location.origin) &&
      !src.startsWith('blob:');
    if (isCrossOrigin) {
      return new OrigWorker(blobURL, options);
    }
    return new OrigWorker(scriptURL, options);
  };
  window.Worker.prototype = OrigWorker.prototype;
}

// ================================================================
// LOAD FFMPEG.WASM
// ================================================================

async function loadFFmpeg() {
  // Pre-flight check: SharedArrayBuffer must be available
  if (typeof SharedArrayBuffer === 'undefined') {
    hideLoadingOverlay();
    if (location.protocol === 'file:') {
      showEnvError(
        'file:// 协议不支持 SharedArrayBuffer',
        '请通过本地 HTTP 服务器打开此页面，例如：<br>' +
        '<code>npx serve .</code> 或 <code>python3 -m http.server 8080</code><br>' +
        '然后访问 <code>http://localhost:8080</code>'
      );
    } else {
      showEnvError(
        '当前环境不支持 SharedArrayBuffer',
        '页面正在尝试通过 Service Worker 启用隔离模式，请稍等片刻后手动刷新页面。<br>' +
        '如问题持续，请确认使用 Chrome/Edge 最新版本。'
      );
    }
    return;
  }

  showLoadingOverlay('正在加载 FFmpeg 库文件…');
  try {
    // Step 1: 动态加载 JS 库（多 CDN 降级）
    await loadLibsWithFallback();

    // Step 1.5: 修复跨域 Worker 问题（GitHub Pages 等环境）
    await patchCrossOriginWorker();

    // Step 2: 初始化 FFmpeg 实例
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ type, message }) => {
      appendLog(message, type === 'stderr' ? '' : 'log-info');
    });
    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.min(100, Math.round(progress * 100));
      setProgress(pct, `处理中… ${pct}%`);
    });

    // Step 3: 加载 WASM 核心（多 CDN 降级）
    let coreLoaded = false;
    for (const cdn of CDN_CORE_LIST) {
      try {
        log(`加载核心 WASM（${new URL(cdn).hostname}，约 30MB）…`, 'info');
        const coreURL = await toBlobURL(`${cdn}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${cdn}/ffmpeg-core.wasm`, 'application/wasm');
        log('WASM 下载完成，正在初始化…', 'info');
        await ffmpeg.load({ coreURL, wasmURL });
        coreLoaded = true;
        break;
      } catch (e) {
        log(`核心加载失败（${cdn}）：${e.message}，切换备用源…`, 'warn');
      }
    }
    if (!coreLoaded) throw new Error('所有 CDN 核心均加载失败，请检查网络后刷新重试');

    isLoaded = true;
    hideLoadingOverlay();
    setProgress(0, '就绪');
    log('FFmpeg.wasm 引擎加载成功 ✓', 'info');
    toast('FFmpeg 引擎就绪，请上传文件', 'success');
  } catch (err) {
    hideLoadingOverlay();
    log(`引擎加载失败：${err.message}`, 'err');
    showEnvError(
      'FFmpeg 引擎加载失败',
      err.message +
      '<br>请检查网络连接后 <a href="javascript:location.reload()" style="color:var(--accent-blue)">刷新页面重试</a>。'
    );
    isLoaded = false;
  }
}

// ================================================================
// RUN BUTTONS
// ================================================================

function initRunButtons() {
  document.querySelectorAll('.run-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      handleAction(action);
    });
  });
}

async function handleAction(action) {
  if (!isLoaded) {
    toast('FFmpeg 引擎尚未就绪，请稍候再试', 'error');
    return;
  }
  if (isProcessing) {
    toast('当前有任务正在处理中，请等待完成', 'error');
    return;
  }
  // All actions except 'custom' require a primary file
  if (action !== 'custom' && !inputFile) {
    toast('请先上传或获取文件', 'error');
    return;
  }
  if (action === 'merge' && !inputFile2) {
    toast('合并操作需要上传两个文件', 'error');
    return;
  }

  isProcessing = true;
  clearDownload();
  clearLog();
  setProgress(0, '准备中…');

  // Disable all run buttons
  document.querySelectorAll('.run-btn').forEach(b => {
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> 处理中…`;
  });

  try {
    switch (action) {
      case 'convert':   await runConvert(); break;
      case 'compress':  await runCompress(); break;
      case 'trim':      await runTrim(); break;
      case 'extract':   await runExtract(); break;
      case 'resize':    await runResize(); break;
      case 'merge':     await runMerge(); break;
      case 'gif':       await runGif(); break;
      case 'watermark': await runWatermark(); break;
      case 'probe':     await runProbe(); break;
      case 'custom':    await runCustom(); break;
    }
  } catch (err) {
    log(`错误：${err.message}`, 'err');
    toast(`处理失败：${err.message}`, 'error');
    setProgress(0, '处理失败');
  }

  isProcessing = false;

  // Re-enable buttons with original labels
  document.querySelectorAll('.run-btn').forEach(b => {
    b.disabled = false;
    const actionLabels = {
      convert: '开始转换', compress: '开始压缩', trim: '开始裁剪',
      extract: '提取音频', resize: '调整尺寸', merge: '合并视频',
      gif: '生成 GIF', watermark: '添加水印', probe: '读取媒体信息',
      custom: '执行命令'
    };
    b.textContent = actionLabels[b.dataset.action] || '执行';
  });
}

// ================================================================
// WRITE INPUT FILE(S) TO FFMPEG FS
// ================================================================

async function writeInputFile(file, name) {
  const data = await fetchFile(file);
  await ffmpeg.writeFile(name, data);
}

// ================================================================
// ACTIONS
// ================================================================

// --- FORMAT CONVERT ---
async function runConvert() {
  const fmt = $('convertFormat').value;
  const vcodec = $('convertVcodec').value;
  const acodec = $('convertAcodec').value;
  const crf = $('convertCrf').value;

  const ext = getOutputExt(fmt);
  const inputName = getInputName(inputFile);
  const outputName = `output.${ext}`;

  log(`格式转换：${inputFile.name} → ${outputName}`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = ['-i', inputName];

  if (fmt === 'png' || fmt === 'jpg') {
    // Screenshot first frame
    args.push('-vframes', '1');
  } else {
    if (vcodec !== 'copy') {
      args.push('-c:v', vcodec);
      if (vcodec === 'libx264' || vcodec === 'libx265') {
        args.push('-crf', crf);
      }
    } else {
      args.push('-c:v', 'copy');
    }
    if (acodec !== 'copy') {
      args.push('-c:a', acodec);
    } else {
      args.push('-c:a', 'copy');
    }
  }

  args.push('-y', outputName);

  setProgress(5, '开始转换…');
  await ffmpeg.exec(args);
  setProgress(100, '转换完成');

  await downloadResult(outputName, `converted_${Date.now()}.${ext}`);
  await cleanupFiles([inputName, outputName]);
}

// --- COMPRESS ---
async function runCompress() {
  const preset = $('compressPreset').value;
  const crf = $('compressCrf').value;
  const scale = $('compressScale').value;
  const fmt = $('compressFormat').value;

  const inputName = getInputName(inputFile);
  const outputName = `output.${fmt}`;

  log(`视频压缩：CRF=${crf} Preset=${preset}`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = ['-i', inputName, '-c:v', 'libx264', '-crf', crf, '-preset', preset];

  if (scale) {
    args.push('-vf', `scale=${scale}`);
  }

  args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', outputName);

  setProgress(5, '开始压缩…');
  await ffmpeg.exec(args);
  setProgress(100, '压缩完成');

  await downloadResult(outputName, `compressed_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName, outputName]);
}

// --- TRIM ---
async function runTrim() {
  const sh = parseInt($('trimStartH').value) || 0;
  const sm = parseInt($('trimStartM').value) || 0;
  const ss = parseInt($('trimStartS').value) || 0;
  const eh = parseInt($('trimEndH').value) || 0;
  const em = parseInt($('trimEndM').value) || 0;
  const es = parseInt($('trimEndS').value) || 0;

  const startSec = sh * 3600 + sm * 60 + ss;
  const endSec   = eh * 3600 + em * 60 + es;

  if (endSec <= startSec) {
    throw new Error('结束时间必须大于开始时间');
  }

  const duration = endSec - startSec;
  const fmt = $('trimFormat').value;
  const codecMode = $('trimCodec').value;
  const inputName = getInputName(inputFile);
  const outputName = `output.${fmt}`;

  log(`裁剪：${formatTime(startSec)} → ${formatTime(endSec)} (时长: ${formatTime(duration)})`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = [
    '-ss', String(startSec),
    '-i', inputName,
    '-t', String(duration)
  ];

  if (codecMode === 'copy') {
    args.push('-c', 'copy');
  } else {
    args.push('-c:v', 'libx264', '-c:a', 'aac');
  }

  args.push('-y', outputName);

  setProgress(5, '开始裁剪…');
  await ffmpeg.exec(args);
  setProgress(100, '裁剪完成');

  await downloadResult(outputName, `trimmed_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName, outputName]);
}

// --- EXTRACT AUDIO ---
async function runExtract() {
  const fmt = $('extractFormat').value;
  const bitrate = $('extractBitrate').value;
  const channels = $('extractChannels').value;
  const sampleRate = $('extractSampleRate').value;

  const inputName = getInputName(inputFile);
  const outputName = `output.${fmt}`;

  log(`提取音频：格式=${fmt} 码率=${bitrate}`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = ['-i', inputName, '-vn'];

  if (fmt === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-b:a', bitrate);
  } else if (fmt === 'wav') {
    args.push('-c:a', 'pcm_s16le');
  } else if (fmt === 'flac') {
    args.push('-c:a', 'flac');
  } else if (fmt === 'ogg') {
    args.push('-c:a', 'libvorbis', '-b:a', bitrate);
  } else {
    args.push('-c:a', 'aac', '-b:a', bitrate);
  }

  if (channels) args.push('-ac', channels);
  if (sampleRate) args.push('-ar', sampleRate);

  args.push('-y', outputName);

  setProgress(5, '提取音频中…');
  await ffmpeg.exec(args);
  setProgress(100, '提取完成');

  await downloadResult(outputName, `audio_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName, outputName]);
}

// --- RESIZE ---
async function runResize() {
  const width = $('resizeWidth').value || -2;
  const height = $('resizeHeight').value || -2;
  const fmt = $('resizeFormat').value;

  const inputName = getInputName(inputFile);
  const outputName = `output.${fmt}`;

  log(`调整尺寸：${width}x${height}`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = [
    '-i', inputName,
    '-vf', `scale=${width}:${height}`,
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-y', outputName
  ];

  setProgress(5, '调整尺寸中…');
  await ffmpeg.exec(args);
  setProgress(100, '完成');

  await downloadResult(outputName, `resized_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName, outputName]);
}

// --- MERGE ---
async function runMerge() {
  const fmt = $('mergeFormat').value;
  const codec = $('mergeCodec').value;

  const inputName1 = getInputName(inputFile, 'input1');
  const inputName2 = getInputName(inputFile2, 'input2');
  const outputName = `output.${fmt}`;
  const listFile = 'concat_list.txt';

  log(`合并视频：${inputFile.name} + ${inputFile2.name}`, 'info');
  await writeInputFile(inputFile, inputName1);
  await writeInputFile(inputFile2, inputName2);

  if (codec === 'copy') {
    // Use concat demuxer
    const list = `file '${inputName1}'\nfile '${inputName2}'\n`;
    await ffmpeg.writeFile(listFile, list);

    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-y', outputName
    ];

    setProgress(5, '合并中…');
    await ffmpeg.exec(args);
  } else {
    // Re-encode approach with filter_complex
    const args = [
      '-i', inputName1,
      '-i', inputName2,
      '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]',
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-y', outputName
    ];

    setProgress(5, '合并中（重新编码）…');
    await ffmpeg.exec(args);
  }

  setProgress(100, '合并完成');
  await downloadResult(outputName, `merged_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName1, inputName2, outputName, listFile]);
}

// --- GIF ---
async function runGif() {
  const start = parseFloat($('gifStart').value) || 0;
  const duration = parseFloat($('gifDuration').value) || 5;
  const fps = $('gifFps').value;
  const width = $('gifWidth').value;

  const inputName = getInputName(inputFile);
  const paletteName = 'palette.png';
  const outputName = 'output.gif';

  log(`生成GIF：起点=${start}s 时长=${duration}s fps=${fps} 宽=${width}px`, 'info');
  await writeInputFile(inputFile, inputName);

  // Two-pass: generate palette first for better quality
  const filterBase = `fps=${fps},scale=${width}:-1:flags=lanczos`;

  setProgress(10, '生成调色板…');
  await ffmpeg.exec([
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputName,
    '-vf', `${filterBase},palettegen`,
    '-y', paletteName
  ]);

  setProgress(50, '生成 GIF…');
  await ffmpeg.exec([
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputName,
    '-i', paletteName,
    '-lavfi', `${filterBase} [x]; [x][1:v] paletteuse`,
    '-y', outputName
  ]);

  setProgress(100, 'GIF 生成完成');
  await downloadResult(outputName, `animated_${Date.now()}.gif`);
  await cleanupFiles([inputName, paletteName, outputName]);
}

// --- WATERMARK ---
async function runWatermark() {
  const text = $('wmText').value || '威软FFmpeg';
  const position = $('wmPosition').value;
  const fontSize = $('wmFontSize').value;
  const color = hexToRgb($('wmColor').value);
  const alpha = $('wmAlpha').value;
  const fmt = $('wmFormat').value;

  const inputName = getInputName(inputFile);
  const outputName = `output.${fmt}`;

  // Position mapping
  const posMap = {
    topleft:     'x=20:y=20',
    topright:    'x=w-tw-20:y=20',
    bottomleft:  'x=20:y=h-th-20',
    bottomright: 'x=w-tw-20:y=h-th-20',
    center:      'x=(w-tw)/2:y=(h-th)/2'
  };

  const xyStr = posMap[position] || posMap.bottomright;
  const fontcolor = `${color}@${alpha}`;
  const drawtext = `drawtext=text='${text.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=${fontcolor}:${xyStr}:shadowcolor=black@0.5:shadowx=2:shadowy=2`;

  log(`添加水印："${text}" 位置=${position}`, 'info');
  await writeInputFile(inputFile, inputName);

  const args = [
    '-i', inputName,
    '-vf', drawtext,
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-y', outputName
  ];

  setProgress(5, '添加水印中…');
  await ffmpeg.exec(args);
  setProgress(100, '水印添加完成');

  await downloadResult(outputName, `watermarked_${Date.now()}.${fmt}`);
  await cleanupFiles([inputName, outputName]);
}

// --- PROBE ---
async function runProbe() {
  const inputName = getInputName(inputFile);
  log(`读取媒体信息：${inputFile.name}`, 'info');
  await writeInputFile(inputFile, inputName);

  setProgress(5, '读取中…');

  // Collect log lines during this exec only; use a separate listener
  const logs = [];
  const onLog = ({ message }) => logs.push(message);
  ffmpeg.on('log', onLog);

  try {
    await ffmpeg.exec(['-hide_banner', '-i', inputName]);
  } catch (e) {
    // Expected: FFmpeg exits non-zero with no output file
  } finally {
    ffmpeg.off('log', onLog);  // always unsubscribe to avoid leak
  }

  setProgress(100, '读取完成');

  const probeEl = $('probeResult');
  probeEl.classList.remove('hidden');
  probeEl.textContent = logs.join('\n') || '未能读取媒体信息';

  await cleanupFiles([inputName]);
}

// --- CUSTOM ---
async function runCustom() {
  const cmdStr = $('customCmd').value.trim();
  const outputName = $('customOutput').value.trim() || 'output.mp4';

  if (!cmdStr) {
    throw new Error('请输入 FFmpeg 参数');
  }

  if (inputFile) {
    const inputName = getInputName(inputFile);
    await writeInputFile(inputFile, inputName);
  }

  // Parse the command string into args array
  const args = parseArgs(cmdStr);

  log(`执行自定义命令：ffmpeg ${args.join(' ')}`, 'info');
  setProgress(5, '执行中…');

  await ffmpeg.exec(args);
  setProgress(100, '执行完成');

  // Try to read output
  try {
    await downloadResult(outputName, outputName);
  } catch (e) {
    log(`提示：未找到输出文件 ${outputName}，请检查命令中的输出文件名是否与上方一致。`, 'warn');
  }
}

// ================================================================
// HELPER: DOWNLOAD RESULT
// ================================================================

async function downloadResult(ffmpegFileName, downloadFileName) {
  const data = await ffmpeg.readFile(ffmpegFileName);
  const blob = new Blob([data.buffer], { type: getMimeType(downloadFileName) });
  const url = URL.createObjectURL(blob);
  const size = data.length;

  const dlBtn = $('downloadBtn');
  dlBtn.href = url;
  dlBtn.download = downloadFileName;

  $('downloadMeta').textContent = `${downloadFileName} · ${formatSize(size)}`;
  $('downloadArea').classList.remove('hidden');

  toast(`处理完成！文件大小：${formatSize(size)}`, 'success');
  log(`输出文件：${downloadFileName} (${formatSize(size)})`, 'info');
}

async function cleanupFiles(names) {
  for (const name of names) {
    try {
      await ffmpeg.deleteFile(name);
    } catch (e) { /* ignore */ }
  }
}

// ================================================================
// UTILITIES
// ================================================================

function getInputName(file, prefix = 'input') {
  const ext = file.name.split('.').pop().toLowerCase();
  return `${prefix}.${ext}`;
}

function getOutputExt(fmt) {
  const map = {
    'mp4': 'mp4', 'mp4-h265': 'mp4', 'webm': 'webm',
    'avi': 'avi', 'mov': 'mov', 'mkv': 'mkv',
    'flv': 'flv', 'ts': 'ts', 'wmv': 'wmv',
    'mp3': 'mp3', 'aac': 'aac', 'wav': 'wav',
    'flac': 'flac', 'ogg': 'ogg', 'm4a': 'm4a', 'opus': 'opus',
    'gif': 'gif', 'png': 'png', 'jpg': 'jpg'
  };
  return map[fmt] || fmt;
}

function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', mov: 'video/quicktime', flv: 'video/x-flv',
    mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav',
    flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
    gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg'
  };
  return map[ext] || 'application/octet-stream';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `0x${hex.slice(1)}`;  // FFmpeg color format
}

// Simple args parser: respects quotes
function parseArgs(str) {
  const args = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of str) {
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

// ================================================================
// UI HELPERS
// ================================================================

function showEnvError(title, detail) {
  // Replace loading overlay content (or show inline in log area) with an actionable error
  const box = $('logBox');
  const el = document.createElement('div');
  el.className = 'log-err';
  el.innerHTML = `<strong>⚠️ ${title}</strong><br>${detail}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  setProgress(0, title);
}

function setProgress(pct, label) {
  $('progressBar').style.width = `${pct}%`;
  $('progressPct').textContent = `${pct}%`;
  $('progressLabel').textContent = label;
}

function log(msg, type = '') {
  const box = $('logBox');
  const line = document.createElement('div');
  if (type) line.className = `log-${type}`;
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function appendLog(msg, cls = '') {
  const box = $('logBox');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  $('logBox').innerHTML = '';
  $('probeResult')?.classList.add('hidden');
}

function clearDownload() {
  $('downloadArea').classList.add('hidden');
  const dlBtn = $('downloadBtn');
  if (dlBtn.href && dlBtn.href.startsWith('blob:')) {
    URL.revokeObjectURL(dlBtn.href);
    dlBtn.href = '#';
  }
}

// Range sliders → display value
function initRangeDisplays() {
  const pairs = [
    ['convertCrf', 'convertCrfVal'],
    ['compressCrf', 'compressCrfVal'],
    ['wmAlpha', 'wmAlphaVal'],
  ];
  pairs.forEach(([inputId, displayId]) => {
    const input = $(inputId);
    const display = $(displayId);
    if (input && display) {
      input.addEventListener('input', () => { display.textContent = input.value; });
    }
  });

  // Resize preset select (was onchange in HTML)
  const resizePreset = $('resizePreset');
  if (resizePreset) resizePreset.addEventListener('change', function () { handleResizePreset(this.value); });
}

function handleResizePreset(val) {
  if (!val) return;
  const [w, h] = val.split(':');
  $('resizeWidth').value = w;
  $('resizeHeight').value = h;
}

// ================================================================
// TOAST NOTIFICATIONS
// ================================================================

let toastContainer;

function toast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => { el.remove(); }, 3500);
}

// ================================================================
// LOADING OVERLAY
// ================================================================

let overlay;

function showLoadingOverlay(msg = '加载中…') {
  overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = `
    <div class="big-spinner"></div>
    <p>${msg}</p>
  `;
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  overlay?.remove();
  overlay = null;
}

