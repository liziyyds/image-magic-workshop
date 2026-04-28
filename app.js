/**
 * app.js — 图片魔法工坊 · 主逻辑
 */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    resize: {
      images: [], // { id, file, dataUrl, thumb }
      selectedPreset: 'douyin',
      mode: 'cover',
      customW: 0,
      customH: 0,
      processed: [], // { id, blob, dataUrl, name }
    },
    outpaint: {
      fabricCanvas: null,
      fabricImg: null,
      currentFile: null,
      currentBlob: null,
      targetW: 1080,
      targetH: 1920,
      tool: 'pan',
      apiConfig: {
        ak: localStorage.getItem('volc_ak') || '',
        sk: localStorage.getItem('volc_sk') || '',
        region: localStorage.getItem('volc_region') || 'cn-north-1',
      },
    },
    crop: {
      file: null,
      blob: null,
      dataUrl: null,
      cropCanvas: null,
      ratio: '1:1',
      cropRect: null,
    },
    convert: {
      images: [],
      format: 'jpeg',
      quality: 85,
      resizeW: 0,
      resizeH: 0,
      keepAspect: true,
      processed: [],
    },
    templates: {
      list: JSON.parse(localStorage.getItem('imw_templates') || '[]'),
      filterTag: '全部',
    },
  };

  let fabricCanvas = null;

  // ===== Utils =====
  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve(url); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', info: '💡' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || '💡'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatFileSize(blob) {
    if (blob.size < 1024) return blob.size + ' B';
    if (blob.size < 1024 * 1024) return (blob.size / 1024).toFixed(1) + ' KB';
    return (blob.size / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ===== Tab Navigation =====
  function initTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
      });
    });
  }

  // ===== Dropzone Helper =====
  function setupDropzone(dropzoneId, fileInputId, onFiles) {
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(fileInputId);
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length) onFiles(files);
    });
    fileInput.addEventListener('change', e => {
      const files = Array.from(e.target.files);
      if (files.length) onFiles(files);
      e.target.value = '';
    });
  }

  // ===== Resize Tab =====
  function initResizeTab() {
    setupDropzone('resizeDropzone', 'resizeFileInput', async files => {
      for (const file of files) {
        const dataUrl = await fileToDataURL(file);
        state.resize.images.push({ id: uid(), file, dataUrl });
      }
      renderResizeThumbs();
      updateResizeUI();
    });

    // Preset selection
    document.getElementById('presetGrid').addEventListener('click', e => {
      const item = e.target.closest('.preset-item');
      if (!item) return;
      document.querySelectorAll('.preset-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      state.resize.selectedPreset = item.dataset.preset;
      state.resize.customW = parseInt(item.dataset.w);
      state.resize.customH = parseInt(item.dataset.h);
      document.getElementById('customWidth').value = '';
      document.getElementById('customHeight').value = '';
    });

    // Mode toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.resize.mode = btn.dataset.mode;
      });
    });

    // Custom size
    document.getElementById('applyCustomSize').addEventListener('click', () => {
      const w = parseInt(document.getElementById('customWidth').value);
      const h = parseInt(document.getElementById('customHeight').value);
      if (!w || !h) { showToast('请输入有效的宽高值', 'error'); return; }
      document.querySelectorAll('.preset-item').forEach(i => i.classList.remove('active'));
      state.resize.selectedPreset = 'custom';
      state.resize.customW = w;
      state.resize.customH = h;
      showToast(`自定义尺寸 ${w}×${h} 已应用`, 'success');
    });

    // Clear
    document.getElementById('clearResizeBtn').addEventListener('click', () => {
      state.resize.images = [];
      state.resize.processed = [];
      renderResizeThumbs();
      updateResizeUI();
      document.getElementById('resizeResults').style.display = 'none';
    });

    // Process
    document.getElementById('processResizeBtn').addEventListener('click', processResizeImages);

    // Download ZIP
    document.getElementById('downloadZipBtn').addEventListener('click', downloadResizeZip);
  }

  function renderResizeThumbs() {
    const list = document.getElementById('resizePreviewList');
    list.innerHTML = '';
    state.resize.images.forEach(img => {
      const div = document.createElement('div');
      div.className = 'preview-thumb';
      div.innerHTML = `<img src="${img.dataUrl}" alt=""><button class="thumb-remove">✕</button>`;
      div.querySelector('.thumb-remove').addEventListener('click', e => {
        e.stopPropagation();
        state.resize.images = state.resize.images.filter(i => i.id !== img.id);
        renderResizeThumbs();
        updateResizeUI();
      });
      list.appendChild(div);
    });
  }

  function updateResizeUI() {
    const hasImages = state.resize.images.length > 0;
    document.getElementById('uploadCount').textContent = state.resize.images.length + ' 张';
    document.getElementById('processResizeBtn').disabled = !hasImages;
    document.getElementById('resizeFooter').style.display = hasImages ? 'flex' : 'none';
  }

  async function processResizeImages() {
    const images = state.resize.images;
    if (!images.length) return;

    const preset = state.resize.selectedPreset;
    let w, h;
    if (preset === 'custom') {
      w = state.resize.customW; h = state.resize.customH;
    } else {
      const item = document.querySelector(`[data-preset="${preset}"]`);
      w = parseInt(item.dataset.w); h = parseInt(item.dataset.h);
    }

    const progressDiv = document.getElementById('resizeProgress');
    const fill = document.getElementById('resizeProgressFill');
    const text = document.getElementById('resizeProgressText');
    const count = document.getElementById('resizeProgressCount');
    progressDiv.style.display = 'block';
    state.resize.processed = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      text.textContent = `处理 ${img.file.name}...`;
      count.textContent = `${i + 1}/${images.length}`;
      fill.style.width = `${((i + 1) / images.length) * 100}%`;

      try {
        const result = await LocalProcessor.processImage(img.file, w, h, state.resize.mode);
        const dataUrl = await blobToDataURL(result.blob);
        state.resize.processed.push({
          id: img.id,
          blob: result.blob,
          dataUrl,
          name: img.file.name.replace(/\.\w+$/, `_${w}x${h}.${img.file.name.split('.').pop()}`),
        });
      } catch (e) {
        showToast(`处理 ${img.file.name} 失败: ${e.message}`, 'error');
      }
      await new Promise(r => setTimeout(r, 50));
    }

    progressDiv.style.display = 'none';
    renderResizeResults();
    showToast(`完成！共处理 ${state.resize.processed.length} 张图片`, 'success');
  }

  function renderResizeResults() {
    const section = document.getElementById('resizeResults');
    const grid = document.getElementById('resizeResultGrid');
    section.style.display = 'block';
    document.getElementById('resultCount').textContent = state.resize.processed.length + ' 张';
    document.getElementById('downloadZipBtn').disabled = false;
    grid.innerHTML = '';
    state.resize.processed.forEach(item => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `
        <img src="${item.dataUrl}" alt="">
        <div class="result-item-info">
          <span class="result-item-name">${item.name}</span>
          <span class="result-item-size">${formatFileSize(item.blob)}</span>
        </div>
      `;
      div.addEventListener('click', () => downloadBlob(item.blob, item.name));
      grid.appendChild(div);
    });
  }

  async function downloadResizeZip() {
    const items = state.resize.processed;
    if (!items.length) return;
    showToast('正在打包 ZIP...', 'info');
    try {
      const zip = new JSZip();
      items.forEach(item => {
        const ext = item.name.split('.').pop();
        const filename = item.name;
        zip.file(filename, item.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `图片魔法工坊_${Date.now()}.zip`);
      showToast('ZIP 下载成功！', 'success');
    } catch (e) {
      showToast('打包失败: ' + e.message, 'error');
    }
  }

  // ===== Outpaint Tab =====
  function initOutpaintTab() {
    setupDropzone('outpaintDropzone', 'outpaintFileInput', async files => {
      if (!files.length) return;
      const file = files[0];
      state.outpaint.currentFile = file;
      state.outpaint.currentBlob = file;
      document.getElementById('outpaintUpload').style.display = 'none';
      document.getElementById('outpaintSettings').style.display = 'flex';
      document.getElementById('outpaintResult').style.display = 'none';
      document.getElementById('outpaintLoading').style.display = 'none';

      const dataUrl = await fileToDataURL(file);
      initFabricCanvas(dataUrl);

      // 加载保存的 AK/SK
      document.getElementById('akInput').value = state.outpaint.apiConfig.ak;
      document.getElementById('skInput').value = state.outpaint.apiConfig.sk;
      document.getElementById('strengthInput').value = '0.8';
      document.getElementById('scaleInput').value = '1.0';
    });

    // Size presets
    document.querySelectorAll('.size-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.outpaint.targetW = parseInt(btn.dataset.w);
        state.outpaint.targetH = parseInt(btn.dataset.h);
        document.getElementById('outpaintWidth').value = btn.dataset.w;
        document.getElementById('outpaintHeight').value = btn.dataset.h;
      });
    });

    // Custom size inputs
    document.getElementById('outpaintWidth').addEventListener('input', e => {
      state.outpaint.targetW = parseInt(e.target.value) || 0;
    });
    document.getElementById('outpaintHeight').addEventListener('input', e => {
      state.outpaint.targetH = parseInt(e.target.value) || 0;
    });

    // Canvas tools
    document.getElementById('toolPan').addEventListener('click', () => {
      state.outpaint.tool = 'pan';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('toolPan').classList.add('active');
      if (fabricCanvas) {
        fabricCanvas.selection = false;
        fabricCanvas.defaultCursor = 'grab';
      }
    });

    document.getElementById('toolZoom').addEventListener('click', () => {
      state.outpaint.tool = 'zoom';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('toolZoom').classList.add('active');
      if (fabricCanvas) {
        fabricCanvas.selection = false;
        fabricCanvas.defaultCursor = 'zoom-in';
      }
    });

    document.getElementById('toolReset').addEventListener('click', () => {
      if (fabricCanvas && state.outpaint.fabricImg) {
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      }
    });

    // Outpaint button
    document.getElementById('outpaintBtn').addEventListener('click', runOutpainting);

    // Download
    document.getElementById('downloadOutpaintBtn').addEventListener('click', () => {
      const resultImg = document.getElementById('outpaintResultImg');
      if (resultImg.src) {
        const a = document.createElement('a');
        a.href = resultImg.src;
        a.download = `延展_${state.outpaint.targetW}x${state.outpaint.targetH}.png`;
        a.click();
      }
    });
  }

  function initFabricCanvas(imageUrl) {
    const wrapper = document.getElementById('canvasWrapper');
    const empty = document.getElementById('canvasEmpty');
    empty.style.display = 'none';

    if (fabricCanvas) {
      fabricCanvas.dispose();
    }

    fabricCanvas = new fabric.Canvas('fabricCanvas', {
      width: wrapper.clientWidth,
      height: wrapper.clientHeight,
      backgroundColor: '#0D1117',
      selection: false,
      defaultCursor: 'grab',
    });

    state.outpaint.fabricCanvas = fabricCanvas;

    fabric.Image.fromURL(imageUrl, img => {
      const scale = Math.min(
        (wrapper.clientWidth * 0.8) / img.width,
        (wrapper.clientHeight * 0.8) / img.height
      );
      img.set({
        left: wrapper.clientWidth / 2,
        top: wrapper.clientHeight / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        selectable: true,
        hasControls: false,
        hasBorders: false,
      });
      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      state.outpaint.fabricImg = img;
      document.getElementById('outpaintBtn').disabled = false;

      // Draw target canvas border
      drawTargetBorder();
    }, { crossOrigin: 'anonymous' });

    // Mouse wheel zoom
    fabricCanvas.on('mouse:wheel', opt => {
      const delta = opt.e.deltaY;
      let zoom = fabricCanvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(10, zoom));
      fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Pan with middle mouse or space+drag
    let isPanning = false;
    fabricCanvas.on('mouse:down', opt => {
      if (opt.e.button === 1 || (opt.e.button === 0 && state.outpaint.tool === 'pan')) {
        isPanning = true;
        fabricCanvas.defaultCursor = 'grabbing';
        fabricCanvas.selection = false;
        fabricCanvas.setCursor('grabbing');
      }
    });
    fabricCanvas.on('mouse:move', opt => {
      if (isPanning) {
        const vpt = fabricCanvas.viewportTransform;
        vpt[4] += opt.e.dx;
        vpt[5] += opt.e.dy;
        fabricCanvas.requestRenderAll();
      }
    });
    fabricCanvas.on('mouse:up', () => {
      isPanning = false;
      fabricCanvas.defaultCursor = state.outpaint.tool === 'zoom' ? 'zoom-in' : 'grab';
    });

    // Window resize
    window.addEventListener('resize', () => {
      if (fabricCanvas) {
        fabricCanvas.setDimensions({ width: wrapper.clientWidth, height: wrapper.clientHeight });
        drawTargetBorder();
      }
    });

    // Window resize handler stored
    state.outpaint._wrapper = wrapper;
  }

  function drawTargetBorder() {
    if (!fabricCanvas || !state.outpaint.targetW || !state.outpaint.targetH) return;

    // Remove old border
    const oldBorder = fabricCanvas.getObjects().find(o => o.isTargetBorder);
    if (oldBorder) fabricCanvas.remove(oldBorder);

    const w = state.outpaint.targetW;
    const h = state.outpaint.targetH;
    const maxW = state.outpaint._wrapper?.clientWidth || 600;
    const maxH = state.outpaint._wrapper?.clientHeight || 460;
    const scale = Math.min(maxW / w, maxH / h) * 0.9;

    const rect = new fabric.Rect({
      left: maxW / 2,
      top: maxH / 2,
      originX: 'center',
      originY: 'center',
      width: w * scale,
      height: h * scale,
      fill: 'transparent',
      stroke: '#667EEA',
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      selectable: false,
      evented: false,
      isTargetBorder: true,
      opacity: 0.6,
    });

    // Label
    const label = new fabric.Text(`${w}×${h}`, {
      left: maxW / 2,
      top: maxH / 2 - (h * scale / 2) - 12,
      originX: 'center',
      fontSize: 11,
      fill: '#667EEA',
      fontFamily: 'JetBrains Mono, monospace',
      selectable: false,
      evented: false,
      isTargetBorder: true,
    });

    fabricCanvas.add(rect);
    fabricCanvas.add(label);
    fabricCanvas.sendToBack(rect);
    if (state.outpaint.fabricImg) fabricCanvas.bringToFront(state.outpaint.fabricImg);
    fabricCanvas.requestRenderAll();
  }

  async function runOutpainting() {
    if (!fabricCanvas || !state.outpaint.fabricImg) {
      showToast('请先上传图片', 'error');
      return;
    }

    const ak = document.getElementById('akInput').value.trim();
    const sk = document.getElementById('skInput').value.trim();
    const region = 'cn-north-1';
    const strength = parseFloat(document.getElementById('strengthInput').value) || 0.8;
    const scale = parseFloat(document.getElementById('scaleInput').value) || 1.0;
    const targetW = state.outpaint.targetW || 1080;
    const targetH = state.outpaint.targetH || 1920;

    // 保存配置
    state.outpaint.apiConfig = { ak, sk, region };
    if (ak) localStorage.setItem('volc_ak', ak);
    if (sk) localStorage.setItem('volc_sk', sk);

    document.getElementById('outpaintSettings').style.display = 'none';
    document.getElementById('outpaintLoading').style.display = 'flex';

    try {
      let resultBlob;

      if (ak && sk) {
        // 使用 Fabric.js canvas 导出图片
        const canvasEl = fabricCanvas.getElement();
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = canvasEl.width;
        fullCanvas.height = canvasEl.height;
        const ctx = fullCanvas.getContext('2d');
        ctx.drawImage(canvasEl, 0, 0);
        const exportBlob = await new Promise(resolve => fullCanvas.toBlob(resolve, 'image/png'));
        resultBlob = await callOutpaintingAPI({ ak, sk, region, imageBlob: exportBlob, strength, scale });
      } else {
        // 降级：本地模拟处理
        resultBlob = await mockOutpainting(state.outpaint.currentBlob, targetW, targetH);
      }

      const resultUrl = await blobToDataURL(resultBlob);
      document.getElementById('outpaintResultImg').src = resultUrl;
      document.getElementById('outpaintLoading').style.display = 'none';
      document.getElementById('outpaintResult').style.display = 'flex';
      showToast('延展完成！', 'success');
    } catch (e) {
      console.error('Outpainting error:', e);
      document.getElementById('outpaintLoading').style.display = 'none';
      document.getElementById('outpaintSettings').style.display = 'flex';
      showToast('延展失败: ' + e.message + '（将使用本地模拟）', 'error');

      // Fallback to mock
      try {
        const mockBlob = await mockOutpainting(state.outpaint.currentBlob, targetW, targetH);
        const url = await blobToDataURL(mockBlob);
        document.getElementById('outpaintResultImg').src = url;
        document.getElementById('outpaintLoading').style.display = 'none';
        document.getElementById('outpaintResult').style.display = 'flex';
      } catch (mockErr) {
        showToast('本地处理也失败了', 'error');
      }
    }
  }

  // ===== Crop Tab =====
  function initCropTab() {
    setupDropzone('cropDropzone', 'cropFileInput', async files => {
      if (!files.length) return;
      const file = files[0];
      state.crop.file = file;
      state.crop.blob = file;
      const dataUrl = await fileToDataURL(file);
      state.crop.dataUrl = dataUrl;

      document.getElementById('cropPreviewImg').src = dataUrl;
      document.getElementById('cropPreviewImg').style.display = 'block';
      document.getElementById('cropControls').style.display = 'flex';
      document.getElementById('applyCropBtn').style.display = 'block';

      // Get crop proposals
      const result = await LocalProcessor.suggestCrops(file);
      renderCropLayouts(result.proposals, dataUrl);
      state.crop.cropCanvas = new fabric.Canvas('cropCanvas');
    });

    // Aspect ratio buttons
    document.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.crop.ratio = btn.dataset.ratio;
        updateCropOverlay();
      });
    });

    // Position slider
    document.getElementById('cropPosition').addEventListener('input', updateCropOverlay);

    // Apply crop
    document.getElementById('applyCropBtn').addEventListener('click', applyCrop);

    // Download
    document.getElementById('downloadCropBtn').addEventListener('click', () => {
      if (state.crop.cropCanvas) {
        const dataUrl = state.crop.cropCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `裁剪_${state.crop.ratio}_${Date.now()}.png`;
        a.click();
      }
    });
  }

  function renderCropLayouts(proposals, dataUrl) {
    const container = document.getElementById('cropLayouts');
    container.innerHTML = '';
    proposals.forEach(prop => {
      const item = document.createElement('div');
      item.className = 'crop-layout-item';
      const crop = prop.crops[0];
      item.innerHTML = `<span>${prop.label}</span>`;
      item.addEventListener('click', () => {
        document.querySelectorAll('.crop-layout-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        state.crop.ratio = prop.ratio;
        document.querySelectorAll('.ratio-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.ratio === prop.ratio);
        });
        updateCropOverlay();
      });
      container.appendChild(item);
    });
  }

  function updateCropOverlay() {
    if (!state.crop.dataUrl || !state.crop.cropCanvas) return;
    const canvas = state.crop.cropCanvas;
    canvas.clear();

    const imgEl = document.getElementById('cropPreviewImg');
    const containerW = imgEl.clientWidth || 400;
    const containerH = imgEl.clientHeight || 300;

    canvas.setWidth(containerW);
    canvas.setHeight(containerH);

    fabric.Image.fromURL(state.crop.dataUrl, img => {
      const scale = Math.min(containerW / img.width, containerH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      img.set({
        left: containerW / 2,
        top: containerH / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        selectable: false,
      });
      canvas.add(img);

      // Overlay
      const overlay = new fabric.Rect({
        left: 0, top: 0,
        width: containerW, height: containerH,
        fill: 'rgba(0,0,0,0.6)',
        selectable: false,
        evented: false,
      });
      canvas.add(overlay);

      // Crop rect
      const ratio = state.crop.ratio;
      let cropW, cropH;
      if (ratio === 'free') {
        cropW = containerW * 0.6; cropH = containerH * 0.6;
      } else if (ratio === '1:1') {
        cropW = cropH = Math.min(containerW, containerH) * 0.8;
      } else if (ratio === '4:3') {
        cropW = containerW * 0.8; cropH = cropW * 3 / 4;
      } else if (ratio === '16:9') {
        cropW = containerW * 0.8; cropH = cropW * 9 / 16;
      } else if (ratio === '9:16') {
        cropH = containerH * 0.8; cropW = cropH * 9 / 16;
      }

      const position = parseInt(document.getElementById('cropPosition').value) / 100;
      const cx = containerW / 2;
      const cy = containerH / 2;

      // Clamp within bounds
      const maxX = containerW - cropW;
      const maxY = containerH - cropH;
      const rx = position * maxX;
      const ry = position * maxY;

      const cropRect = new fabric.Rect({
        left: rx,
        top: ry,
        width: cropW,
        height: cropH,
        fill: 'transparent',
        stroke: '#0055FF',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        rx: 4,
        ry: 4,
      });

      // Make overlay transparent in crop area
      const path = `
        M 0 0 L ${containerW} 0 L ${containerW} ${containerH} L 0 ${containerH} Z
        M ${rx} ${ry} L ${rx + cropW} ${ry} L ${rx + cropW} ${ry + cropH} L ${rx} ${ry + cropH} Z
      `;
      const mask = new fabric.Path(`M 0 0 L ${containerW} 0 L ${containerW} ${containerH} L 0 ${containerH} Z`, {
        fill: 'rgba(0,0,0,0.65)',
        selectable: false,
        evented: false,
      });
      const cropPath = new fabric.Rect({
        left: rx, top: ry, width: cropW, height: cropH,
        fill: 'transparent',
        stroke: '#0055FF',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      canvas.add(mask);
      canvas.add(cropPath);

      canvas.bringToFront(img);
      canvas.requestRenderAll();

      state.crop.cropRect = { x: rx / (img.width * scale), y: ry / (img.height * scale), width: cropW / (img.width * scale), height: cropH / (img.height * scale) };
      document.getElementById('downloadCropBtn').disabled = false;
    }, { crossOrigin: 'anonymous' });
  }

  async function applyCrop() {
    if (!state.crop.blob || !state.crop.cropRect) return;
    const canvas = state.crop.cropCanvas;
    const imgEl = document.getElementById('cropPreviewImg');
    const scale = Math.min((imgEl.clientWidth || 400) / state.crop.blob.width, (imgEl.clientHeight || 300) / state.crop.blob.height);

    const rect = state.crop.cropRect;
    const cropX = rect.x * state.crop.blob.width;
    const cropY = rect.y * state.crop.blob.height;
    const cropW2 = rect.width * state.crop.blob.width;
    const cropH2 = rect.height * state.crop.blob.height;

    try {
      const resultBlob = await LocalProcessor.applyCrop(state.crop.blob, { x: cropX, y: cropY, width: cropW2, height: cropH2 });
      const url = await blobToDataURL(resultBlob);
      document.getElementById('cropPreviewImg').src = url;
      document.getElementById('cropPreviewImg').style.display = 'block';
      showToast('裁剪完成！', 'success');
      state.crop.blob = resultBlob;
      state.crop.dataUrl = url;
      document.getElementById('downloadCropBtn').disabled = false;
    } catch (e) {
      showToast('裁剪失败: ' + e.message, 'error');
    }
  }

  // ===== Convert Tab =====
  function initConvertTab() {
    setupDropzone('convertDropzone', 'convertFileInput', async files => {
      for (const file of files) {
        const dataUrl = await fileToDataURL(file);
        state.convert.images.push({ id: uid(), file, dataUrl });
      }
      renderConvertThumbs();
      updateConvertUI();
    });

    // Format buttons
    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.convert.format = btn.dataset.format;
      });
    });

    // Quality
    const qualitySlider = document.getElementById('qualitySlider');
    const qualityValue = document.getElementById('qualityValue');
    qualitySlider.addEventListener('input', () => {
      state.convert.quality = parseInt(qualitySlider.value);
      qualityValue.textContent = qualitySlider.value + '%';
    });
    document.querySelectorAll('.quality-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const q = parseInt(btn.dataset.q);
        qualitySlider.value = q;
        qualityValue.textContent = q + '%';
        state.convert.quality = q;
      });
    });

    // Resize toggle
    document.getElementById('enableResize').addEventListener('change', e => {
      document.getElementById('resizeRow').style.display = e.target.checked ? 'flex' : 'none';
      if (e.target.checked && state.convert.images.length) {
        const firstImg = state.convert.images[0];
        document.getElementById('convertWidth').value = firstImg.file.width || '';
        document.getElementById('convertHeight').value = firstImg.file.height || '';
      }
    });

    document.getElementById('convertWidth').addEventListener('input', e => {
      state.convert.resizeW = parseInt(e.target.value) || 0;
      if (state.convert.keepAspect && state.convert.images.length) {
        const ratio = state.convert.images[0].file.width / state.convert.images[0].file.height;
        document.getElementById('convertHeight').value = Math.round(state.convert.resizeW / ratio);
        state.convert.resizeH = Math.round(state.convert.resizeW / ratio);
      }
    });
    document.getElementById('convertHeight').addEventListener('input', e => {
      state.convert.resizeH = parseInt(e.target.value) || 0;
    });

    // Clear
    document.getElementById('clearConvertBtn').addEventListener('click', () => {
      state.convert.images = [];
      state.convert.processed = [];
      renderConvertThumbs();
      updateConvertUI();
      document.getElementById('convertResults').style.display = 'none';
    });

    // Convert
    document.getElementById('convertBtn').addEventListener('click', processConvert);

    // Download
    document.getElementById('downloadConvertBtn').addEventListener('click', downloadConvertZip);
  }

  function renderConvertThumbs() {
    const list = document.getElementById('convertPreviewList');
    list.innerHTML = '';
    state.convert.images.forEach(img => {
      const div = document.createElement('div');
      div.className = 'preview-thumb';
      div.innerHTML = `<img src="${img.dataUrl}" alt=""><button class="thumb-remove">✕</button>`;
      div.querySelector('.thumb-remove').addEventListener('click', e => {
        e.stopPropagation();
        state.convert.images = state.convert.images.filter(i => i.id !== img.id);
        renderConvertThumbs();
        updateConvertUI();
      });
      list.appendChild(div);
    });
  }

  function updateConvertUI() {
    const has = state.convert.images.length > 0;
    document.getElementById('convertCount').textContent = state.convert.images.length + ' 张';
    document.getElementById('convertBtn').disabled = !has;
    document.getElementById('convertFooter').style.display = has ? 'flex' : 'none';
  }

  async function processConvert() {
    const images = state.convert.images;
    if (!images.length) return;

    const enableResize = document.getElementById('enableResize').checked;
    const targetW = enableResize ? (parseInt(document.getElementById('convertWidth').value) || 0) : 0;
    const targetH = enableResize ? (parseInt(document.getElementById('convertHeight').value) || 0) : 0;
    const format = state.convert.format;
    const quality = state.convert.quality;

    const progressDiv = document.getElementById('convertProgress');
    const fill = document.getElementById('convertProgressFill');
    const text = document.getElementById('convertProgressText');
    const count = document.getElementById('convertProgressCount');
    progressDiv.style.display = 'block';
    state.convert.processed = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      text.textContent = `转换 ${img.file.name}...`;
      count.textContent = `${i + 1}/${images.length}`;
      fill.style.width = `${((i + 1) / images.length) * 100}%`;

      try {
        const result = await LocalProcessor.convertImage(img.file, format, quality, targetW, targetH);
        const dataUrl = await blobToDataURL(result.blob);
        const ext = format === 'jpeg' ? 'jpg' : format;
        state.convert.processed.push({
          id: img.id,
          blob: result.blob,
          dataUrl,
          name: img.file.name.replace(/\.\w+$/, `_converted.${ext}`),
        });
      } catch (e) {
        showToast(`转换 ${img.file.name} 失败`, 'error');
      }
      await new Promise(r => setTimeout(r, 50));
    }

    progressDiv.style.display = 'none';
    renderConvertResults();
    showToast(`完成！共转换 ${state.convert.processed.length} 张图片`, 'success');
  }

  function renderConvertResults() {
    const section = document.getElementById('convertResults');
    const grid = document.getElementById('convertResultGrid');
    section.style.display = 'block';
    document.getElementById('convertResultCount').textContent = state.convert.processed.length + ' 张';
    document.getElementById('downloadConvertBtn').disabled = false;
    grid.innerHTML = '';
    state.convert.processed.forEach(item => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `
        <img src="${item.dataUrl}" alt="">
        <div class="result-item-info">
          <span class="result-item-name">${item.name}</span>
          <span class="result-item-size">${formatFileSize(item.blob)}</span>
        </div>
      `;
      div.addEventListener('click', () => downloadBlob(item.blob, item.name));
      grid.appendChild(div);
    });
  }

  async function downloadConvertZip() {
    const items = state.convert.processed;
    if (!items.length) return;
    showToast('正在打包...', 'info');
    try {
      const zip = new JSZip();
      items.forEach(item => zip.file(item.name, item.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `格式转换_${Date.now()}.zip`);
      showToast('ZIP 下载成功！', 'success');
    } catch (e) {
      showToast('打包失败: ' + e.message, 'error');
    }
  }

  // ===== Template Tab =====
  function initTemplateTab() {
    renderPresetCheckGrid();
    renderTemplateList();

    // Save template
    document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);

    // Add custom size
    document.getElementById('addCustomSizeBtn').addEventListener('click', () => {
      addCustomSizeRow();
    });

    // Delete custom sizes init
    renderCustomSizeRows([]);
  }

  function renderPresetCheckGrid() {
    const grid = document.getElementById('presetCheckGrid');
    const presets = [
      { id: 'douyin', name: '抖音', size: '1080×1920' },
      { id: 'xiaohongshu', name: '小红书', size: '1080×1350' },
      { id: 'moments', name: '朋友圈', size: '1080×1080' },
      { id: 'weibo', name: '微博', size: '1080×810' },
      { id: 'bilibili', name: 'B站', size: '1920×1080' },
      { id: 'wechat-banner', name: '微信Banner', size: '750×400' },
      { id: 'ecommerce-main', name: '电商主图', size: '800×800' },
      { id: 'ecommerce-detail', name: '电商详情', size: '750×1200' },
    ];
    grid.innerHTML = '';
    presets.forEach(p => {
      const item = document.createElement('label');
      item.className = 'preset-check-item';
      item.innerHTML = `
        <input type="checkbox" value="${p.id}">
        <span class="preset-icon" style="font-size:14px">📐</span>
        <span class="preset-name" style="font-size:11px">${p.name}</span>
        <span style="font-size:9px;color:var(--text-muted);font-family:var(--font-mono)">${p.size}</span>
      `;
      grid.appendChild(item);
    });
  }

  function getSelectedPresets() {
    const checked = document.querySelectorAll('#presetCheckGrid input:checked');
    return Array.from(checked).map(i => i.value);
  }

  function getCustomSizes() {
    const rows = document.querySelectorAll('.custom-size-row');
    return Array.from(rows).map(row => ({
      w: parseInt(row.querySelector('.size-w').value) || 0,
      h: parseInt(row.querySelector('.size-h').value) || 0,
    })).filter(s => s.w && s.h);
  }

  function updateTemplatePreview() {
    const preview = document.getElementById('templateSizesPreview');
    const selected = getSelectedPresets();
    const custom = getCustomSizes();
    const presets = [
      { id: 'douyin', name: '抖音', w: 1080, h: 1920 },
      { id: 'xiaohongshu', name: '小红书', w: 1080, h: 1350 },
      { id: 'moments', name: '朋友圈', w: 1080, h: 1080 },
      { id: 'weibo', name: '微博', w: 1080, h: 810 },
      { id: 'bilibili', name: 'B站', w: 1920, h: 1080 },
      { id: 'wechat-banner', name: '微信Banner', w: 750, h: 400 },
      { id: 'ecommerce-main', name: '电商主图', w: 800, h: 800 },
      { id: 'ecommerce-detail', name: '电商详情', w: 750, h: 1200 },
    ];
    const all = [
      ...selected.map(id => presets.find(p => p.id === id)).filter(Boolean),
      ...custom.map(s => ({ name: '自定义', w: s.w, h: s.h })),
    ];
    if (!all.length) {
      preview.innerHTML = '<p class="hint">从下方选择尺寸组合</p>';
      return;
    }
    preview.innerHTML = all.map(s => `<span class="template-size-tag">${s.name} ${s.w}×${s.h}</span>`).join('');
  }

  function addCustomSizeRow(w = '', h = '') {
    const container = document.getElementById('templateCustomSizes');
    const row = document.createElement('div');
    row.className = 'custom-size-row';
    row.innerHTML = `
      <div class="input-group" style="flex-direction:row;align-items:center;gap:6px">
        <label>W</label>
        <input type="number" class="size-w" min="1" max="4096" placeholder="宽" value="${w}">
      </div>
      <span style="color:var(--text-muted)">×</span>
      <div class="input-group" style="flex-direction:row;align-items:center;gap:6px">
        <label>H</label>
        <input type="number" class="size-h" min="1" max="4096" placeholder="高" value="${h}">
      </div>
      <button class="btn btn-icon btn-icon-sm" style="background:rgba(255,71,87,0.1);border-color:rgba(255,71,87,0.3);color:var(--error)" data-delete>✕</button>
    `;
    row.querySelector('[data-delete]').addEventListener('click', () => {
      row.remove();
      updateTemplatePreview();
    });
    row.querySelector('.size-w').addEventListener('input', updateTemplatePreview);
    row.querySelector('.size-h').addEventListener('input', updateTemplatePreview);
    container.appendChild(row);
  }

  function renderCustomSizeRows(sizes) {
    const container = document.getElementById('templateCustomSizes');
    container.innerHTML = '';
    sizes.forEach(s => addCustomSizeRow(s.w, s.h));
  }

  document.querySelectorAll('#presetCheckGrid').forEach(grid => {
    grid.addEventListener('change', updateTemplatePreview);
  });

  function saveTemplate() {
    const name = document.getElementById('templateName').value.trim();
    const tagsInput = document.getElementById('templateTags').value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];
    const presets = getSelectedPresets();
    const custom = getCustomSizes();

    if (!name) { showToast('请输入模板名称', 'error'); return; }
    if (!presets.length && !custom.length) { showToast('请至少选择一个尺寸', 'error'); return; }

    const presetDetails = presets.map(id => {
      const map = { douyin: [1080,1920], xiaohongshu: [1080,1350], moments: [1080,1080], weibo: [1080,810], bilibili: [1920,1080], 'wechat-banner': [750,400], 'ecommerce-main': [800,800], 'ecommerce-detail': [750,1200] };
      const dims = map[id] || [0, 0];
      return { id, w: dims[0], h: dims[1] };
    });

    const template = {
      id: uid(),
      name,
      tags,
      sizes: [...presetDetails, ...custom.map(s => ({ id: 'custom', w: s.w, h: s.h }))],
      createdAt: Date.now(),
    };

    state.templates.list.push(template);
    localStorage.setItem('imw_templates', JSON.stringify(state.templates.list));
    showToast(`模板 "${name}" 已保存！`, 'success');

    document.getElementById('templateName').value = '';
    document.getElementById('templateTags').value = '';
    document.querySelectorAll('#presetCheckGrid input').forEach(i => i.checked = false);
    document.getElementById('templateCustomSizes').innerHTML = '';
    updateTemplatePreview();
    renderTemplateList();
  }

  function renderTemplateList() {
    const list = document.getElementById('templateList');
    const templates = state.templates.list;

    if (!templates.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="8" width="14" height="14" rx="3" stroke="#667EEA" stroke-width="2"/><rect x="26" y="8" width="14" height="14" rx="3" stroke="#667EEA" stroke-width="2"/><rect x="8" y="26" width="14" height="14" rx="3" stroke="#667EEA" stroke-width="2"/><rect x="26" y="26" width="14" height="14" rx="3" stroke="#667EEA" stroke-width="2"/></svg>
          <p>暂无模板，保存一个吧</p>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    templates.forEach(t => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <div class="template-card-header">
          <span class="template-name">${t.name}</span>
        </div>
        ${t.tags.length ? `<div class="template-tags">${t.tags.map(tag => `<span class="template-tag">${tag}</span>`).join('')}</div>` : ''}
        <div class="template-sizes">
          ${t.sizes.map(s => `<span class="template-size-chip">${s.w}×${s.h}</span>`).join('')}
        </div>
        <div class="template-card-actions">
          <button class="btn btn-primary-outline btn-sm" data-apply>应用</button>
          <button class="btn btn-danger-outline btn-sm" data-delete>删除</button>
        </div>
      `;

      card.querySelector('[data-apply]').addEventListener('click', () => {
        applyTemplate(t);
      });

      card.querySelector('[data-delete]').addEventListener('click', () => {
        state.templates.list = state.templates.list.filter(tm => tm.id !== t.id);
        localStorage.setItem('imw_templates', JSON.stringify(state.templates.list));
        renderTemplateList();
        showToast('模板已删除', 'info');
      });

      list.appendChild(card);
    });
  }

  function applyTemplate(template) {
    // Switch to resize tab and set presets
    document.querySelector('[data-tab="resize"]').click();
    template.sizes.forEach(s => {
      if (s.id && s.id !== 'custom') {
        const item = document.querySelector(`[data-preset="${s.id}"]`);
        if (item) item.click();
      }
    });
    showToast(`已应用模板 "${template.name}" 的尺寸配置`, 'success');
  }

  // ===== Settings Modal =====
  function initSettings() {
    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('modalAk').value = localStorage.getItem('volc_ak') || '';
      document.getElementById('modalSk').value = localStorage.getItem('volc_sk') || '';
      document.getElementById('modalRegion').value = localStorage.getItem('volc_region') || 'cn-north-1';
      document.getElementById('settingsModal').style.display = 'flex';
    });

    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
    document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeSettings();
    });

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      const ak = document.getElementById('modalAk').value.trim();
      const sk = document.getElementById('modalSk').value.trim();
      const region = document.getElementById('modalRegion').value;
      if (ak) localStorage.setItem('volc_ak', ak);
      if (sk) localStorage.setItem('volc_sk', sk);
      localStorage.setItem('volc_region', region);
      state.outpaint.apiConfig = { ak, sk, region };
      closeSettings();
      showToast('API 配置已保存（仅本地存储）', 'success');
    });
  }

  function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initResizeTab();
    initOutpaintTab();
    initCropTab();
    initConvertTab();
    initTemplateTab();
    initSettings();
  });

})();
