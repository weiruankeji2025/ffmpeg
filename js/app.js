/**
 * 威软FFmpeg - Online FFmpeg Tool
 * Powered by FFmpeg.wasm (WebAssembly)
 * Author: 威软 (Weiruan)
 */

'use strict';

// ================================================================
// GLOBALS
// ================================================================

const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

let ffmpeg = null;
let isLoaded = false;
let isProcessing = false;

// Uploaded files
let inputFile = null;    // primary file
let inputFile2 = null;   // secondary file (for merge)

// DOM cache
const $ = (id) => document.getElementById(id);

// ================================================================
// INIT
// ================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initUpload();
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
// LOAD FFMPEG.WASM
// ================================================================

async function loadFFmpeg() {
  showLoadingOverlay('正在加载 FFmpeg.wasm 引擎…');
  try {
    ffmpeg = new FFmpeg();

    // Log callback
    ffmpeg.on('log', ({ type, message }) => {
      const cls = type === 'stderr' ? '' : 'log-info';
      appendLog(message, cls);
    });

    // Progress callback
    ffmpeg.on('progress', ({ progress, time }) => {
      const pct = Math.min(100, Math.round(progress * 100));
      setProgress(pct, `处理中… ${pct}%`);
    });

    const coreURL = await toBlobURL(
      `${window.FFMPEG_CORE_CDN}/ffmpeg-core.js`,
      'text/javascript'
    );
    const wasmURL = await toBlobURL(
      `${window.FFMPEG_CORE_CDN}/ffmpeg-core.wasm`,
      'application/wasm'
    );

    await ffmpeg.load({ coreURL, wasmURL });

    isLoaded = true;
    hideLoadingOverlay();
    log('FFmpeg.wasm 引擎加载成功 ✓', 'info');
    toast('FFmpeg 引擎就绪', 'success');
  } catch (err) {
    hideLoadingOverlay();
    log(`引擎加载失败：${err.message}`, 'err');
    log('提示：某些浏览器需要启用 SharedArrayBuffer。请尝试 Chrome/Edge 最新版，或检查网站是否启用了 COOP/COEP 响应头。', 'warn');
    toast('FFmpeg 加载失败，请查看日志', 'error');
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
    toast('FFmpeg 引擎尚未加载完毕，请稍候', 'error');
    return;
  }
  if (isProcessing) {
    toast('当前有任务正在处理中，请等待完成', 'error');
    return;
  }
  if (action !== 'probe' && action !== 'custom' && !inputFile) {
    toast('请先上传文件', 'error');
    return;
  }
  if (action === 'merge' && !inputFile2) {
    toast('合并操作需要上传两个文件', 'error');
    return;
  }
  if (!inputFile && action !== 'custom') {
    toast('请先上传文件', 'error');
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
  if (!inputFile) {
    toast('请先上传文件', 'error');
    return;
  }

  const inputName = getInputName(inputFile);
  log(`读取媒体信息：${inputFile.name}`, 'info');
  await writeInputFile(inputFile, inputName);

  setProgress(5, '读取中…');

  // FFmpeg stderr has media info; capture it
  const logs = [];
  const unsubscribe = ffmpeg.on('log', ({ message }) => {
    logs.push(message);
  });

  try {
    // -hide_banner shows less noise but still shows streams
    await ffmpeg.exec(['-hide_banner', '-i', inputName]);
  } catch (e) {
    // FFmpeg always exits non-zero when only -i is provided (no output), that's expected
  }

  setProgress(100, '读取完成');

  const result = logs.join('\n');
  const probeEl = $('probeResult');
  probeEl.classList.remove('hidden');
  probeEl.textContent = result || '未能读取媒体信息';

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
}

// Resize preset handler (called from HTML onchange)
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

// Expose for HTML inline handler
window.handleResizePreset = handleResizePreset;
