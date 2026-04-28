/**
 * api.js — 火山引擎视觉 API 调用层
 * 包含 HMAC-SHA256 签名逻辑
 */

const API_CONFIG = {
  baseUrl: 'https://visual.volcengineapi.com',
  action: 'CVProcess',
  version: '2022-08-31',
  service: 'cv',
  region: 'cn-north-1',
};

/**
 * 对字节串进行 HMAC-SHA256 签名
 * 使用 Web Crypto API（现代浏览器内置）
 */
async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(message)
  );
  return signature;
}

/**
 * 将 ArrayBuffer 转换为十六进制字符串
 */
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 计算 Volcano Engine API 签名
 * 参考: https://www.volcengine.com/docs/视觉智能/IAM/签名方法
 */
async function generateSignature(params) {
  const { ak, sk, region } = params;
  const date = new Date();
  const datetime = date.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');

  // 1. 拼接 Content-Type 哈希（空body用空字符串）
  const hashedPayload = bufferToHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(''))
  );

  // 2. 拼接签名字符串
  const signedHeaders = 'content-type;host;x-date';
  const canonicalHeaders = [
    `content-type:application/json`,
    `host:visual.volcengineapi.com`,
    `x-date:${datetime}`
  ].join('\n') + '\n';

  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${API_CONFIG.service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    datetime,
    credentialScope,
    bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest)))
  ].join('\n');

  // 3. 计算签名密钥
  const kDate = await hmacSha256(sk, dateStamp);
  const kRegion = await hmacSha256(bufferToHex(kDate), region);
  const kService = await hmacSha256(bufferToHex(kRegion), API_CONFIG.service);
  const kSigning = await hmacSha256(bufferToHex(kService), 'request');
  const signature = bufferToHex(await hmacSha256(bufferToHex(kSigning), stringToSign));

  return {
    datetime,
    signature,
    credentialScope,
    signedHeaders,
    authorization: `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

/**
 * 调用火山引擎视觉 API（AI 尺寸延展）
 * @param {Object} params
 * @param {string} params.ak - Access Key
 * @param {string} params.sk - Secret Key
 * @param {string} params.region - 区域
 * @param {Blob} params.imageBlob - 输入图片 Blob
 * @param {number} params.strength - 延展强度 (0.1-1.0)
 * @param {number} params.scale - 缩放因子
 * @returns {Promise<Blob>} 延展后的图片 Blob
 */
async function callOutpaintingAPI(params) {
  const { ak, sk, region = 'cn-north-1', imageBlob, strength = 0.8, scale = 1.0 } = params;

  // 1. 生成签名
  const { datetime, authorization } = await generateSignature({ ak, sk, region });

  // 2. 准备请求体
  const boundary = `----FormBoundary${Date.now()}`;
  const formData = new FormData();

  // 图像数据（转为 base64）
  const arrayBuffer = await imageBlob.arrayBuffer();
  const base64Image = arrayBufferToBase64(arrayBuffer);

  const requestBody = {
    req_key: 'i2i_outpainting',
    strength,
    scale,
    image_data: `data:${imageBlob.type};base64,${base64Image}`,
  };

  formData.append('body', JSON.stringify(requestBody));

  // 3. 发送请求
  const headers = {
    'Authorization': authorization,
    'X-Date': datetime,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };

  const response = await fetch(`${API_CONFIG.baseUrl}/`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
  }

  // 4. 解析响应
  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(`API 错误: ${result.message || JSON.stringify(result)}`);
  }

  // 5. 提取结果图片（base64 → Blob）
  const base64Data = result.data.image_base64 || result.data.image_data || result.data.url;
  if (!base64Data) {
    throw new Error('API 响应中未找到图片数据');
  }

  return base64ToBlob(base64Data, 'image/png');
}

/**
 * 模拟 AI 尺寸延展（本地处理，API 未配置时降级）
 * 使用 canvas 扩展图片区域，填充渐变色模拟效果
 */
function mockOutpainting(imageBlob, targetWidth, targetHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(imageBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      // 中心对齐原图
      const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
      const scaledW = img.width * scale;
      const scaledH = img.height * scale;
      const offsetX = (targetWidth - scaledW) / 2;
      const offsetY = (targetHeight - scaledH) / 2;

      // 绘制渐变背景
      const grad = ctx.createLinearGradient(0, 0, targetWidth, targetHeight);
      grad.addColorStop(0, '#1A1A2E');
      grad.addColorStop(0.5, '#0A0E1A');
      grad.addColorStop(1, '#1A1A2E');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // 绘制图片
      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);

      // 添加光晕效果
      ctx.filter = 'blur(40px)';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;

      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        resolve(blob);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

/**
 * 辅助函数：ArrayBuffer → Base64
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 辅助函数：Base64 → Blob
 */
function base64ToBlob(base64, mimeType = 'image/png') {
  // 处理 data URI
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * 使用本地 Canvas 处理图片（占位符，在 api.js 中定义供 app.js 调用）
 */
const LocalProcessor = {
  /**
   * 按指定尺寸和模式处理图片
   */
  processImage(sourceImageBlob, targetWidth, targetHeight, mode = 'cover') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(sourceImageBlob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = targetWidth, dh = targetHeight;

        if (mode === 'cover') {
          // Cover: 裁剪填充
          const srcRatio = img.width / img.height;
          const dstRatio = targetWidth / targetHeight;
          if (srcRatio > dstRatio) {
            // 原图更宽，按高度为基准裁宽度
            sw = img.height * dstRatio;
            sx = (img.width - sw) / 2;
          } else {
            // 原图更高，按宽度为基准裁高度
            sh = img.width / dstRatio;
            sy = (img.height - sh) / 2;
          }
        } else if (mode === 'contain') {
          // Contain: 完整显示，添加背景
          const srcRatio = img.width / img.height;
          const dstRatio = targetWidth / targetHeight;
          if (srcRatio > dstRatio) {
            dh = targetWidth / srcRatio;
            dy = (targetHeight - dh) / 2;
          } else {
            dw = targetHeight * srcRatio;
            dx = (targetWidth - dw) / 2;
          }
          ctx.fillStyle = '#1A1A2E';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }
        // stretch: 直接绘制，不做处理

        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        URL.revokeObjectURL(url);

        canvas.toBlob(blob => {
          resolve({ blob, width: targetWidth, height: targetHeight });
        }, sourceImageBlob.type, 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  },

  /**
   * 格式转换 + 质量压缩 + 缩放
   */
  convertImage(sourceImageBlob, format, quality, targetWidth, targetHeight) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(sourceImageBlob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const w = targetWidth || img.width;
        const h = targetHeight || img.height;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        if (targetWidth && targetHeight) {
          // 缩放
          const srcRatio = img.width / img.height;
          const dstRatio = targetWidth / targetHeight;
          let sx = 0, sy = 0, sw = img.width, sh = img.height;
          let dx = 0, dy = 0, dw = w, dh = h;
          if (srcRatio > dstRatio) {
            sw = img.height * dstRatio;
            sx = (img.width - sw) / 2;
          } else {
            sh = img.width / dstRatio;
            sy = (img.height - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        } else {
          ctx.drawImage(img, 0, 0, w, h);
        }

        const mimeType = `image/${format}`;
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          resolve({ blob, width: w, height: h });
        }, mimeType, quality / 100);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  },

  /**
   * 智能裁剪（模拟 AI 识别，生成多个裁剪方案预览）
   */
  suggestCrops(sourceImageBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(sourceImageBlob);
      img.onload = () => {
        const w = img.width, h = img.height;
        const proposals = [
          { ratio: '1:1', label: '1:1 正方形', crops: [{ x: 0, y: (h-w)/2, width: w, height: w }] },
          { ratio: '4:3', label: '4:3', crops: [{ x: 0, y: 0, width: Math.min(w, h*4/3), height: Math.min(h, w*3/4) }] },
          { ratio: '16:9', label: '16:9', crops: [{ x: 0, y: (h - w*9/16)/2, width: w, height: w*9/16 }] },
          { ratio: '9:16', label: '9:16 竖版', crops: [{ x: (w - h*9/16)/2, y: 0, width: h*9/16, height: h }] },
        ];
        URL.revokeObjectURL(url);
        resolve({ width: w, height: h, proposals });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  },

  /**
   * 执行裁剪
   */
  applyCrop(sourceImageBlob, cropRect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(sourceImageBlob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = cropRect.width;
        canvas.height = cropRect.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, cropRect.width, cropRect.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => resolve(blob), sourceImageBlob.type, 0.95);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('裁剪失败')); };
      img.src = url;
    });
  }
};
