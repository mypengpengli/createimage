/* ImageForge Studio — App Logic (Extended) */

const DEFAULT_API_BASE = 'https://apichat.jiazhuangai.com';
const DEFAULT_GENERATION_MODEL = 'gpt-image-2';
const DEFAULT_EDIT_MODEL = 'gpt-image-2';
const DEFAULT_VIDEO_MODEL = 'agnes-video-v2.0';
const DEFAULT_POLISH_MODEL = 'agnes-2.0-flash';
const DB_NAME = 'imageforge';
const DB_VERSION = 2;
const STORE_NAME = 'history';
const VIDEO_TASKS_KEY = 'if_video_tasks';
const VIDEO_TEMP_CACHE_LIMIT = 3;
let db = null;
let currentGenResult = null;
let currentEditResult = null;
let currentDetailItem = null;
const tabResultImages = {};
let editSourceFile = null;
let maskSourceFile = null;
let historyFilter = 'all';
let activeVideoPollTimer = null;
let currentVideoTask = null;
const videoTempCache = new Map();

// Multi-upload storage
const uploads = { product: [], 'style-prod': [], clothing: [], 'clothing-model': [], refine: [], video: [] };
let styleRefFile = null;

document.addEventListener('DOMContentLoaded', () => {
  initDB();
  loadSettings();
  bindPromptCounter();
  setupDragDrop();
  initClothingModeUI();
  initVideoModeUI();
  renderVideoTasks();
  checkFirstRun();
  const editSize = document.getElementById('edit-size');
  if (editSize) editSize.addEventListener('change', () => {
    const row = document.getElementById('edit-custom-size');
    if (row) row.style.display = editSize.value === 'custom' ? 'flex' : 'none';
  });
});

function checkFirstRun() { const cfg = getConfig(); if (!cfg.apiKey) setTimeout(() => openSettings(), 500); updateEndpointIndicator(); }
function updateEndpointIndicator() { const cfg = getConfig(); const el = document.getElementById('endpoint-indicator'); if (!el) return; el.textContent = cfg.apiKey ? `已连接 ${cfg.apiBase.replace(/^https?:\/\//, '')}` : '未配置密钥'; el.className = 'endpoint-indicator' + (cfg.apiKey ? ' configured' : ' unconfigured'); }
function friendlyError(err) { const msg = err.message || String(err); if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '网络错误：无法连接到服务。'; if (msg.includes('CORS')) return '跨域错误 (CORS)'; return msg; }
function normalizeApiBase(value) { return (value || DEFAULT_API_BASE).trim().replace(/\/+$/, '').replace(/\/v1$/i, ''); }
function apiUrl(path) { return `${getConfig().apiBase}${path}`; }
function modelId(model) { return String(model || '').trim().toLowerCase(); }
const QWEN_IMAGE_MODEL = 'Qwen/Qwen-Image';
const QWEN_IMAGE_EDIT_MODEL = 'Qwen/Qwen-Image-Edit-2509';
const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';
function isQwenImageModel(model) { const id = modelId(model); return id.startsWith('qwen/qwen-image') || id.startsWith('qwen-image'); }
function isQwenImageEditModel(model) { const id = modelId(model); return id.startsWith('qwen/qwen-image-edit') || id.startsWith('qwen-image-edit'); }
function isQwenImageGenerationModel(model) { return isQwenImageModel(model) && !isQwenImageEditModel(model); }
function isAgnesImageModel(model) {
  const id = modelId(model).replace(/_/g, '-');
  return id === AGNES_IMAGE_MODEL || id === 'agnes-image-21-flash' || id === 'agnes-image-2-1-flash';
}
function isAgnesVideoModel(model) {
  const id = modelId(model).replace(/_/g, '-');
  return id === DEFAULT_VIDEO_MODEL || id === 'agnes-video-v20' || id === 'agnes-video-20' || id === 'agnes-video-2-0';
}
function normalizeConfiguredModel(model, type) {
  const raw = String(model || '').trim();
  const id = modelId(raw);
  if (type === 'generation' && id === 'f-image') return QWEN_IMAGE_MODEL;
  if (type === 'edit' && id === 'fix-image') return QWEN_IMAGE_EDIT_MODEL;
  if (isAgnesImageModel(raw)) return AGNES_IMAGE_MODEL;
  if (type === 'video' && isAgnesVideoModel(raw)) return DEFAULT_VIDEO_MODEL;
  return raw;
}
function getApiModel(model) { return isAgnesImageModel(model) ? AGNES_IMAGE_MODEL : String(model || '').trim(); }
function getApiVideoModel(model) { return isAgnesVideoModel(model) ? DEFAULT_VIDEO_MODEL : String(model || '').trim(); }
function appendAliasedImageEditParams(target) {
  target.num_inference_steps = 50;
  target.guidance_scale = 2;
}
function getAgnesImageSize(sizeSpec) {
  const spec = sizeSpec || makeSizeSpecFromApiSize('1024x1024');
  const label = String(spec.label || '').trim();
  const customMatch = spec.custom && label.match(/^(\d{2,5})\s*[x×:]\s*(\d{2,5})$/i);
  if (customMatch) return `${customMatch[1]}x${customMatch[2]}`;
  const ratioText = String(spec.ratio || '1:1');
  const commonSizes = {
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:2': '1536x1024',
    '16:9': '1024x576',
    '3:4': '768x1024',
    '2:3': '1024x1536',
    '9:16': '576x1024'
  };
  if (commonSizes[ratioText]) return commonSizes[ratioText];
  const ratio = parseRatio(ratioText);
  if (ratio > 1) return `1024x${Math.max(64, Math.round(1024 / ratio))}`;
  if (ratio < 1) return `${Math.max(64, Math.round(1024 * ratio))}x1024`;
  return '1024x1024';
}
function getAliasedImageSize(sizeSpec) {
  const ratio = parseRatio(sizeSpec?.ratio || '1:1');
  if (ratio > 1.7) return '1664x928';
  if (ratio > 1.42) return '1584x1056';
  if (ratio > 1.12) return '1472x1140';
  if (ratio < 0.58) return '928x1664';
  if (ratio < 0.72) return '1056x1584';
  if (ratio < 0.88) return '1140x1472';
  return '1328x1328';
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
function fileToImageSizeSpec(file) {
  return new Promise(resolve => {
    if (!file) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      resolve(makeSizeSpecFromRatio(w / h, `${w}:${h}`, `auto ${w}×${h}`, false));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
async function callAliasedImageEditGeneration(cfg, model, prompt, file) {
  const image = await fileToDataUrl(file);
  const body = { model: getApiModel(model), prompt, image };
  appendAliasedImageEditParams(body);
  const res = await fetch(apiUrl('/v1/images/generations'), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
  return res.json();
}
async function filesToDataUrls(files) {
  return Promise.all(files.map(fileToDataUrl));
}
async function filesToAgnesImageRefs(files) {
  return filesToDataUrls(files);
}
function buildAgnesImageEditPrompt(prompt, refCount) {
  const refText = refCount > 1 ? `the ${refCount} provided reference images` : 'the provided reference image';
  return `Use ${refText} as the visual source for this image-to-image edit. Follow this edit instruction: ${prompt}. Preserve the original subject identity, product shape, composition, camera angle, and important visual details unless the instruction explicitly changes them.`;
}
async function callJsonImageEditGeneration(cfg, model, prompt, files, sizeSpec, quality) {
  const list = Array.isArray(files) ? files : [files];
  if (!list.length) throw new Error('请先上传要编辑的图片');
  const agnesSizeSpec = isAgnesImageModel(model) && !sizeSpec ? await fileToImageSizeSpec(list[0]) : sizeSpec;
  if (isAgnesImageModel(model)) {
    const imageRefs = await filesToAgnesImageRefs(list);
    const agnesPrompt = buildAgnesImageEditPrompt(prompt, imageRefs.length);
    const body = {
      model: getApiModel(model),
      prompt: agnesPrompt,
      size: getAgnesImageSize(agnesSizeSpec),
      image: imageRefs,
      extra_body: { image: imageRefs, response_format: 'b64_json' }
    };
    console.debug('[ImageForge] Agnes image edit request', {
      model: body.model,
      size: body.size,
      imageCount: imageRefs.length,
      imageTransport: 'data-uri',
      hasTopLevelImage: Array.isArray(body.image) && body.image.length > 0,
      hasExtraBodyImage: Array.isArray(body.extra_body?.image) && body.extra_body.image.length > 0
    });
    const res = await fetch(apiUrl('/v1/images/generations'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
    return res.json();
  }
  const images = await filesToDataUrls(list);
  const image = images.length === 1 ? images[0] : images;
  const body = { model: getApiModel(model), prompt, image, n: 1 };
  appendImageRequestOptions(body, sizeSpec, quality, model);
  const res = await fetch(apiUrl('/v1/images/generations'), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
  return res.json();
}
function prefersJsonImageEdit(cfg) {
  return /ai\.t8star\.cn/i.test(cfg.apiBase || '');
}
function isFetchNetworkError(err) {
  const msg = err?.message || String(err);
  return msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('网络错误');
}
function getTabEditFiles(tab, files, modelFiles) {
  if (tab === 'style') {
    const list = [];
    if (styleRefFile) list.push(styleRefFile);
    files.forEach(f => list.push(f));
    return list.length ? list : files;
  }
  if (tab === 'clothing') return [...files, ...modelFiles];
  return files;
}
function appendImageRequestOptions(target, sizeSpec, quality, model) {
  if (isAgnesImageModel(model)) {
    if (target instanceof FormData) {
      target.append('size', getAgnesImageSize(sizeSpec));
    } else {
      delete target.n;
      delete target.quality;
      delete target.response_format;
      target.size = getAgnesImageSize(sizeSpec);
      target.return_base64 = true;
    }
    return sizeSpec || makeSizeSpecFromApiSize('1024x1024');
  }
  if (isQwenImageGenerationModel(model)) {
    if (target instanceof FormData) {
      target.append('image_size', getAliasedImageSize(sizeSpec));
    } else {
      target.image_size = getAliasedImageSize(sizeSpec);
    }
    return sizeSpec;
  }
  if (isQwenImageEditModel(model)) {
    if (!(target instanceof FormData)) appendAliasedImageEditParams(target);
    return sizeSpec;
  }
  if (sizeSpec) appendImageSize(target, sizeSpec);
  if (target instanceof FormData) {
    target.append('quality', quality);
    target.append('response_format', 'b64_json');
  } else {
    target.quality = quality;
    target.response_format = 'b64_json';
  }
  return sizeSpec;
}

// ===== IndexedDB =====
function initDB() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = e => { const _db = e.target.result; if (!_db.objectStoreNames.contains(STORE_NAME)) { const s = _db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true }); s.createIndex('type', 'type'); s.createIndex('createdAt', 'createdAt'); } };
  req.onsuccess = e => { db = e.target.result; refreshHistory(); };
}
function addToHistory(item) { return new Promise((res, rej) => { const tx = db.transaction(STORE_NAME, 'readwrite'); const r = tx.objectStore(STORE_NAME).add(item); r.onsuccess = () => { refreshHistory(); res(r.result); }; r.onerror = () => rej(r.error); }); }
function getAllHistory() { return new Promise(res => { const r = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); }
function deleteFromHistory(id) { return new Promise(res => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).delete(id); tx.oncomplete = () => { refreshHistory(); res(); }; }); }
function clearAllHistory() { return new Promise(res => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).clear(); tx.oncomplete = () => { refreshHistory(); res(); }; }); }

// ===== Settings =====
function getConfig() {
  const legacyModel = localStorage.getItem('if_image_model') || '';
  const rawGenerationModel = localStorage.getItem('if_generation_model') || legacyModel || DEFAULT_GENERATION_MODEL;
  const rawEditModel = localStorage.getItem('if_edit_model') || legacyModel || DEFAULT_EDIT_MODEL;
  const rawVideoModel = localStorage.getItem('if_video_model') || DEFAULT_VIDEO_MODEL;
  const generationModel = normalizeConfiguredModel(rawGenerationModel, 'generation') || DEFAULT_GENERATION_MODEL;
  const editModel = normalizeConfiguredModel(rawEditModel, 'edit') || DEFAULT_EDIT_MODEL;
  const videoModel = normalizeConfiguredModel(rawVideoModel, 'video') || DEFAULT_VIDEO_MODEL;
  if (generationModel !== rawGenerationModel) localStorage.setItem('if_generation_model', generationModel);
  if (editModel !== rawEditModel) localStorage.setItem('if_edit_model', editModel);
  if (videoModel !== rawVideoModel) localStorage.setItem('if_video_model', videoModel);
  return { apiBase: normalizeApiBase(localStorage.getItem('if_api_base') || DEFAULT_API_BASE), apiKey: localStorage.getItem('if_apikey') || '', generationModel, editModel, videoModel, polishModel: localStorage.getItem('if_polish_model') || '' };
}
function loadSettings() { const c = getConfig(); const k = document.getElementById('setting-apikey'); const b = document.getElementById('setting-api-base'); const gm = document.getElementById('setting-generation-model'); const em = document.getElementById('setting-edit-model'); const vm = document.getElementById('setting-video-model'); const m = document.getElementById('setting-polish-model'); if (k) k.value = c.apiKey; if (b) b.value = c.apiBase; if (gm) gm.value = c.generationModel; if (em) em.value = c.editModel; if (vm) vm.value = c.videoModel; if (m) m.value = c.polishModel; }
function saveSettings() { const k = document.getElementById('setting-apikey'); const b = document.getElementById('setting-api-base'); const gm = document.getElementById('setting-generation-model'); const em = document.getElementById('setting-edit-model'); const vm = document.getElementById('setting-video-model'); const m = document.getElementById('setting-polish-model'); if (k) localStorage.setItem('if_apikey', k.value.trim()); if (b) localStorage.setItem('if_api_base', normalizeApiBase(b.value)); if (gm) localStorage.setItem('if_generation_model', gm.value.trim() || DEFAULT_GENERATION_MODEL); if (em) localStorage.setItem('if_edit_model', em.value.trim() || DEFAULT_EDIT_MODEL); if (vm) localStorage.setItem('if_video_model', vm.value.trim() || DEFAULT_VIDEO_MODEL); if (m) localStorage.setItem('if_polish_model', m.value.trim()); closeSettings(); updateEndpointIndicator(); showToast('配置已保存'); }
function openSettings() { loadSettings(); document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function closeSettingsOutside(e) { if (e.target === e.currentTarget) closeSettings(); }
async function testConnection() { const status = document.getElementById('conn-status'); const apiKey = document.getElementById('setting-apikey').value.trim(); const apiBase = normalizeApiBase(document.getElementById('setting-api-base')?.value); if (!apiKey) { status.textContent = '✗ 请填写 API Key'; status.className = 'conn-status err'; return; } status.textContent = '测试中…'; status.className = 'conn-status'; try { const r = await fetch(`${apiBase}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) }); if (r.ok) { status.textContent = '✓ 连接正常'; status.className = 'conn-status ok'; } else { status.textContent = `✗ HTTP ${r.status}`; status.className = 'conn-status err'; } } catch (err) { status.textContent = `✗ ${friendlyError(err)}`; status.className = 'conn-status err'; } }
function toggleKeyVis() { const i = document.getElementById('setting-apikey'); i.type = i.type === 'password' ? 'text' : 'password'; }

// ===== Tabs =====
function switchTab(tab) { document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active')); document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active')); document.getElementById(`tab-${tab}`).classList.add('active'); document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active'); if (tab === 'history') refreshHistory(); if (tab === 'cases') initCases(); if (tab === 'video') renderVideoTasks(); }

// ===== Toggle Buttons =====
function toggleBtn(btn) {
  btn.parentElement.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (btn.closest('#clothing-mode-toggle')) updateClothingModeUI();
}

function getClothingMode() {
  const panel = document.getElementById('tab-clothing')?.querySelector('.control-panel');
  const modeBtn = panel?.querySelector('#clothing-mode-toggle .quality-btn.active');
  return modeBtn?.querySelector('.q-label')?.textContent?.trim() || modeBtn?.textContent?.trim() || '基础套图';
}

function initClothingModeUI() {
  const modeToggle = document.getElementById('clothing-mode-toggle');
  if (!modeToggle) return;
  modeToggle.querySelectorAll('.quality-btn').forEach(btn => btn.addEventListener('click', updateClothingModeUI));
  updateClothingModeUI();
}

function updateClothingModeUI() {
  const mode = getClothingMode();
  const promptEl = document.getElementById('clothing-prompt');
  const helpEl = document.getElementById('clothing-mode-help');
  const modelSection = document.getElementById('clothing-model-section');
  const uploadLabel = document.getElementById('clothing-upload-label');
  const uploadText = document.getElementById('clothing-upload-text');
  const uploadHint = document.getElementById('clothing-upload-hint');

  const copy = {
    '模特试穿': {
      placeholder: '模特试穿用法：上传服装产品图；可选上传模特图。\\n\\n有模特图：AI 会把服装穿到该模特身上。\\n没有模特图：AI 自动生成合适模特。\\n\\n简单写需求即可，例如：年轻女模特，棚拍白底，自然站姿',
      help: '上传服装产品图；可选上传模特图。有模特图就换装到该模特，没有模特图则自动生成模特试穿。',
      uploadLabel: '服装产品图',
      uploadText: '上传服装/产品图（必传）',
      uploadHint: '支持多角度/细节图 (0/6)',
      showModel: true
    },
    '基础套图': {
      placeholder: '基础套图用法：上传服装产品图，简单写款式/风格即可。\\n\\n例如：白色连衣裙，夏季清新风，生成白底主图、平铺图、细节特写',
      help: '基础套图=不生成真人试穿，主要生成白底主图、平铺/挂拍、面料/领口/袖口等细节图。',
      uploadLabel: '产品图',
      uploadText: '上传多角度产品图或细节图',
      uploadHint: '拖拽或点击上传 (0/6)',
      showModel: false
    }
  };
  const cfg = copy[mode] || copy['基础套图'];
  if (promptEl) promptEl.placeholder = cfg.placeholder;
  if (helpEl) helpEl.textContent = cfg.help;
  if (modelSection) modelSection.style.display = cfg.showModel ? '' : 'none';
  if (uploadLabel) uploadLabel.textContent = cfg.uploadLabel;
  if (uploadText) uploadText.textContent = cfg.uploadText;
  if (uploadHint) uploadHint.textContent = cfg.uploadHint;
}

function selectStyleStrength(btn) {
  const wrap = document.getElementById('style-strength-toggle');
  if (!wrap) return toggleBtn(btn);
  wrap.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function getStyleStrength() {
  return document.querySelector('#style-strength-toggle .quality-btn.active')?.dataset.strength || 'medium';
}

function getStyleOutputType() {
  return document.getElementById('style-output')?.value || 'detail';
}

function getPanelValue(panelOrId, selector, attr, fallback) {
  const panel = typeof panelOrId === 'string' ? document.getElementById(panelOrId) : panelOrId;
  return panel?.querySelector(selector)?.getAttribute(attr) || fallback;
}

function getPanelQuality(panelOrId) {
  return getPanelValue(panelOrId, '.quality-toggle .quality-btn.active[data-quality]', 'data-quality', 'high');
}

function getPanelSize(panelOrId) {
  const panel = typeof panelOrId === 'string' ? document.getElementById(panelOrId) : panelOrId;
  const grid = panel?.querySelector('.size-grid');
  if (!grid) return { apiSize: '1024x1024', ratio: '1:1', label: '1:1', custom: false };
  const active = grid.querySelector('.size-btn.active');
  const selected = grid.dataset.selectedSize || active?.dataset.size;
  const selectedRatio = grid.dataset.selectedRatio || active?.dataset.ratio || selected || '1:1';
  if (selectedRatio === 'custom') {
    const w = parseInt(panel.querySelector('.custom-width')?.value, 10);
    const h = parseInt(panel.querySelector('.custom-height')?.value, 10);
    if (w > 0 && h > 0) return makeSizeSpecFromRatio(w / h, `${w}:${h}`, `${w}×${h}`, true);
    return makeSizeSpecFromRatio(1, '1:1', '自定义未填写，按 1:1', true);
  }
  if (selected && /^\d+x\d+$/.test(selected)) return makeSizeSpecFromApiSize(selected);
  return makeSizeSpecFromRatio(parseRatio(selectedRatio), selectedRatio, selectedRatio, false);
}

function parseRatio(ratio) {
  if (typeof ratio === 'number') return ratio;
  const m = String(ratio || '1:1').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return m ? (parseFloat(m[1]) / parseFloat(m[2])) : 1;
}

function makeSizeSpecFromApiSize(apiSize) {
  const map = {
    '1024x1024': { ratio: '1:1', label: '1024×1024' },
    '1536x1024': { ratio: '3:2', label: '1536×1024' },
    '1024x1536': { ratio: '2:3', label: '1024×1536' }
  };
  const meta = map[apiSize] || map['1024x1024'];
  return { apiSize: map[apiSize] ? apiSize : '1024x1024', ratio: meta.ratio, label: meta.label, custom: false };
}

function makeSizeSpecFromRatio(value, ratio, label, custom) {
  const apiSize = value > 1.12 ? '1536x1024' : value < 0.88 ? '1024x1536' : '1024x1024';
  return { apiSize, ratio, label, custom };
}

function getSizePrompt(sizeSpec) {
  if (!sizeSpec) return '';
  return `
Composition/output aspect ratio requirement: create the final image in ${sizeSpec.label || sizeSpec.ratio} aspect ratio (${sizeSpec.ratio}). This ratio is mandatory. Fit the layout to this canvas; do not crop the main product. `;
}

function appendImageSize(target, sizeSpec) {
  const spec = typeof sizeSpec === 'string' ? makeSizeSpecFromApiSize(sizeSpec) : (sizeSpec || makeSizeSpecFromApiSize('1024x1024'));
  if (target instanceof FormData) target.append('size', spec.apiSize);
  else target.size = spec.apiSize;
  return spec;
}
// ===== Prompt =====
function bindPromptCounter() { const el = document.getElementById('gen-prompt'); const c = document.getElementById('prompt-count'); if (el && c) el.addEventListener('input', () => c.textContent = el.value.length); }
function clearPrompt() { document.getElementById('gen-prompt').value = ''; document.getElementById('prompt-count').textContent = '0'; }
function useExample(text) { document.getElementById('gen-prompt').value = text; document.getElementById('prompt-count').textContent = text.length; }

// ===== Multi Upload =====
function handleMultiUpload(event, key, max) {
  max = max || 6;
  const files = Array.from(event.target.files).filter(f => f.type.startsWith('image/')).slice(0, max);
  uploads[key] = files;
  renderMultiPreviews(key);
}
function setMultiUploadFiles(key, fileList, max) {
  max = max || 6;
  uploads[key] = Array.from(fileList).filter(f => f.type.startsWith('image/')).slice(0, max);
  renderMultiPreviews(key);
}
function renderMultiPreviews(key) {
  const files = uploads[key] || [];
  const placeholder = document.getElementById(`${key}-placeholder`);
  const previews = document.getElementById(`${key}-previews`);
  if (files.length > 0) {
    if (placeholder) placeholder.style.display = 'none';
    if (previews) { previews.style.display = 'flex'; previews.innerHTML = files.map((f,i) => `<div class="mp-thumb"><img src="${URL.createObjectURL(f)}" /><button class="mp-remove" onclick="event.stopPropagation();removeUpload('${key}',${i})">&times;</button></div>`).join(''); }
  } else {
    if (placeholder) placeholder.style.display = '';
    if (previews) { previews.style.display = 'none'; previews.innerHTML = ''; }
  }
  if (key === 'clothing' || key === 'clothing-model') updateClothingModeUI();
}
function removeUpload(key, index) {
  uploads[key].splice(index, 1);
  renderMultiPreviews(key);
}

function handleSingleUpload(event, key) {
  const file = event.target.files[0]; if (!file) return;
  if (key === 'style-ref') {
    styleRefFile = file;
    const placeholder = document.getElementById('style-ref-placeholder');
    const img = document.getElementById('style-ref-img');
    const rmBtn = document.getElementById('style-ref-remove');
    placeholder.style.display = 'none'; img.style.display = 'block'; img.src = URL.createObjectURL(file);
    if (rmBtn) rmBtn.style.display = 'flex';
  }
}
function clearSingleUpload(key) {
  if (key === 'style-ref') {
    styleRefFile = null;
    const placeholder = document.getElementById('style-ref-placeholder');
    const img = document.getElementById('style-ref-img');
    const rmBtn = document.getElementById('style-ref-remove');
    placeholder.style.display = ''; img.style.display = 'none'; img.src = '';
    if (rmBtn) rmBtn.style.display = 'none';
    document.getElementById('style-ref-input').value = '';
  }
}

// ===== AI Write (all tabs) =====
let _aiWriting = {};
async function aiWrite(tab) {
  if (_aiWriting[tab]) return;
  const el = document.getElementById(`${tab}-prompt`);
  const text = el.value.trim();
  const cfg = getConfig();
  if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }
  const sysPrompts = {
    product: 'You are an e-commerce image optimization expert. Generate an English prompt for the AI image editor. CRITICAL RULE: The product appearance, shape, color, design, and details must remain EXACTLY as in the original uploaded image — do NOT change, redesign, or reimagine the product itself. Only optimize: background (clean white/gradient), lighting (studio quality), composition (centered, best angle), and overall image quality. Output pure prompt only, no explanation.',
    style: 'You are a senior e-commerce visual designer. Generate a SHORT English prompt for style replication using two roles: reference design image = style/layout/color/font/composition inspiration; product material images = the exact product to keep. The output should transfer the reference image visual style to the user product, not copy the reference product. Preserve the user product appearance exactly. Mention clean commercial layout and readable text. Output pure prompt only.',
    clothing: getClothingMode() === '模特试穿'
      ? 'You are a fashion e-commerce prompt expert. Generate a SHORT English prompt for virtual try-on. If a model image is provided, instruct the AI to dress that exact model in the uploaded garment. If no model image is provided, instruct the AI to create a suitable fashion model wearing the uploaded garment. CRITICAL: preserve the garment design, pattern, color, fabric, logo, and details exactly. Output pure prompt only, no explanation.'
      : 'You are a fashion e-commerce prompt expert. Generate a SHORT English prompt for clothing basic product image sets: white-background hero image, flat lay/hanger/mannequin display, fabric and detail closeups. CRITICAL: no human model, preserve garment design, pattern, color, fabric, logo, and details exactly. Output pure prompt only, no explanation.',
    refine: 'You are a product photo retouching expert. Generate an English prompt for image enhancement. CRITICAL RULE: The product must look IDENTICAL to the original — same shape, color, texture, every detail preserved. Only enhance: resolution, sharpness, lighting balance, background cleanup, remove blemishes/dust, color accuracy. Never modify the product design. Output pure prompt only.'
  };
  const defaultPrompts = { product: '请生成电商商品图提示词', style: '请生成设计风格描述', clothing: '请生成服装拍摄描述', refine: '请生成精修指令' };
  const prompt = text || defaultPrompts[tab] || '请生成描述';
  const sysPrompt = sysPrompts[tab] || sysPrompts.product;
  const panel = document.getElementById(`tab-${tab}`).querySelector('.control-panel');
  const btn = panel.querySelector('.text-btn.accent');
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<span class="btn-spinner-sm"></span> AI 思考中…'; btn.disabled = true; btn.style.opacity = '0.7'; }
  _aiWriting[tab] = true;
  try {
    const result = await callChatAPI(sysPrompt, prompt, false);
    if (result) { el.value = result; showToast('AI 帮写完成'); }
  } catch (err) { showToast('AI 帮写失败: ' + err.message); }
  finally { _aiWriting[tab] = false; if (btn) { btn.innerHTML = origHTML; btn.disabled = false; btn.style.opacity = ''; } }
}

// ===== Generate New (for new tabs) =====
async function generateNew(tab) {
  const promptEl = document.getElementById(`${tab}-prompt`);
  const prompt = promptEl ? promptEl.value.trim() : '';
  const cfg = getConfig();
  if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }

  // Get size
  const panel = document.getElementById(`tab-${tab}`).querySelector('.control-panel');
  const sizeEl = document.getElementById(`${tab}-size`);
  let size = getPanelSize(panel);
  if (sizeEl) size = makeSizeSpecFromRatio(parseRatio(sizeEl.value), sizeEl.value, sizeEl.value, false);

  // Get quality from the current tab only. Do not use document-wide active buttons,
  // otherwise another module's active quality can leak into the request.
  const quality = getPanelQuality(panel);

  const container = document.getElementById(`${tab}-preview`);
  const btn = container.closest('.generate-layout').querySelector('.primary-btn');
  const loading = container.querySelector('.loading-state');
  const result = container.querySelector('.result-state');
  const empty = container.querySelector('.empty-state');

  tabResultImages[tab] = [];
  updateBatchDownloadButton(tab, 0);
  container.classList.remove('empty'); empty.style.display = 'none'; result.style.display = 'none'; result.classList.remove('has-result-grid'); loading.style.display = 'flex';
  btn.disabled = true; btn.querySelector('.btn-content').style.display = 'none'; btn.querySelector('.btn-loading').style.display = 'flex';

  const t0 = Date.now();
  try {
    const files = uploads[tab] || [];
    const modelFiles = tab === 'clothing' ? (uploads['clothing-model'] || []) : [];
    const clothingMode = tab === 'clothing' ? getClothingMode() : '';
    const hasFiles = files.length > 0 || modelFiles.length > 0 || (tab === 'style' && styleRefFile);
    const requestModel = hasFiles ? cfg.editModel : cfg.generationModel;
    const countEl = document.getElementById(`${tab}-count`);
    const count = countEl ? parseInt(countEl.value) || 1 : 1;
    const fullPrompt = buildPrompt(tab, prompt) + getSizePrompt(size);

    // Fire `count` requests in parallel, each generating 1 image
    const tasks = [];
    for (let i = 0; i < count; i++) {
      const requestSize = size;
      if (hasFiles) {
        const jsonEditFiles = getTabEditFiles(tab, files, modelFiles);
        if (isAgnesImageModel(requestModel)) {
          if (tab === 'clothing' && files.length === 0) throw new Error(clothingMode === '模特试穿' ? '请先上传服装产品图；模特图是可选的' : '请先上传服装产品图');
          tasks.push(callJsonImageEditGeneration(cfg, requestModel, fullPrompt, jsonEditFiles, requestSize, quality));
          continue;
        }
        if (isQwenImageEditModel(requestModel)) {
          const editFile = jsonEditFiles[0];
          if (!editFile) throw new Error('请先上传要编辑的图片');
          tasks.push(callAliasedImageEditGeneration(cfg, requestModel, fullPrompt, editFile));
          continue;
        }
        if (tab === 'clothing' && files.length === 0) throw new Error(clothingMode === '模特试穿' ? '请先上传服装产品图；模特图是可选的' : '请先上传服装产品图');
        if (prefersJsonImageEdit(cfg)) {
          tasks.push(callJsonImageEditGeneration(cfg, requestModel, fullPrompt, jsonEditFiles, requestSize, quality));
          continue;
        }
        const fd = new FormData();
        if (tab === 'style') {
          const mainFile = styleRefFile || files[0];
          if (mainFile) fd.append('image', mainFile);
          files.forEach(f => fd.append('image', f));
        } else if (tab === 'clothing') {
          // API receives every uploaded image. The prompt labels roles clearly:
          // garment/product images are the clothing source; model images are optional human references.
          files.forEach(f => fd.append('image', f));
          modelFiles.forEach(f => fd.append('image', f));
        } else {
          files.forEach(f => fd.append('image', f));
        }
        fd.append('prompt', fullPrompt);
        fd.append('model', getApiModel(requestModel));
        fd.append('n', '1');
        appendImageRequestOptions(fd, requestSize, quality, requestModel);
        tasks.push(fetch(apiUrl('/v1/images/edits'), {
          method: 'POST', headers: { 'Authorization': `Bearer ${cfg.apiKey}` }, body: fd
        }).then(async r => { if (!r.ok) { const t = await r.text(); throw new Error(parseApiError(t, r.status)); } return r.json(); })
          .catch(err => {
            if (!isFetchNetworkError(err)) throw err;
            return callJsonImageEditGeneration(cfg, requestModel, fullPrompt, jsonEditFiles, requestSize, quality);
          }));
      } else {
        if (!fullPrompt) throw new Error('请输入描述或上传图片');
        const body = { prompt: fullPrompt, model: getApiModel(requestModel), n: 1 };
        appendImageRequestOptions(body, size, quality, requestModel);
        tasks.push(fetch(apiUrl('/v1/images/generations'), {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(async r => { if (!r.ok) { const t = await r.text(); throw new Error(parseApiError(t, r.status)); } return r.json(); }));
      }
    }

    const results = await Promise.allSettled(tasks);
    const allImages = [];
    let failCount = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') allImages.push(...extractAllImages(r.value));
      else failCount++;
    }
    if (!allImages.length) {
      const firstErr = results.find(r => r.status === 'rejected');
      throw firstErr ? firstErr.reason : new Error('API 未返回图片数据');
    }
    if (failCount > 0) showToast(`${failCount} 张生成失败，已展示成功的 ${allImages.length} 张`, 4000);
    // Convert remote URLs to base64
    const b64All = [];
    for (const src of allImages) {
      if (src.startsWith('http')) { try { b64All.push(await blobToBase64(await (await fetch(src)).blob())); } catch { b64All.push(src); } }
      else b64All.push(src);
    }

    loading.style.display = 'none'; result.style.display = 'flex';
    const resultImg = document.getElementById(`${tab}-result-img`);
    tabResultImages[tab] = b64All;
    updateBatchDownloadButton(tab, b64All.length);
    // Show first image in main preview
    resultImg.src = b64All[0];
    // If multiple images, show grid
    if (b64All.length > 1) {
      result.classList.add('has-result-grid');
      let grid = result.querySelector('.result-grid');
      if (!grid) { grid = document.createElement('div'); grid.className = 'result-grid'; result.appendChild(grid); }
      grid.innerHTML = b64All.map((src, i) => `<img src="${src}" class="result-grid-item${i === 0 ? ' active' : ''}" onclick="selectResultImg(this, '${tab}')" />`).join('');
      grid.style.display = 'flex';
    } else {
      result.classList.remove('has-result-grid');
      const grid = result.querySelector('.result-grid'); if (grid) grid.style.display = 'none';
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    // Save all images to history
    for (const b64 of b64All) {
      await addToHistory({ type: tab, prompt: prompt || '(image)', size: size.label || size.apiSize, model: requestModel, imageData: b64, elapsed: +elapsed, createdAt: Date.now() });
    }
    showToast(`生成完成，共 ${b64All.length} 张`);
  } catch (err) {
    loading.style.display = 'none';
    // Show error in the preview area instead of just a toast
    let errDiv = container.querySelector('.error-state');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.className = 'error-state';
      container.appendChild(errDiv);
    }
    const errMsg = friendlyError(err);
    errDiv.innerHTML = `<div class="error-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="error-title">生成失败</div><div class="error-msg">${errMsg}</div><button class="error-retry" onclick="this.closest('.error-state').style.display='none';document.getElementById('${tab}-preview').querySelector('.empty-state').style.display='flex';document.getElementById('${tab}-preview').classList.add('empty')">知道了</button>`;
    errDiv.style.display = 'flex';
    empty.style.display = 'none'; result.style.display = 'none';
  } finally {
    btn.disabled = false; btn.querySelector('.btn-content').style.display = 'flex'; btn.querySelector('.btn-loading').style.display = 'none';
  }
}

function buildPrompt(tab, userPrompt) {
  const base = {
    product: 'Edit this product photo for e-commerce use. IMPORTANT: Keep the product exactly as it is - same shape, color, design, every detail unchanged. Only improve: background (clean white/studio gradient), lighting (professional studio), composition, and image quality. ',
    style: 'Use the uploaded reference design image ONLY as visual style inspiration: color palette, typography feeling, layout structure, composition rhythm, lighting mood, decorative elements, background treatment, and e-commerce design language. Use the uploaded product material images as the actual product subject. IMPORTANT: preserve the user product exactly - same shape, color, material, logo, texture, proportions, and every detail. Do not copy or keep the product from the reference design image. Create a new commercial design for the user product. ',
    clothing: 'Create e-commerce clothing images from the uploaded garment/product photos. IMPORTANT: preserve the garment exactly as uploaded - same design, silhouette, pattern, color, fabric texture, logo, seams, buttons, and all details. Do not copy the input photo unchanged; create a new commercial output according to the selected clothing mode. ',
    refine: 'Retouch and enhance this product photo. IMPORTANT: The product must look identical to the original - preserve every detail of its appearance. Only enhance: sharpness, lighting balance, remove dust/blemishes, clean background, improve overall image quality. '
  };
  let prompt = base[tab] || '';

  // Product tab extras
  if (tab === 'product') {
    const panel = document.getElementById('tab-product').querySelector('.control-panel');
    // Image type
    const typeBtn = panel.querySelectorAll('.quality-toggle')[0]?.querySelector('.quality-btn.active');
    const imgType = typeBtn?.textContent?.trim();
    if (imgType === '主图') prompt += 'Create a hero/main product image, single clean shot, white background, centered product. ';
    else if (imgType === '详情图') prompt += 'Create a detailed product description image with multiple angles, close-up details, and feature callouts. ';
    // Platform
    const platform = document.getElementById('product-platform')?.value;
    const platformMap = {
      amazon: 'Optimized for Amazon listing: clean white or premium lifestyle background, product centered, strong thumbnail readability, minimal compliant text, professional infographic callouts for key features. ',
      shopify: 'Optimized for Shopify DTC storefront: brand-focused premium visual, clean modern layout, lifestyle atmosphere, elegant product storytelling, conversion-oriented hero image. ',
      taobao: 'Optimized for Taobao/Tmall Chinese e-commerce: vibrant high-conversion visual, clear selling points, promotional atmosphere, Chinese typography areas, strong product benefit callouts. ',
      tmall: 'Optimized for Tmall flagship-store style: premium brand feel, polished composition, refined Chinese copy areas, high trust and quality impression. ',
      jd: 'Optimized for JD.com listing: clean trustworthy product presentation, clear technical/feature callouts, neat composition, strong sense of quality and authenticity. ',
      pdd: 'Optimized for Pinduoduo: eye-catching bargain/value visual, bold promotional blocks, clear price-benefit feeling, lively colors, simple direct selling points. ',
      douyin: 'Optimized for Douyin e-commerce: trendy short-video commerce style, high-impact first-screen visual, strong contrast, youthful layout, bold hook text area. ',
      kuaishou: 'Optimized for Kuaishou shop: direct sales style, warm practical visual, big readable benefit text, approachable and trustworthy product presentation. ',
      xiaohongshu: 'Optimized for Xiaohongshu: lifestyle seeding style, clean aesthetic composition, premium soft lighting, natural scene, social-media friendly notes/callout layout. ',
      wechat: 'Optimized for WeChat Store/Channels: clean trustworthy social-commerce poster, readable Chinese headline area, community-friendly premium product presentation. ',
      '1688': 'Optimized for 1688 wholesale/B2B: factory supply and bulk purchasing feel, emphasize source factory, wholesale price, MOQ, specifications, multiple variants, durable quality, clean catalog-style layout with strong Chinese B2B information blocks. ',
      alibaba: 'Optimized for Alibaba.com international B2B: professional global wholesale product image, supplier/manufacturer trust, MOQ and specification callouts, export-ready clean catalog style, English text areas. ',
      aliexpress: 'Optimized for AliExpress retail export: colorful international marketplace style, clear discount/benefit callouts, shipping-friendly product presentation, multilingual-friendly clean text areas. ',
      lazada: 'Optimized for Lazada marketplace: Southeast Asia e-commerce style, bright clean promotional visual, clear discount badges, mobile-first product readability. ',
      shopee: 'Optimized for Shopee marketplace: vibrant orange-friendly promotional style, mobile-first square image, bold sale badges, clear product benefits and discount atmosphere. ',
      tiktok: 'Optimized for TikTok Shop: trendy, eye-catching, high-contrast, social-commerce visual with bold hook area and dynamic composition. ',
      temu: 'Optimized for Temu: strong value-for-money visual, clear product utility, bold deal-oriented design, clean white or bright promotional background. ',
      shein: 'Optimized for SHEIN: fashion-forward trendy composition, clean catalog/lifestyle hybrid, youthful styling, strong visual consistency and product appeal. ',
      ebay: 'Optimized for eBay listing: clear product-first image, trustworthy marketplace style, neutral background, concise feature highlights, strong used/new condition clarity if relevant. ',
      etsy: 'Optimized for Etsy: handmade boutique aesthetic, warm natural lighting, craft/premium feel, lifestyle props, artisanal brand presentation. ',
      walmart: 'Optimized for Walmart marketplace: clean family-friendly retail image, practical product benefits, trustworthy composition, bright neutral background. ',
      rakuten: 'Optimized for Rakuten Japan: clean Japanese marketplace style, neat information hierarchy, quality/trust feeling, readable Japanese text areas if needed. ',
      coupang: 'Optimized for Coupang Korea: clean fast-commerce product image, practical benefit callouts, modern trustworthy layout, strong mobile readability. ',
      mercadolibre: 'Optimized for Mercado Libre Latin America: bright marketplace-friendly visual, clear value and benefit callouts, clean product focus, Spanish/Portuguese text areas if needed. '
    };
    if (platform && platform !== 'auto' && platformMap[platform]) prompt += platformMap[platform];
    // Language
    const lang = document.getElementById('product-lang')?.value;
    const langMap = {
      none: 'No text overlay, pure visual product image. ',
      zh: 'Include clean, readable Simplified Chinese text labels/descriptions on the image. Use natural Chinese e-commerce copy, avoid garbled characters. ',
      'zh-tw': 'Include clean, readable Traditional Chinese text labels/descriptions on the image. Use natural Traditional Chinese marketing copy, avoid garbled characters. ',
      en: 'Include clean, readable English text labels/descriptions on the image. Use concise natural e-commerce copy. ',
      ja: 'Include clean, readable Japanese text labels/descriptions on the image. Use natural Japanese e-commerce copy. ',
      ko: 'Include clean, readable Korean text labels/descriptions on the image. Use natural Korean e-commerce copy. ',
      es: 'Include clean, readable Spanish text labels/descriptions on the image. Use natural Spanish e-commerce copy. ',
      pt: 'Include clean, readable Portuguese text labels/descriptions on the image. Use natural Portuguese e-commerce copy. ',
      fr: 'Include clean, readable French text labels/descriptions on the image. Use natural French e-commerce copy. ',
      de: 'Include clean, readable German text labels/descriptions on the image. Use natural German e-commerce copy. ',
      it: 'Include clean, readable Italian text labels/descriptions on the image. Use natural Italian e-commerce copy. ',
      nl: 'Include clean, readable Dutch text labels/descriptions on the image. Use natural Dutch e-commerce copy. ',
      ru: 'Include clean, readable Russian text labels/descriptions on the image. Use natural Russian e-commerce copy. ',
      ar: 'Include clean, readable Arabic text labels/descriptions on the image. Use right-to-left Arabic layout where text appears. ',
      hi: 'Include clean, readable Hindi text labels/descriptions on the image. Use natural Hindi e-commerce copy. ',
      id: 'Include clean, readable Indonesian text labels/descriptions on the image. Use natural Bahasa Indonesia e-commerce copy. ',
      ms: 'Include clean, readable Malay text labels/descriptions on the image. Use natural Bahasa Melayu e-commerce copy. ',
      th: 'Include clean, readable Thai text labels/descriptions on the image. Use natural Thai e-commerce copy. ',
      vi: 'Include clean, readable Vietnamese text labels/descriptions on the image. Use natural Vietnamese e-commerce copy. ',
      tl: 'Include clean, readable Filipino/Tagalog text labels/descriptions on the image. Use natural Filipino e-commerce copy. ',
      tr: 'Include clean, readable Turkish text labels/descriptions on the image. Use natural Turkish e-commerce copy. ',
      pl: 'Include clean, readable Polish text labels/descriptions on the image. Use natural Polish e-commerce copy. ',
      uk: 'Include clean, readable Ukrainian text labels/descriptions on the image. Use natural Ukrainian e-commerce copy. ',
      he: 'Include clean, readable Hebrew text labels/descriptions on the image. Use right-to-left Hebrew layout where text appears. ',
      sv: 'Include clean, readable Swedish text labels/descriptions on the image. Use natural Swedish e-commerce copy. ',
      da: 'Include clean, readable Danish text labels/descriptions on the image. Use natural Danish e-commerce copy. ',
      fi: 'Include clean, readable Finnish text labels/descriptions on the image. Use natural Finnish e-commerce copy. ',
      no: 'Include clean, readable Norwegian text labels/descriptions on the image. Use natural Norwegian e-commerce copy. '
    };
    if (lang && langMap[lang]) prompt += langMap[lang];
  }

  // Style replication extras
  if (tab === 'style') {
    const styleFiles = uploads['style-prod'] || [];
    const strength = getStyleStrength();
    const outputType = getStyleOutputType();
    const strengthMap = {
      light: 'Style strength: light. Borrow only the general color palette, mood, and a few decorative ideas from the reference. Keep layout flexible and original. ',
      medium: 'Style strength: standard. Recreate the reference image\'s overall color system, composition logic, spacing, typography feeling, and decorative style while making a new layout for the user product. ',
      strong: 'Style strength: strong. Closely follow the reference image\'s layout structure, color palette, graphic hierarchy, text placement style, lighting mood, and decorative elements, but replace the reference product with the uploaded user product and avoid exact copyrighted logos/characters. '
    };
    const outputMap = {
      detail: 'Output type: e-commerce detail/feature image with clear selling points and polished commercial presentation. ',
      main: 'Output type: hero/main product poster with one strong focal product, high impact composition, marketplace-ready. ',
      banner: 'Output type: wide banner advertising image with horizontal composition, strong headline area, product clearly visible. ',
      social: 'Output type: social media advertisement, eye-catching, trendy, high click-through visual, concise text areas. '
    };
    if (styleRefFile) prompt += 'Reference design image is provided: analyze and transfer its visual language; do not treat it as the product source. ';
    if (styleFiles.length > 0) prompt += 'Product material images are provided: the user product must be the main subject. ';
    prompt += (strengthMap[strength] || strengthMap.medium);
    prompt += (outputMap[outputType] || outputMap.detail);
    prompt += 'If text is requested, create clean readable Chinese e-commerce copy areas; do not generate garbled text. If no specific text is requested, use minimal generic design blocks or no text. ';
  }

  // Clothing tab extras
  if (tab === 'clothing') {
    const mode = getClothingMode();
    const garmentFiles = uploads.clothing || [];
    const modelFiles = uploads['clothing-model'] || [];
    if (mode === '模特试穿') {
      if (modelFiles.length > 0 && garmentFiles.length > 0) {
        prompt += 'Virtual try-on task: use the uploaded model photo as the human/model identity, pose reference, body shape, face, and hairstyle reference; dress this same model in the uploaded garment/product. The output must not remain as the original model photo: the uploaded garment must visibly replace or be worn on the model. Keep the model natural and realistic. ';
      } else if (garmentFiles.length > 0) {
        prompt += 'Virtual try-on task: create a realistic fashion model wearing the uploaded garment/product. Generate a clean commercial try-on photo, full body or 3/4 body, natural pose, studio lighting. ';
      } else {
        prompt += 'Create a realistic fashion model try-on image from the clothing description. Full body or 3/4 body, natural pose, studio lighting. ';
      }
      prompt += 'Use only the user text as simple styling guidance; do not require a long prompt. Preserve the garment details exactly. ';
    } else if (mode === '基础套图') {
      prompt += 'Basic clothing image set task: no human model. Create clean e-commerce product images such as white-background hero shot, flat lay or hanger/mannequin display, front/back view, fabric texture close-up, collar/sleeve/hem/detail closeups. The uploaded garment must be the subject and must not become a model try-on image. ';
    }
  }

  // Refine tab extras
  if (tab === 'refine') {
    const bg = document.getElementById('refine-bg')?.value;
    const bgMap = { white: 'Replace background with pure white. ', transparent: 'Remove background completely (transparent). ', scene: 'Place product in a lifestyle scene background. ', keep: 'Keep the original background. ' };
    if (bg && bgMap[bg]) prompt += bgMap[bg];
  }

  if (userPrompt) prompt += userPrompt;
  return prompt;
}

function parseApiError(text, status) {
  try {
    const j = JSON.parse(text);
    return j.error?.message || j.message || j.detail || `HTTP ${status}`;
  } catch {
    return `HTTP ${status}: ${text.slice(0, 200)}`;
  }
}

function normalizeImageSource(value) {
  if (!value) return '';
  if (/^(data:|https?:\/\/|blob:)/i.test(value)) return value;
  return `data:image/png;base64,${value}`;
}

function extractImage(data) {
  if (data.data?.[0]) { const d = data.data[0]; return normalizeImageSource(d.b64_json || d.url); }
  if (data.images?.[0]) { const d = data.images[0]; return normalizeImageSource(d.b64_json || d.base64 || d.url); }
  if (data.artifacts?.[0]) { const d = data.artifacts[0]; return normalizeImageSource(d.base64 || d.url); }
  return '';
}
function extractAllImages(data) {
  if (data.data?.length) return data.data.map(d => normalizeImageSource(d.b64_json || d.url)).filter(Boolean);
  if (data.images?.length) return data.images.map(d => normalizeImageSource(d.b64_json || d.base64 || d.url)).filter(Boolean);
  if (data.artifacts?.length) return data.artifacts.map(d => normalizeImageSource(d.base64 || d.url)).filter(Boolean);
  return [];
}
function selectResultImg(thumb, tab) {
  const resultImg = document.getElementById(`${tab}-result-img`);
  resultImg.src = thumb.src;
  thumb.parentElement.querySelectorAll('.result-grid-item').forEach(el => el.classList.remove('active'));
  thumb.classList.add('active');
}

// ===== Download / Fullscreen for new tabs =====
function dlResult(tab) { const img = document.getElementById(`${tab}-result-img`); if (img?.src) downloadImage(img.src, `imageforge-${tab}-${ts()}.png`); }
function updateBatchDownloadButton(tab, count) {
  const btn = document.getElementById(`${tab}-batch-download`);
  if (!btn) return;
  btn.style.display = count > 1 ? 'inline-flex' : 'none';
  btn.disabled = count <= 1;
}
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jszip-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.JSZip), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const urls = [
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      'https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js'
    ];
    let index = 0;
    const loadNext = () => {
      if (index >= urls.length) return reject(new Error('打包组件加载失败'));
      const script = document.createElement('script');
      script.src = urls[index++];
      script.async = true;
      script.dataset.jszipLoader = 'true';
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => { script.remove(); loadNext(); };
      document.head.appendChild(script);
    };
    loadNext();
  });
}
async function imageSourceToBlob(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`);
  return res.blob();
}
function imageExtFromBlob(blob) {
  const map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[blob.type] || 'png';
}
async function downloadResultZip(tab) {
  const images = tabResultImages[tab] || [];
  if (images.length <= 1) return showToast('当前没有可打包的多张结果');
  const btn = document.getElementById(`${tab}-batch-download`);
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '打包中…'; }
  try {
    const JSZipCtor = await loadJSZip();
    if (!JSZipCtor) throw new Error('打包组件加载失败');
    const zip = new JSZipCtor();
    for (let i = 0; i < images.length; i++) {
      const blob = await imageSourceToBlob(images[i]);
      zip.file(`${tab}-${String(i + 1).padStart(2, '0')}.${imageExtFromBlob(blob)}`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    fallbackDownload(url, `imageforge-${tab}-${ts()}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    showToast(`已打包 ${images.length} 张图片`);
  } catch (err) {
    showToast('打包下载失败: ' + friendlyError(err), 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}
function fullscreen(imgId) { const src = document.getElementById(imgId)?.src; if (src) { document.getElementById('fullscreen-img').src = src; document.getElementById('fullscreen-overlay').style.display = 'flex'; } }
// ===== AI Polish & Reverse (kept from original) =====
const POLISH_SYSTEM = `You are a professional AI image prompt optimization expert. Optimize short descriptions into detailed, high-quality English image generation prompts. Output pure prompt text only.`;
const VIDEO_POLISH_SYSTEM = `You are a professional AI video prompt optimization expert. Optimize short descriptions into detailed, high-quality English video generation prompts. Emphasize subject, motion, camera movement, lighting, composition, visual continuity, and cinematic timing. Output pure prompt text only.`;
const REVERSE_SYSTEM = `You are an image analysis expert. Reverse-engineer a detailed English prompt from the given image. Output pure prompt text only.`;
const POLISH_BUTTON_HTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> AI 润色';

async function callChatAPI(systemPrompt, userContent, isVision) {
  const cfg = getConfig(); const key = cfg.apiKey; const model = cfg.polishModel || DEFAULT_POLISH_MODEL;
  if (!key) { showToast('请先配置 API Key'); openSettings(); return null; }
  const messages = [{ role: 'system', content: systemPrompt }];
  if (isVision) messages.push({ role: 'user', content: userContent });
  else messages.push({ role: 'user', content: userContent });
  const res = await fetch(apiUrl('/v1/chat/completions'), { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, max_tokens: 1024 }) });
  if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

async function polishGenPrompt() {
  const el = document.getElementById('gen-prompt'); const text = el.value.trim(); if (!text) return showToast('请先输入描述');
  const btn = document.getElementById('btn-polish-gen'); btn.disabled = true; btn.textContent = '润色中…';
  try { const result = await callChatAPI(POLISH_SYSTEM, text, false); if (result) { el.value = result; document.getElementById('prompt-count').textContent = result.length; showToast('润色完成'); } }
  catch (err) { showToast('润色失败: ' + err.message, 4000); }
  finally { btn.disabled = false; btn.innerHTML = POLISH_BUTTON_HTML; }
}

async function polishEditPrompt() {
  const el = document.getElementById('edit-prompt'); const text = el.value.trim(); if (!text) return showToast('请先输入编辑指令');
  const btn = document.getElementById('btn-polish-edit'); btn.disabled = true; btn.textContent = '润色中…';
  try { const result = await callChatAPI(POLISH_SYSTEM, text, false); if (result) { el.value = result; showToast('润色完成'); } }
  catch (err) { showToast('润色失败: ' + err.message, 4000); }
  finally { btn.disabled = false; btn.innerHTML = POLISH_BUTTON_HTML; }
}

async function polishVideoPrompt() {
  const el = document.getElementById('video-prompt'); const text = el.value.trim(); if (!text) return showToast('请先输入视频描述');
  const btn = document.getElementById('btn-polish-video'); btn.disabled = true; btn.textContent = '润色中…';
  try { const result = await callChatAPI(VIDEO_POLISH_SYSTEM, text, false); if (result) { el.value = result; showToast('润色完成'); } }
  catch (err) { showToast('润色失败: ' + err.message, 4000); }
  finally { btn.disabled = false; btn.innerHTML = POLISH_BUTTON_HTML; }
}

async function reversePrompt() {
  if (!editSourceFile) return showToast('请先上传图片');
  const btn = document.getElementById('btn-reverse'); btn.disabled = true; btn.textContent = '分析中…';
  try {
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(editSourceFile); });
    const userContent = [{ type: 'text', text: '请根据这张图片反推出详细的图像生成提示词。' }, { type: 'image_url', image_url: { url: b64 } }];
    const result = await callChatAPI(REVERSE_SYSTEM, userContent, true);
    if (result) { document.getElementById('edit-prompt').value = result; showToast('反推完成'); }
  } catch (err) { showToast('反推失败: ' + err.message, 4000); }
  finally { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> 反推提示词'; }
}

// ===== Size & Quality (original) =====
function selectSize(btn) {
  const grid = btn.closest('.size-grid');
  if (!grid) return;
  grid.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  grid.dataset.selectedSize = btn.dataset.size || '';
  grid.dataset.selectedRatio = btn.dataset.ratio || btn.dataset.size || '';
  const row = grid.parentElement.querySelector('.custom-size-row');
  if (row) row.style.display = btn.dataset.ratio === 'custom' ? 'flex' : 'none';
}

function updateCustomSize(input) {
  const panel = input.closest('.control-panel');
  const grid = panel?.querySelector('.size-grid');
  if (!grid) return;
  const customBtn = grid.querySelector('.size-btn[data-ratio="custom"]');
  if (customBtn && !customBtn.classList.contains('active')) selectSize(customBtn);
}
function selectQuality(btn) { btn.parentElement.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }

// ===== Generate (original) =====
async function generateImage() {
  let prompt = document.getElementById('gen-prompt').value.trim(); if (!prompt) return showToast('请输入描述');
  const cfg = getConfig(); if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }
  const panel = document.getElementById('tab-generate')?.querySelector('.control-panel') || document.getElementById('tab-generate');
  let size = getPanelSize(panel);
  const quality = getPanelQuality(panel);
  const container = document.getElementById('gen-preview'); const loading = container.querySelector('.loading-state'); const result = container.querySelector('.result-state'); const empty = container.querySelector('.empty-state'); const btn = document.getElementById('btn-generate');
  container.classList.remove('empty'); empty.style.display = 'none'; result.style.display = 'none'; loading.style.display = 'flex';
  btn.disabled = true; btn.querySelector('.btn-content').style.display = 'none'; btn.querySelector('.btn-loading').style.display = 'flex';
  const t0 = Date.now();
  try {
    prompt += getSizePrompt(size);
    const body = { prompt, model: getApiModel(cfg.generationModel), n: 1 };
    appendImageRequestOptions(body, size, quality, cfg.generationModel);
    const res = await fetch(apiUrl('/v1/images/generations'), { method: 'POST', headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
    const data = await res.json(); const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let imgSrc = extractImage(data); if (!imgSrc) throw new Error('API 未返回图片数据');
    let b64 = imgSrc; if (imgSrc.startsWith('http')) { try { b64 = await blobToBase64(await (await fetch(imgSrc)).blob()); } catch {} }
    loading.style.display = 'none'; result.style.display = 'flex';
    document.getElementById('gen-result-img').src = b64;
    const info = document.getElementById('gen-info'); info.style.display = 'flex';
    document.getElementById('gen-info-size').textContent = size.label || size.apiSize; document.getElementById('gen-info-time').textContent = `${elapsed}s`;
    currentGenResult = { type: 'generate', prompt, size: size.label || size.apiSize, model: cfg.generationModel, quality, imageData: b64, elapsed: +elapsed, createdAt: Date.now() };
    await addToHistory(currentGenResult); showToast('生成完成');
  } catch (err) { loading.style.display = 'none'; container.classList.add('empty'); empty.style.display = 'flex'; showToast(friendlyError(err), 5000); }
  finally { btn.disabled = false; btn.querySelector('.btn-content').style.display = 'flex'; btn.querySelector('.btn-loading').style.display = 'none'; }
}

// ===== Video =====
function initVideoModeUI() {
  const mode = document.getElementById('video-mode');
  if (!mode) return;
  mode.addEventListener('change', updateVideoModeUI);
  updateVideoModeUI();
}

function getVideoUploadMax() {
  const mode = document.getElementById('video-mode')?.value || 'text';
  if (mode === 'image') return 1;
  if (mode === 'keyframes') return 8;
  return 6;
}

function handleVideoUpload(event) {
  handleMultiUpload(event, 'video', getVideoUploadMax());
}

function updateVideoModeUI() {
  const mode = document.getElementById('video-mode')?.value || 'text';
  const refsSection = document.getElementById('video-ref-section');
  const refsLabel = document.getElementById('video-ref-label');
  const uploadText = document.getElementById('video-upload-text');
  const uploadHint = document.getElementById('video-upload-hint');
  const urlsLabel = document.getElementById('video-url-label');
  const urlsHint = document.getElementById('video-url-hint');
  const prompt = document.getElementById('video-prompt');
  const copy = {
    text: {
      showRefs: false,
      placeholder: 'A cinematic product video, slow camera push-in, glossy reflections, premium studio lighting, smooth motion',
      refLabel: '参考图片',
      uploadText: '上传参考图片',
      uploadHint: '',
      urlLabel: '图片 URL',
      urlHint: ''
    },
    image: {
      showRefs: true,
      placeholder: 'Animate the subject with subtle natural motion, slow cinematic camera movement, keep identity and composition stable',
      refLabel: '单张参考图片',
      uploadText: '上传一张图片',
      uploadHint: '本地上传优先；也可填写一个公网 URL',
      urlLabel: '图片 URL',
      urlHint: '本地上传会转为 data URL 发送；URL 可作为补充'
    },
    multi: {
      showRefs: true,
      placeholder: 'Use the reference images to guide a consistent cinematic video with natural motion and stable subject identity',
      refLabel: '多张参考图片',
      uploadText: '上传多张图片',
      uploadHint: '至少两张；本地上传和 URL 可以混用',
      urlLabel: '图片 URL',
      urlHint: '每行一个公网 HTTPS 图片地址，可选'
    },
    keyframes: {
      showRefs: true,
      placeholder: 'Create a smooth cinematic transition between the keyframes, maintaining visual consistency and natural camera movement',
      refLabel: '关键帧图片',
      uploadText: '上传关键帧',
      uploadHint: '至少两张，按上传顺序作为关键帧',
      urlLabel: '关键帧 URL',
      urlHint: '每行一个公网 HTTPS 图片地址，可选'
    }
  };
  const cfg = copy[mode] || copy.text;
  if (refsSection) refsSection.style.display = cfg.showRefs ? '' : 'none';
  if (refsLabel) refsLabel.textContent = cfg.refLabel;
  if (uploadText) uploadText.textContent = cfg.uploadText;
  if (uploadHint) uploadHint.textContent = cfg.uploadHint;
  if (urlsLabel) urlsLabel.innerHTML = `${esc(cfg.urlLabel)} <span class="label-opt">可选</span>`;
  if (urlsHint) urlsHint.textContent = cfg.urlHint;
  if (prompt && !prompt.value.trim()) prompt.placeholder = cfg.placeholder;
  if (mode === 'image' && uploads.video.length > 1) {
    uploads.video = uploads.video.slice(0, 1);
    renderMultiPreviews('video');
  }
}

function parseVideoImageUrls(value) {
  return String(value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

async function uploadVideoReferenceFile(file) {
  const res = await fetch('/api/temp-upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || 'reference.png')
    },
    body: file
  });
  if (!res.ok) throw new Error(`临时上传失败 ${res.status}`);
  const data = await res.json();
  if (!data?.url) throw new Error('临时上传未返回 URL');
  return new URL(data.url, window.location.origin).href;
}

async function getVideoReferenceImages(files, urls) {
  const refs = [];
  for (const file of files) {
    try {
      refs.push(await uploadVideoReferenceFile(file));
    } catch {
      refs.push(await fileToDataUrl(file));
    }
  }
  return [...refs, ...urls];
}

function buildVideoPromptForMode(prompt, mode, refCount) {
  const clean = prompt.trim();
  if (mode === 'image') {
    return `Use the provided reference image as the first frame and primary visual source. The generated video must follow this user motion prompt: ${clean}. Keep the subject identity, product appearance, composition, and style consistent with the reference image while applying the described motion and camera behavior.`;
  }
  if (mode === 'multi') {
    return `Use the ${refCount} provided reference images as visual references. The generated video must follow this user prompt: ${clean}. Keep subject identity and style consistent across frames, and make the motion, transition, camera movement, and scene behavior match the prompt.`;
  }
  if (mode === 'keyframes') {
    return `Use the ${refCount} provided images as ordered keyframes from start to end. The generated video must follow this user prompt: ${clean}. Create a smooth cinematic transition between the keyframes with consistent lighting, subject identity, and natural motion.`;
  }
  return clean;
}

function getVideoDimensions() {
  const ratio = document.getElementById('video-ratio')?.value || '16:9';
  const tier = document.getElementById('video-resolution')?.value || '720p';
  const map = {
    '480p': { '16:9': [832, 480], '9:16': [480, 832], '1:1': [640, 640], '4:3': [768, 576], '3:4': [576, 768] },
    '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [768, 768], '4:3': [1024, 768], '3:4': [768, 1024] },
    '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1024, 1024], '4:3': [1440, 1080], '3:4': [1080, 1440] }
  };
  const size = map[tier]?.[ratio] || map['720p']['16:9'];
  return { width: size[0], height: size[1], ratio, tier };
}

function getSavedVideoTasks() {
  try {
    const list = JSON.parse(localStorage.getItem(VIDEO_TASKS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveVideoTask(task) {
  const list = getSavedVideoTasks();
  const key = task.videoId || task.taskId || task.id;
  const idx = list.findIndex(item => (item.videoId || item.taskId || item.id) === key);
  const next = { ...(idx >= 0 ? list[idx] : {}), ...task, updatedAt: Date.now() };
  if (!next.createdAt) next.createdAt = Date.now();
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);
  localStorage.setItem(VIDEO_TASKS_KEY, JSON.stringify(list.slice(0, 20)));
  renderVideoTasks();
  return next;
}

function clearVideoTasks() {
  localStorage.removeItem(VIDEO_TASKS_KEY);
  clearVideoTempCache();
  renderVideoTasks();
}

function renderVideoTasks() {
  const box = document.getElementById('video-tasks-list');
  if (!box) return;
  const tasks = getSavedVideoTasks();
  if (!tasks.length) {
    box.innerHTML = '<div class="video-task-empty">暂无视频任务</div>';
    return;
  }
  box.innerHTML = tasks.map(task => {
    const id = task.videoId || task.taskId || task.id || '';
    const kind = task.videoId ? 'video' : 'task';
    const status = task.status || 'queued';
    const prompt = esc(task.prompt || '(video)');
    const time = task.createdAt ? fmtTime(task.createdAt) : '';
    const urlAction = task.videoUrl ? `<button class="text-btn accent" data-url="${escAttr(task.videoUrl)}" onclick="openSavedVideoUrl(this)">打开</button>` : '';
    return `<div class="video-task-item">
      <div class="video-task-main">
        <div class="video-task-top"><span class="video-status ${escAttr(status)}">${esc(status)}</span><span>${esc(time)}</span></div>
        <div class="video-task-prompt">${prompt}</div>
        <div class="video-task-id">${esc(id)}</div>
      </div>
      <div class="video-task-actions">
        ${urlAction}
        <button class="text-btn" data-id="${escAttr(id)}" data-kind="${escAttr(kind)}" data-model="${escAttr(task.model || DEFAULT_VIDEO_MODEL)}" onclick="querySavedVideoTask(this)">查询</button>
      </div>
    </div>`;
  }).join('');
}

async function buildVideoRequestBody(cfg) {
  const prompt = document.getElementById('video-prompt')?.value.trim() || '';
  if (!prompt) throw new Error('请输入视频描述');
  const mode = document.getElementById('video-mode')?.value || 'text';
  const urls = parseVideoImageUrls(document.getElementById('video-image-urls')?.value);
  const localFiles = mode === 'text' ? [] : (uploads.video || []);
  const localRefs = localFiles.slice(0, getVideoUploadMax());
  const refs = await getVideoReferenceImages(localRefs, urls);
  if (mode === 'image' && refs.length < 1) throw new Error('请上传一张参考图，或填写一个图片 URL');
  if ((mode === 'multi' || mode === 'keyframes') && refs.length < 2) throw new Error('请至少上传两张参考图，或填写两个图片 URL');

  const dims = getVideoDimensions();
  const requestPrompt = buildVideoPromptForMode(prompt, mode, refs.length);
  const body = {
    model: getApiVideoModel(cfg.videoModel),
    prompt: requestPrompt,
    width: dims.width,
    height: dims.height,
    num_frames: parseInt(document.getElementById('video-duration')?.value, 10) || 121,
    frame_rate: parseFloat(document.getElementById('video-fps')?.value) || 24
  };
  const negative = document.getElementById('video-negative')?.value.trim();
  const seed = parseInt(document.getElementById('video-seed')?.value, 10);
  if (negative) body.negative_prompt = negative;
  if (Number.isFinite(seed)) body.seed = seed;
  if (mode === 'image') body.image = refs[0];
  if (mode === 'multi') body.extra_body = { image: refs };
  if (mode === 'keyframes') body.extra_body = { image: refs, mode: 'keyframes' };
  return { body, prompt: requestPrompt, mode, dims, refCount: refs.length, localRefCount: localRefs.length };
}

async function generateVideo() {
  const cfg = getConfig();
  if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }
  const btn = document.getElementById('btn-video-generate');
  setVideoCacheStatus('等待结果');
  setVideoLoading(true, '正在提交视频任务', '创建 Agnes Video V2.0 异步任务');
  if (btn) { btn.disabled = true; btn.querySelector('.btn-content').style.display = 'none'; btn.querySelector('.btn-loading').style.display = 'flex'; }
  try {
    const request = await buildVideoRequestBody(cfg);
    const res = await fetch(apiUrl('/v1/videos'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(request.body)
    });
    if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
    const data = await res.json();
    const task = saveVideoTask({
      id: data.id || data.task_id || '',
      taskId: data.task_id || data.id || '',
      videoId: data.video_id || '',
      model: data.model || request.body.model,
      status: data.status || 'queued',
      progress: data.progress || 0,
      prompt: request.prompt,
      mode: request.mode,
      refCount: request.refCount,
      localRefCount: request.localRefCount,
      size: data.size || `${request.dims.width}x${request.dims.height}`,
      seconds: data.seconds || String(request.body.num_frames / request.body.frame_rate)
    });
    currentVideoTask = task;
    updateVideoStatus(task);
    startVideoPolling(task);
    showToast('视频任务已提交');
  } catch (err) {
    setVideoLoading(false);
    showVideoError(friendlyError(err));
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('.btn-content').style.display = 'flex'; btn.querySelector('.btn-loading').style.display = 'none'; }
  }
}

function setVideoLoading(active, title, sub) {
  const container = document.getElementById('video-preview');
  if (!container) return;
  const empty = container.querySelector('.empty-state');
  const loading = container.querySelector('.loading-state');
  const result = container.querySelector('.result-state');
  container.classList.toggle('empty', !active && !currentVideoTask?.videoUrl);
  if (empty) empty.style.display = active ? 'none' : '';
  if (loading) loading.style.display = active ? 'flex' : 'none';
  if (result) result.style.display = 'none';
  const titleEl = document.getElementById('video-loading-text');
  const subEl = document.getElementById('video-loading-sub');
  if (titleEl && title) titleEl.textContent = title;
  if (subEl && sub) subEl.textContent = sub;
}

function showVideoError(message) {
  const container = document.getElementById('video-preview');
  const empty = container?.querySelector('.empty-state');
  if (container) container.classList.add('empty');
  if (empty) empty.style.display = 'flex';
  showToast(message, 6000);
}

function updateVideoStatus(task) {
  const status = document.getElementById('video-status');
  const taskId = document.getElementById('video-task-id');
  const videoId = document.getElementById('video-video-id');
  const meta = document.getElementById('video-result-meta');
  if (status) status.textContent = `${task.status || 'queued'}${Number.isFinite(task.progress) ? ` · ${task.progress}%` : ''}`;
  if (taskId) taskId.textContent = task.taskId || task.id || '—';
  if (videoId) videoId.textContent = task.videoId || '—';
  if (meta) meta.textContent = [task.size, task.seconds ? `${task.seconds}s` : '', task.model].filter(Boolean).join(' · ');
}

function startVideoPolling(task) {
  clearTimeout(activeVideoPollTimer);
  const poll = async () => {
    try {
      const data = await fetchVideoTask(task);
      const next = mergeVideoTask(task, data);
      currentVideoTask = saveVideoTask(next);
      updateVideoStatus(currentVideoTask);
      if (currentVideoTask.status === 'completed' && currentVideoTask.videoUrl) {
        showVideoResult(currentVideoTask);
        showToast('视频生成完成');
        return;
      }
      if (currentVideoTask.status === 'failed') {
        setVideoLoading(false);
        showVideoError(getVideoError(data) || '视频生成失败');
        return;
      }
      setVideoLoading(true, `视频生成中 ${currentVideoTask.progress || 0}%`, currentVideoTask.videoId || currentVideoTask.taskId || '');
      activeVideoPollTimer = setTimeout(poll, 5000);
    } catch (err) {
      setVideoLoading(true, '等待视频结果', friendlyError(err));
      activeVideoPollTimer = setTimeout(poll, 8000);
    }
  };
  setVideoLoading(true, '视频任务已提交', task.videoId || task.taskId || '');
  activeVideoPollTimer = setTimeout(poll, 2500);
}

async function fetchVideoTask(task) {
  const cfg = getConfig();
  const model = getApiVideoModel(task.model || cfg.videoModel);
  let url;
  if (task.videoId) {
    const qs = new URLSearchParams({ video_id: task.videoId, model_name: model });
    url = apiUrl(`/agnesapi?${qs.toString()}`);
  } else {
    url = apiUrl(`/v1/videos/${encodeURIComponent(task.taskId || task.id)}`);
  }
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Accept': 'application/json' } });
  if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
  return res.json();
}

function mergeVideoTask(task, data) {
  const progress = Number(data.progress);
  return {
    ...task,
    id: data.id || task.id,
    taskId: data.task_id || data.id || task.taskId,
    videoId: data.video_id || task.videoId,
    model: data.model || task.model,
    status: data.status || task.status,
    progress: Number.isFinite(progress) ? progress : task.progress,
    seconds: data.seconds || task.seconds,
    size: data.size || task.size,
    videoUrl: extractVideoUrl(data) || task.videoUrl,
    error: data.error || task.error
  };
}

function extractVideoUrl(data) {
  if (!data) return '';
  const direct = data.remixed_from_video_id || data.video_url || data.url || data.output_url || data.result_url;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct;
  if (Array.isArray(data.data) && data.data[0]) return extractVideoUrl(data.data[0]);
  if (data.output) return extractVideoUrl(typeof data.output === 'object' ? data.output : { url: data.output });
  return '';
}

function getVideoError(data) {
  if (!data?.error) return '';
  if (typeof data.error === 'string') return data.error;
  return data.error.message || JSON.stringify(data.error);
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function setVideoCacheStatus(text) {
  const el = document.getElementById('video-cache-status');
  if (el) el.textContent = text || '—';
}

function getVideoTempCache(url) {
  if (!url) return null;
  const hit = videoTempCache.get(url);
  if (!hit) return null;
  videoTempCache.delete(url);
  videoTempCache.set(url, hit);
  return hit;
}

function rememberVideoTempCache(url, blobUrl, size) {
  const old = videoTempCache.get(url);
  if (old?.blobUrl) URL.revokeObjectURL(old.blobUrl);
  videoTempCache.set(url, { blobUrl, size, createdAt: Date.now() });
  while (videoTempCache.size > VIDEO_TEMP_CACHE_LIMIT) {
    const first = videoTempCache.keys().next().value;
    const item = videoTempCache.get(first);
    if (item?.blobUrl) URL.revokeObjectURL(item.blobUrl);
    videoTempCache.delete(first);
  }
}

function clearVideoTempCache() {
  videoTempCache.forEach(item => {
    if (item?.blobUrl) URL.revokeObjectURL(item.blobUrl);
  });
  videoTempCache.clear();
  setVideoCacheStatus('—');
}

async function cacheVideoForPlayback(task) {
  const remoteUrl = task?.videoUrl || '';
  if (!remoteUrl || /^blob:/i.test(remoteUrl)) return '';
  const cached = getVideoTempCache(remoteUrl);
  if (cached?.blobUrl) {
    setVideoCacheStatus(`临时缓存 ${formatFileSize(cached.size)}`.trim());
    return cached.blobUrl;
  }

  setVideoCacheStatus('正在临时缓存');
  try {
    const res = await fetch(remoteUrl, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    rememberVideoTempCache(remoteUrl, blobUrl, blob.size);

    const player = document.getElementById('video-result-player');
    const stillCurrent = currentVideoTask?.videoUrl === remoteUrl;
    const canSwapWithoutInterrupt = player && player.dataset.remoteUrl === remoteUrl && player.paused && player.currentTime < 0.25;
    if (stillCurrent && canSwapWithoutInterrupt) {
      player.src = blobUrl;
      player.dataset.source = 'temp';
      player.load();
    }
    setVideoCacheStatus(`临时缓存 ${formatFileSize(blob.size)}`.trim());
    return blobUrl;
  } catch {
    setVideoCacheStatus('在线播放');
    return '';
  }
}

function showVideoResult(task) {
  const container = document.getElementById('video-preview');
  if (!container) return;
  const loading = container.querySelector('.loading-state');
  const empty = container.querySelector('.empty-state');
  const result = container.querySelector('.result-state');
  const player = document.getElementById('video-result-player');
  const link = document.getElementById('video-result-link');
  container.classList.remove('empty');
  if (loading) loading.style.display = 'none';
  if (empty) empty.style.display = 'none';
  if (result) result.style.display = 'flex';
  const cached = getVideoTempCache(task.videoUrl);
  if (player) {
    player.dataset.remoteUrl = task.videoUrl || '';
    player.dataset.source = cached?.blobUrl ? 'temp' : 'remote';
    player.preload = 'auto';
    player.src = cached?.blobUrl || task.videoUrl || '';
    player.load();
  }
  if (link) { link.href = task.videoUrl || '#'; link.textContent = task.videoUrl || ''; }
  setVideoCacheStatus(cached?.blobUrl ? `临时缓存 ${formatFileSize(cached.size)}`.trim() : '在线播放');
  updateVideoStatus(task);
  cacheVideoForPlayback(task);
}

async function queryVideoTask() {
  const id = document.getElementById('video-query-id')?.value.trim();
  if (!id) return showToast('请输入 video_id 或 task_id');
  const kind = id.startsWith('video_') ? 'video' : 'task';
  await queryVideoTaskById(id, kind, getConfig().videoModel);
}

async function querySavedVideoTask(btn) {
  const id = btn.dataset.id;
  const saved = getSavedVideoTasks().find(item => (item.videoId || item.taskId || item.id) === id);
  await queryVideoTaskObject(saved || {
    videoId: btn.dataset.kind === 'video' ? id : '',
    taskId: btn.dataset.kind === 'video' ? '' : id,
    model: btn.dataset.model || DEFAULT_VIDEO_MODEL,
    status: 'queued',
    progress: 0,
    prompt: '(queried video)'
  });
}

async function queryVideoTaskById(id, kind, model) {
  return queryVideoTaskObject({ videoId: kind === 'video' ? id : '', taskId: kind === 'video' ? '' : id, model: model || getConfig().videoModel, status: 'queued', progress: 0, prompt: '(queried video)' });
}

async function queryVideoTaskObject(task) {
  const cfg = getConfig();
  if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }
  currentVideoTask = task;
  setVideoCacheStatus('等待结果');
  setVideoLoading(true, '正在查询视频任务', task.videoId || task.taskId || task.id || '');
  try {
    const data = await fetchVideoTask(task);
    currentVideoTask = saveVideoTask(mergeVideoTask(task, data));
    if (currentVideoTask.status === 'completed' && currentVideoTask.videoUrl) showVideoResult(currentVideoTask);
    else startVideoPolling(currentVideoTask);
  } catch (err) {
    setVideoLoading(false);
    showVideoError(friendlyError(err));
  }
}

function openVideoResult() {
  const url = currentVideoTask?.videoUrl || document.getElementById('video-result-player')?.src;
  if (url) window.open(url, '_blank');
}

function openSavedVideoUrl(btn) {
  const url = btn.dataset.url;
  if (url) window.open(url, '_blank');
}

function copyVideoUrl() {
  const url = currentVideoTask?.videoUrl || document.getElementById('video-result-player')?.src;
  if (!url) return;
  navigator.clipboard?.writeText(url);
  showToast('视频链接已复制');
}

function downloadVideoResult() {
  const originalUrl = currentVideoTask?.videoUrl || '';
  const playerUrl = document.getElementById('video-result-player')?.src || '';
  const cached = getVideoTempCache(originalUrl);
  const url = cached?.blobUrl || playerUrl || originalUrl;
  if (!url) return;
  if (/^blob:/i.test(url)) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `imageforge-video-${ts()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  fetch(url).then(r => r.blob()).then(blob => {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `imageforge-video-${ts()}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }).catch(() => window.open(url, '_blank'));
}

// ===== Edit (original) =====
function setupDragDrop() {
  ['edit-upload-zone', 'mask-upload-zone'].forEach(id => {
    const z = document.getElementById(id);
    if (!z) return;
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('dragover'); });
    z.addEventListener('dragleave', () => z.classList.remove('dragover'));
    z.addEventListener('drop', e => {
      e.preventDefault(); z.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (!f?.type.startsWith('image/')) return;
      id === 'edit-upload-zone' ? processEditUpload(f) : processMaskUpload(f);
    });
  });

  [
    { id: 'clothing-file-input', key: 'clothing', max: 6 },
    { id: 'clothing-model-file-input', key: 'clothing-model', max: 3 },
    { id: 'product-file-input', key: 'product', max: 6 },
    { id: 'style-prod-input', key: 'style-prod', max: 6 },
    { id: 'refine-file-input', key: 'refine', max: 50 },
    { id: 'video-file-input', key: 'video', max: 8 }
  ].forEach(({ id, key, max }) => {
    const input = document.getElementById(id);
    const z = input?.closest('.upload-zone');
    if (!z) return;
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('dragover'); });
    z.addEventListener('dragleave', () => z.classList.remove('dragover'));
    z.addEventListener('drop', e => {
      e.preventDefault(); z.classList.remove('dragover');
      setMultiUploadFiles(key, e.dataTransfer.files, max);
    });
  });
}
function handleEditUpload(e) { if (e.target.files[0]) processEditUpload(e.target.files[0]); }
function processEditUpload(file) { editSourceFile = file; const r = new FileReader(); r.onload = () => { const img = document.getElementById('edit-upload-preview'); img.src = r.result; img.style.display = 'block'; document.getElementById('edit-upload-placeholder').style.display = 'none'; const rm = document.getElementById('edit-src-remove'); if (rm) rm.style.display = 'flex'; }; r.readAsDataURL(file); }
function handleMaskUpload(e) { if (e.target.files[0]) processMaskUpload(e.target.files[0]); }
function processMaskUpload(file) { maskSourceFile = file; const r = new FileReader(); r.onload = () => { const img = document.getElementById('mask-upload-preview'); img.src = r.result; img.style.display = 'block'; document.getElementById('mask-upload-placeholder').style.display = 'none'; const rm = document.getElementById('mask-src-remove'); if (rm) rm.style.display = 'flex'; }; r.readAsDataURL(file); }
function clearEditUpload(which) {
  if (which === 'source') { editSourceFile = null; const img = document.getElementById('edit-upload-preview'); img.src = ''; img.style.display = 'none'; document.getElementById('edit-upload-placeholder').style.display = ''; const rm = document.getElementById('edit-src-remove'); if (rm) rm.style.display = 'none'; document.getElementById('edit-file-input').value = ''; }
  if (which === 'mask') { maskSourceFile = null; const img = document.getElementById('mask-upload-preview'); img.src = ''; img.style.display = 'none'; document.getElementById('mask-upload-placeholder').style.display = ''; const rm = document.getElementById('mask-src-remove'); if (rm) rm.style.display = 'none'; document.getElementById('mask-file-input').value = ''; }
}

async function editImage() {
  let prompt = document.getElementById('edit-prompt').value.trim(); if (!prompt) return showToast('请输入编辑指令'); if (!editSourceFile) return showToast('请上传原图');
  const cfg = getConfig(); if (!cfg.apiKey) { showToast('请先配置 API Key'); return openSettings(); }
  const sizeVal = document.getElementById('edit-size').value; const container = document.getElementById('edit-preview'); const loading = container.querySelector('.loading-state'); const result = container.querySelector('.result-state'); const empty = container.querySelector('.empty-state'); const btn = document.getElementById('btn-edit');
  container.classList.remove('empty'); empty.style.display = 'none'; result.style.display = 'none'; loading.style.display = 'flex';
  btn.disabled = true; btn.querySelector('.btn-content').style.display = 'none'; btn.querySelector('.btn-loading').style.display = 'flex';
  const t0 = Date.now();
  try {
    const quality = getPanelQuality('tab-edit');
    let requestSize = null;
    if (sizeVal === 'custom') {
      const w = parseInt(document.getElementById('edit-custom-width')?.value, 10);
      const h = parseInt(document.getElementById('edit-custom-height')?.value, 10);
      requestSize = (w > 0 && h > 0) ? makeSizeSpecFromRatio(w / h, `${w}:${h}`, `${w}×${h}`, true) : makeSizeSpecFromRatio(1, '1:1', '自定义未填写，按 1:1', true);
    } else if (sizeVal !== 'auto') {
      requestSize = /^\d+x\d+$/.test(sizeVal) ? makeSizeSpecFromApiSize(sizeVal) : makeSizeSpecFromRatio(parseRatio(sizeVal), sizeVal, sizeVal, false);
    }
    if (requestSize) prompt += getSizePrompt(requestSize);
    if (isAgnesImageModel(cfg.editModel)) {
      if (maskSourceFile) throw new Error('Agnes Image 2.1 Flash 文档未提供遮罩编辑参数，请先移除遮罩图层');
      const data = await callJsonImageEditGeneration(cfg, cfg.editModel, prompt, editSourceFile, requestSize, quality);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      let imgSrc = extractImage(data); if (!imgSrc) throw new Error('API 未返回图片数据');
      let b64 = imgSrc; if (imgSrc.startsWith('http')) { try { b64 = await blobToBase64(await (await fetch(imgSrc)).blob()); } catch {} }
      loading.style.display = 'none'; result.style.display = 'flex'; document.getElementById('edit-result-img').src = b64;
      currentEditResult = { type: 'edit', prompt, size: requestSize ? (requestSize.label || requestSize.apiSize) : 'auto', model: cfg.editModel, quality, imageData: b64, elapsed: +elapsed, createdAt: Date.now() };
      await addToHistory(currentEditResult); showToast('编辑完成');
      return;
    }
    if (isQwenImageEditModel(cfg.editModel)) {
      const data = await callAliasedImageEditGeneration(cfg, cfg.editModel, prompt, editSourceFile);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      let imgSrc = extractImage(data); if (!imgSrc) throw new Error('API 未返回图片数据');
      let b64 = imgSrc; if (imgSrc.startsWith('http')) { try { b64 = await blobToBase64(await (await fetch(imgSrc)).blob()); } catch {} }
      loading.style.display = 'none'; result.style.display = 'flex'; document.getElementById('edit-result-img').src = b64;
      currentEditResult = { type: 'edit', prompt, size: requestSize ? (requestSize.label || requestSize.apiSize) : 'auto', model: cfg.editModel, quality, imageData: b64, elapsed: +elapsed, createdAt: Date.now() };
      await addToHistory(currentEditResult); showToast('编辑完成');
      return;
    }
    let data;
    if (!maskSourceFile && prefersJsonImageEdit(cfg)) {
      data = await callJsonImageEditGeneration(cfg, cfg.editModel, prompt, editSourceFile, requestSize, quality);
    } else {
      const fd = new FormData(); fd.append('image', editSourceFile); if (maskSourceFile) fd.append('mask', maskSourceFile); fd.append('prompt', prompt); fd.append('model', getApiModel(cfg.editModel)); if (requestSize) requestSize = appendImageRequestOptions(fd, requestSize, quality, cfg.editModel); else appendImageRequestOptions(fd, null, quality, cfg.editModel); fd.append('n', '1');
      try {
        const res = await fetch(apiUrl('/v1/images/edits'), { method: 'POST', headers: { 'Authorization': `Bearer ${cfg.apiKey}` }, body: fd });
        if (!res.ok) { const t = await res.text(); throw new Error(parseApiError(t, res.status)); }
        data = await res.json();
      } catch (err) {
        if (maskSourceFile || !isFetchNetworkError(err)) throw err;
        data = await callJsonImageEditGeneration(cfg, cfg.editModel, prompt, editSourceFile, requestSize, quality);
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    let imgSrc = extractImage(data); if (!imgSrc) throw new Error('API 未返回图片数据');
    let b64 = imgSrc; if (imgSrc.startsWith('http')) { try { b64 = await blobToBase64(await (await fetch(imgSrc)).blob()); } catch {} }
    loading.style.display = 'none'; result.style.display = 'flex'; document.getElementById('edit-result-img').src = b64;
    currentEditResult = { type: 'edit', prompt, size: requestSize ? (requestSize.label || requestSize.apiSize) : 'auto', model: cfg.editModel, quality, imageData: b64, elapsed: +elapsed, createdAt: Date.now() };
    await addToHistory(currentEditResult); showToast('编辑完成');
  } catch (err) { loading.style.display = 'none'; container.classList.add('empty'); empty.style.display = 'flex'; showToast(friendlyError(err), 5000); }
  finally { btn.disabled = false; btn.querySelector('.btn-content').style.display = 'flex'; btn.querySelector('.btn-loading').style.display = 'none'; }
}

// ===== Downloads =====
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 640;
}

async function mobileShareImage(url, name) {
  try {
    let blob;
    const res = await fetch(url);
    blob = await res.blob();
    if (blob.type && !blob.type.includes('png')) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = URL.createObjectURL(blob); });
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
      cvs.getContext('2d').drawImage(img, 0, 0);
      blob = await new Promise(r => cvs.toBlob(r, 'image/png'));
      URL.revokeObjectURL(img.src);
    }
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (e) {
    if (e.name === 'AbortError') return true;
    console.warn('Share failed:', e);
  }
  return false;
}

function downloadImage(url, name) {
  if (isMobileDevice()) {
    mobileShareImage(url, name).then(ok => { if (!ok) fallbackDownload(url, name); });
    return;
  }
  fallbackDownload(url, name);
}

function fallbackDownload(url, name) {
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } else {
    fetch(url).then(r => r.blob()).then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }).catch(() => { window.open(url, '_blank'); });
  }
}
function ts() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function downloadCurrent() { if (currentGenResult?.imageData) downloadImage(currentGenResult.imageData, `imageforge-${ts()}.png`); }
function downloadEditResult() { if (currentEditResult?.imageData) downloadImage(currentEditResult.imageData, `imageforge-edit-${ts()}.png`); }
function sendToEdit() { if (!currentGenResult?.imageData) return; fetch(currentGenResult.imageData).then(r => r.blob()).then(blob => { editSourceFile = new File([blob], 'generated.png', { type: 'image/png' }); const img = document.getElementById('edit-upload-preview'); img.src = currentGenResult.imageData; img.style.display = 'block'; document.getElementById('edit-upload-placeholder').style.display = 'none'; switchTab('edit'); showToast('已发送到编辑'); }); }

// ===== Fullscreen =====
function openFullscreen() { const s = document.getElementById('gen-result-img').src; if (s) { document.getElementById('fullscreen-img').src = s; document.getElementById('fullscreen-overlay').style.display = 'flex'; } }
function openEditFullscreen() { const s = document.getElementById('edit-result-img').src; if (s) { document.getElementById('fullscreen-img').src = s; document.getElementById('fullscreen-overlay').style.display = 'flex'; } }
function closeFullscreen() { document.getElementById('fullscreen-overlay').style.display = 'none'; }

// ===== History =====
async function refreshHistory() {
  if (!db) return;
  const items = await getAllHistory();
  let filtered = historyFilter === 'all' ? items : items.filter(i => i.type === historyFilter);
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  document.getElementById('history-count').textContent = `${filtered.length} 条记录`;
  const grid = document.getElementById('history-grid');
  if (!filtered.length) { grid.innerHTML = `<div class="history-empty"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg></div><h3 class="empty-title">暂无记录</h3><p class="empty-desc">创作的图片会自动保存在这里</p></div>`; return; }
  const typeLabels = { generate: '生成', edit: '编辑', product: '商品图', style: '风格复刻', clothing: '服装', refine: '精修' };
  grid.innerHTML = filtered.map(item => `<div class="history-card" onclick="openDetail(${item.id})"><img class="history-card-img" src="${item.imageData}" loading="lazy" /><div class="history-card-body"><div class="history-card-prompt">${esc(item.prompt)}</div><div class="history-card-meta"><span class="history-card-badge badge-gen">${typeLabels[item.type] || item.type}</span><span>${fmtTime(item.createdAt)}</span></div></div></div>`).join('');
}
function filterHistory(type, btn) { historyFilter = type; document.querySelectorAll('.htab').forEach(b => b.classList.remove('active')); if (btn) btn.classList.add('active'); refreshHistory(); }
async function clearHistory() { if (!confirm('确定要清空所有历史记录？')) return; await clearAllHistory(); showToast('已清空'); }

// ===== Detail =====
function openDetail(id) { const r = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id); r.onsuccess = () => { const item = r.result; if (!item) return; currentDetailItem = item; document.getElementById('detail-title').textContent = '图片详情'; document.getElementById('detail-img').src = item.imageData; document.getElementById('detail-type').textContent = item.type; document.getElementById('detail-prompt').textContent = item.prompt; document.getElementById('detail-size').textContent = item.size || '—'; document.getElementById('detail-elapsed').textContent = item.elapsed ? `${item.elapsed}s` : '—'; document.getElementById('detail-time').textContent = fmtTimeFull(item.createdAt); document.getElementById('detail-modal').style.display = 'flex'; }; }
function closeDetail() { document.getElementById('detail-modal').style.display = 'none'; currentDetailItem = null; }
function closeDetailOutside(e) { if (e.target === e.currentTarget) closeDetail(); }
async function deleteHistoryItem() { if (!currentDetailItem || !confirm('确定删除？')) return; await deleteFromHistory(currentDetailItem.id); closeDetail(); showToast('已删除'); }
function downloadDetailImage() { if (!currentDetailItem) return; downloadImage(currentDetailItem.imageData, `imageforge-${ts()}.png`); }

// ===== Utils =====
function blobToBase64(blob) { return new Promise(r => { const fr = new FileReader(); fr.onloadend = () => r(fr.result); fr.readAsDataURL(blob); }); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtTime(t) { const d = Date.now() - t; if (d < 60000) return '刚刚'; if (d < 3600000) return `${Math.floor(d/60000)} 分钟前`; if (d < 86400000) return `${Math.floor(d/3600000)} 小时前`; if (d < 604800000) return `${Math.floor(d/86400000)} 天前`; const dt = new Date(t); return `${dt.getMonth()+1}/${dt.getDate()}`; }
function fmtTimeFull(t) { return new Date(t).toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }); }

// ===== Toast =====
let _tt = null;
function showToast(msg, duration) { let el = document.getElementById('toast'); el.textContent = msg; clearTimeout(_tt); requestAnimationFrame(() => { el.classList.add('show'); _tt = setTimeout(() => el.classList.remove('show'), duration || 3000); }); }

// ===== Keys =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeFullscreen(); closeSettings(); closeDetail(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const tab = document.querySelector('.tab-panel.active')?.id;
    if (tab === 'tab-generate') generateImage();
    else if (tab === 'tab-edit') editImage();
    else if (tab === 'tab-product') generateNew('product');
    else if (tab === 'tab-style') generateNew('style');
    else if (tab === 'tab-clothing') generateNew('clothing');
    else if (tab === 'tab-refine') generateNew('refine');
    else if (tab === 'tab-video') generateVideo();
  }
});








// ===== Gallery Cases =====
let caseFilter = '全部';
let currentCase = null;
let currentCaseLang = 'all';
let casesReady = false;

function initCases() {
  if (casesReady) return renderCases();
  const cases = window.GALLERY_CASES || [];
  const bar = document.getElementById('case-category-bar');
  if (!bar) return;
  const counts = new Map();
  cases.forEach(c => (c.categories || ['全部案例']).forEach(cat => counts.set(cat, (counts.get(cat) || 0) + 1)));
  const cats = ['全部', ...Array.from(counts.entries()).sort((a,b) => b[1] - a[1]).map(([k]) => k)];
  bar.innerHTML = cats.map(cat => `<button class="case-cat${cat === caseFilter ? ' active' : ''}" onclick="selectCaseCategory('${escAttr(cat)}', this)">${esc(cat)}${cat === '全部' ? '' : ` <span>${counts.get(cat)}</span>`}</button>`).join('');
  casesReady = true;
  renderCases();
}

function selectCaseCategory(cat, btn) {
  caseFilter = cat;
  document.querySelectorAll('.case-cat').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCases();
}

function renderCases() {
  const cases = window.GALLERY_CASES || [];
  const grid = document.getElementById('case-grid');
  const count = document.getElementById('case-count');
  if (!grid) return;
  const q = (document.getElementById('case-search')?.value || '').trim().toLowerCase();
  let list = cases.filter(c => caseFilter === '全部' || (c.categories || []).includes(caseFilter));
  if (q) list = list.filter(c => `${c.title} ${c.source} ${c.prompt} ${(c.categories || []).join(' ')}`.toLowerCase().includes(q));
  if (count) count.textContent = `${list.length} / ${cases.length} 个案例`;
  grid.innerHTML = list.map(c => `
    <article class="case-card" onclick="openCaseDetail(${c.id})">
      <div class="case-thumb"><img src="${escAttr(c.image)}" loading="lazy" alt="${escAttr(c.title)}"></div>
      <div class="case-card-body">
        <div class="case-card-title">${esc(c.title)}</div>
        <div class="case-card-tags">${(c.categories || []).slice(0,2).map(cat => `<span>${esc(cat)}</span>`).join('')}${c.ratio ? `<span>${esc(c.ratio)}</span>` : ''}</div>
      </div>
    </article>`).join('') || '<div class="history-empty"><h3 class="empty-title">没有找到案例</h3><p class="empty-desc">换个关键词或分类试试</p></div>';
}

function openCaseDetail(id) {
  const c = (window.GALLERY_CASES || []).find(x => x.id === id);
  if (!c) return;
  currentCase = c;
  document.getElementById('case-detail-title').textContent = `案例 ${c.id}：${c.title}`;
  document.getElementById('case-detail-img').src = c.image;
  document.getElementById('case-detail-cats').textContent = (c.categories || []).join(' / ');
  document.getElementById('case-detail-source').textContent = c.source ? `来源：${c.source}` : '';
  currentCaseLang = 'all';
  updateCasePromptView();
  document.getElementById('case-modal').style.display = 'flex';
}

function closeCaseDetail() { document.getElementById('case-modal').style.display = 'none'; currentCase = null; }
function closeCaseOutside(e) { if (e.target === e.currentTarget) closeCaseDetail(); }
function cleanCasePromptText(text, lang = currentCaseLang) {
  let s = String(text || '').trim();
  if (!s) return '';

  const zhMatch = s.match(/\[(?:中文|Chinese|ZH)\]\s*([\s\S]*?)(?=\n\s*\[(?:English|英文|EN)\]|$)/i);
  const enMatch = s.match(/\[(?:English|英文|EN)\]\s*([\s\S]*?)(?=\n\s*\[(?:中文|Chinese|ZH)\]|$)/i);

  if (lang === 'zh' && zhMatch) return zhMatch[1].trim();
  if (lang === 'en' && enMatch) return enMatch[1].trim();

  // “全部”视图不再把 [中文]/[English] 两段都塞进生成页；优先中文，没有中文就英文。
  if (zhMatch) return zhMatch[1].trim();
  if (enMatch) return enMatch[1].trim();

  s = s.replace(/^\s*\[(?:中文|Chinese|ZH|English|英文|EN)\]\s*/gim, '').trim();
  return s;
}

function getCurrentCasePrompt() {
  if (!currentCase) return '';
  if (currentCaseLang === 'zh') return cleanCasePromptText(currentCase.promptZh || currentCase.prompt, 'zh');
  if (currentCaseLang === 'en') return cleanCasePromptText(currentCase.promptEn || currentCase.prompt, 'en');
  return cleanCasePromptText(currentCase.promptZh || currentCase.prompt || currentCase.promptEn, 'all');
}
function setCasePromptLang(lang) { currentCaseLang = lang; updateCasePromptView(); }
function updateCasePromptView() {
  document.querySelectorAll('.case-lang-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`case-lang-${currentCaseLang}`)?.classList.add('active');
  const el = document.getElementById('case-detail-prompt');
  if (el) el.value = getCurrentCasePrompt();
}
function copyCasePrompt() { const text = getCurrentCasePrompt(); if (!text) return; navigator.clipboard?.writeText(text); showToast('当前提示词已复制'); }
function useCasePrompt() {
  const text = getCurrentCasePrompt();
  if (!text) return;
  const promptEl = document.getElementById('gen-prompt');
  promptEl.value = text;
  document.getElementById('prompt-count').textContent = text.length;
  applyCaseImageSizeToGenerate(currentCase);
  closeCaseDetail();
  switchTab('generate');
}
function applyCaseImageSizeToGenerate(c) {
  if (!c?.image) return;
  getImageNaturalSize(c.image).then(size => {
    if (!size?.width || !size?.height) return;
    const grid = document.getElementById('generate-size-grid');
    if (!grid) return;
    const customBtn = grid.querySelector('.size-btn[data-ratio="custom"], .size-btn[data-size="custom"]');
    if (customBtn) selectSize(customBtn);
    const row = grid.parentElement?.querySelector('.custom-size-row');
    if (row) row.style.display = 'flex';
    const w = grid.parentElement?.querySelector('.custom-width');
    const h = grid.parentElement?.querySelector('.custom-height');
    if (w) w.value = size.width;
    if (h) h.value = size.height;
    grid.dataset.selectedSize = 'custom';
    grid.dataset.selectedRatio = 'custom';
    showToast(`已带入当前提示词，尺寸 ${size.width}×${size.height}`);
  }).catch(() => showToast('已带入当前提示词，原图尺寸读取失败'));
}
function getImageNaturalSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}
function escAttr(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// ===== Mobile Bottom Nav =====
function mobileSwitchTab(tab) {
  // Switch tab content
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.classList.add('active');
  const navBtn = document.querySelector('.nav-btn[data-tab="' + tab + '"]');
  if (navBtn) navBtn.classList.add('active');

  // Update bottom nav active state
  document.querySelectorAll('.mob-nav-item').forEach(b => b.classList.remove('active'));
  const directBtn = document.querySelector('.mob-nav-item[data-tab="' + tab + '"]');
  if (directBtn) {
    directBtn.classList.add('active');
  } else {
    // Tab is from "more" menu — highlight "more" button
    const moreBtn = document.querySelector('.mob-nav-item[data-tab="more"]');
    if (moreBtn) moreBtn.classList.add('active');
  }

  // Trigger tab-specific init
  if (tab === 'history') refreshHistory();
  if (tab === 'cases') initCases();
  if (tab === 'video') renderVideoTasks();

  // Scroll to top
  window.scrollTo(0, 0);
}

function toggleMobileMore() {
  var overlay = document.getElementById('mobileMoreOverlay');
  if (!overlay) return;
  if (overlay.classList.contains('open')) {
    closeMobileMore();
  } else {
    overlay.style.display = 'block';
    overlay.offsetHeight; // force reflow
    overlay.classList.add('open');
  }
}

function closeMobileMore() {
  var overlay = document.getElementById('mobileMoreOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  setTimeout(function() {
    if (!overlay.classList.contains('open')) {
      overlay.style.display = '';
    }
  }, 300);
}
