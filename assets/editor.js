/* ===== PeroPix 이미지 편집기 (독립 모듈, classic script) =====
 * 진입점: window.openEditor(imageBase64|dataURL, metadata, opts)
 * 호스트(index.html)의 전역 함수/변수를 그대로 호출한다:
 *   showToast, resolveImageBase64, addSlot, addImageToSlot, addImageToSingle,
 *   selectSingleImage, setActiveView, setBaseImageForInpaint, updateBaseImageUI,
 *   baseImageData(재할당), currentMode, genMode, currentSingleImageData,
 *   currentGalleryFolder, getOutputFolder, API_BASE
 * → editor.js 는 반드시 classic script 로 로드해야 전역 공유가 된다 (type="module" 금지).
 */
(function () {
    'use strict';

    // ---- 소형 SVG 아이콘 (자기완결) ----
    const S = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const IC = {
        move: S('<path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/>'),
        brush: S('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
        eraser: S('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
        crop: S('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
        resize: S('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>'),
        undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
        redo: S('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>'),
        close: S('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
        save: S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
        star: S('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
        inpaint: S('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
        i2i: S('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'),
        grid: S('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
        image: S('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'),
        pencil: S('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
        folder: S('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
        refresh: S('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>'),
    };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const API = () => (typeof API_BASE !== 'undefined' ? API_BASE : '');
    const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'info'); };

    // ---- 상태 ----
    let modal, canvas, ctx, overlay, octx, stack, canvasArea, subbar, dimsEl, undoBtn, redoBtn, zoomLabel;
    // 레이어: base(원본/편집 이미지) + paint(브러시 획). canvas(#pxeCanvas)는 둘의 합성 결과(표시·내보내기)
    let baseCanvas, baseCtx, paintCanvas, paintCtx;
    let tool = 'move';
    let zoom = 1;   // 화면 맞춤(fit) 대비 배율
    let brushSize = 24, eraserSize = 40, brushColor = '#000000';
    let eraseTarget = 'brush';   // 지우개 대상: 'brush'(브러시 획만 지움) | 'all'(배경 이미지까지 투명)
    let recentColors = [];       // 최근 사용 브러시 색상 (localStorage 로 재실행 후에도 유지)
    let currentMetadata = null;
    let currentSeed = null;
    let currentOpts = {};
    let openToken = 0;   // 빠른 연속 open() 경합 방지 (오래된 img.onload 무시)

    // 히스토리 (ImageData 스냅샷, 캔버스 크기 변화 안전)
    const HIST_MAX = 12;   // 레이어 2개(base+paint) 스냅샷이라 메모리 고려해 축소
    let history = [];
    let histIndex = -1;

    // 자르기 상태
    let crop = null;        // {x,y,w,h} 이미지 좌표
    let cropDrag = null;    // {mode, pt, crop}

    // 브러시 스트로크 상태
    let drawing = false, lastPt = null;
    // 이동(팬) 상태 — translate 로 이동. 각 모서리가 화면 중앙까지 오도록 ±(표시크기/2) 클램프
    let panning = false, panStart = null;
    let panX = 0, panY = 0, dispW = 0, dispH = 0;

    // ---- DOM 구축 ----
    function build() {
        modal = document.createElement('div');
        modal.className = 'pxe-view';
        modal.id = 'pxeView';
        modal.innerHTML = `
            <div class="pxe-header">
                <span class="pxe-title">이미지 편집</span>
                <div class="pxe-header-right">
                    <div class="pxe-folder">
                        <span class="pxe-folder-label">Save to:</span>
                        <div class="folder-dropdown" id="pxeOutputFolderDropdown">
                            <button type="button" class="header-btn folder-btn" id="pxeOutputFolderBtn">
                                <span class="folder-icon">${(typeof ICONS !== 'undefined' && ICONS.folder) ? ICONS.folder : IC.folder}</span>
                                <span class="folder-name" id="pxeOutputFolderName">output</span>
                                <span class="dropdown-arrow">▼</span>
                            </button>
                        </div>
                        <button type="button" class="header-btn icon-only" id="pxeOpenOutputFolderBtn" title="출력 폴더 열기"><span>${(typeof ICONS !== 'undefined' && ICONS.folderOpen) ? ICONS.folderOpen : IC.folder}</span></button>
                    </div>
                    <div class="pxe-header-actions">
                        <button type="button" class="pxe-hbtn" id="pxeUndo" title="되돌리기">${IC.undo}</button>
                        <button type="button" class="pxe-hbtn" id="pxeRedo" title="다시하기">${IC.redo}</button>
                        <button type="button" class="pxe-hbtn pxe-close" id="pxeClose" title="편집 화면 닫기 (작업 유지 · Esc)">${IC.close}</button>
                    </div>
                </div>
            </div>
            <div class="pxe-subbar" id="pxeSubbar"></div>
            <div class="pxe-body">
                <div class="pxe-tools">
                    <button type="button" class="pxe-tool" data-tool="move" title="이동">${IC.move}</button>
                    <button type="button" class="pxe-tool" data-tool="brush" title="브러시">${IC.brush}</button>
                    <button type="button" class="pxe-tool" data-tool="eraser" title="지우개">${IC.eraser}</button>
                    <button type="button" class="pxe-tool" data-tool="crop" title="자르기">${IC.crop}</button>
                    <button type="button" class="pxe-tool" data-tool="resize" title="리사이즈">${IC.resize}</button>
                </div>
                <div class="pxe-canvas-area" id="pxeCanvasArea">
                    <div class="pxe-canvas-stack" id="pxeStack">
                        <canvas id="pxeCanvas"></canvas>
                        <canvas id="pxeOverlay"></canvas>
                    </div>
                    <div class="pxe-bgsw" id="pxeBgSw" title="이미지 뒤 배경 표시">
                        <button type="button" class="pxe-bgsw-btn checker active" data-bg="checker" title="투명(체커)"></button>
                        <button type="button" class="pxe-bgsw-btn white" data-bg="white" title="흰 배경"></button>
                        <button type="button" class="pxe-bgsw-btn black" data-bg="black" title="검은 배경"></button>
                    </div>
                </div>
                <div class="pxe-zoom">
                    <button type="button" class="pxe-zoom-btn" id="pxeZoomOut" title="축소">−</button>
                    <button type="button" class="pxe-zoom-btn" id="pxeZoomReset" title="화면 맞춤"><span id="pxeZoomLabel">100%</span></button>
                    <button type="button" class="pxe-zoom-btn" id="pxeZoomIn" title="확대">+</button>
                </div>
            </div>
            <div class="pxe-footer">
                <div class="pxe-dims" id="pxeDims"></div>
                <div class="pxe-actions">
                    <button type="button" class="pxe-btn" id="pxeSave">${IC.save}<span>저장</span></button>
                    <button type="button" class="pxe-btn gold" id="pxeGallery">${IC.star}<span>갤러리저장</span></button>
                    <span class="pxe-sep"></span>
                    <button type="button" class="pxe-btn" id="pxeInpaint">${IC.inpaint}<span>인페인트</span></button>
                    <button type="button" class="pxe-btn" id="pxeI2i">${IC.i2i}<span>i2i</span></button>
                    <span class="pxe-sep"></span>
                    <button type="button" class="pxe-btn primary" id="pxeToMulti">${IC.grid}<span>멀티로 보내기</span></button>
                    <button type="button" class="pxe-btn primary" id="pxeToSingle">${IC.image}<span>싱글로 보내기</span></button>
                </div>
            </div>`;
        // 모달이 아니라 .main 의 뷰 컨테이너로 삽입 (slotsWrapper/singleContainer 형제)
        (document.querySelector('.main') || document.body).appendChild(modal);

        canvas = modal.querySelector('#pxeCanvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        baseCanvas = document.createElement('canvas'); baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
        paintCanvas = document.createElement('canvas'); paintCtx = paintCanvas.getContext('2d', { willReadFrequently: true });
        overlay = modal.querySelector('#pxeOverlay');
        octx = overlay.getContext('2d');
        stack = modal.querySelector('#pxeStack');
        canvasArea = modal.querySelector('#pxeCanvasArea');
        subbar = modal.querySelector('#pxeSubbar');
        dimsEl = modal.querySelector('#pxeDims');
        undoBtn = modal.querySelector('#pxeUndo');
        redoBtn = modal.querySelector('#pxeRedo');

        // 헤더
        undoBtn.onclick = undo;
        redoBtn.onclick = redo;
        modal.querySelector('#pxeClose').onclick = leaveEditor;  // 닫기 = 세션 유지한 채 나가기
        // 저장 폴더 선택 (독립) — 호스트의 공용 폴더 메뉴를 'editor' 대상으로 연다
        const folderBtn = modal.querySelector('#pxeOutputFolderBtn');
        if (folderBtn) folderBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof toggleOutputFolderMenu === 'function') toggleOutputFolderMenu(folderBtn, 'editor');
        };
        const openFolderBtn = modal.querySelector('#pxeOpenOutputFolderBtn');
        if (openFolderBtn) openFolderBtn.onclick = () => {
            if (typeof openFolder === 'function') openFolder('outputs', (typeof editorOutputFolder !== 'undefined') ? editorOutputFolder : '');
        };

        // 툴 선택
        modal.querySelectorAll('.pxe-tool').forEach(b => {
            b.onclick = () => selectTool(b.dataset.tool);
        });

        // 이미지 뒤 배경 표시 토글 (투명/흰/검)
        modal.querySelectorAll('.pxe-bgsw-btn').forEach(b => {
            b.onclick = () => setCanvasBg(b.dataset.bg);
        });

        // 출력 액션
        modal.querySelector('#pxeSave').onclick = actSave;
        modal.querySelector('#pxeGallery').onclick = actGallery;
        modal.querySelector('#pxeInpaint').onclick = actInpaint;
        modal.querySelector('#pxeI2i').onclick = actI2i;
        modal.querySelector('#pxeToMulti').onclick = actToMulti;
        modal.querySelector('#pxeToSingle').onclick = actToSingle;

        // 포인터 (드래그 캡처)
        stack.addEventListener('pointerdown', onPointerDown);
        stack.addEventListener('pointermove', onPointerMove);
        stack.addEventListener('pointerup', onPointerUp);
        stack.addEventListener('pointerleave', () => { if (!drawing && (tool === 'brush' || tool === 'eraser')) clearOverlay(); });
        stack.addEventListener('contextmenu', e => e.preventDefault());

        // 확대/축소
        zoomLabel = modal.querySelector('#pxeZoomLabel');
        modal.querySelector('#pxeZoomOut').onclick = zoomOut;
        modal.querySelector('#pxeZoomIn').onclick = zoomIn;
        modal.querySelector('#pxeZoomReset').onclick = zoomReset;
        canvasArea.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); (e.deltaY < 0 ? zoomIn : zoomOut)(); }
        }, { passive: false });
    }

    // ---- 좌표/레이아웃 ----
    function toImg(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height)
        };
    }
    function displayScale() {
        return (canvas.clientWidth || canvas.width) / canvas.width;
    }
    function fitToView() {
        const pad = 16;
        const availW = Math.max(64, canvasArea.clientWidth - pad);
        const availH = Math.max(64, canvasArea.clientHeight - pad);
        const fit = Math.min(availW / canvas.width, availH / canvas.height, 1);
        const scale = fit * zoom;
        const dw = Math.max(1, Math.round(canvas.width * scale));
        const dh = Math.max(1, Math.round(canvas.height * scale));
        canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
        overlay.style.width = dw + 'px'; overlay.style.height = dh + 'px';
        stack.style.width = dw + 'px'; stack.style.height = dh + 'px';
        if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
        dispW = dw; dispH = dh;
        clampPan(); applyPan();
    }
    // 팬 클램프: 각 모서리가 뷰 중앙까지 올 수 있도록 표시크기의 절반까지 허용
    function clampPan() {
        panX = clamp(panX, -dispW / 2, dispW / 2);
        panY = clamp(panY, -dispH / 2, dispH / 2);
    }
    function applyPan() {
        stack.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px)`;
    }
    function setZoom(z) { zoom = clamp(z, 0.1, 8); fitToView(); }
    function zoomIn() { setZoom(zoom * 1.25); }
    function zoomOut() { setZoom(zoom / 1.25); }
    function zoomReset() { panX = 0; panY = 0; setZoom(1); }
    // 리사이즈 라이브 프리뷰: 픽셀 버퍼는 그대로, 표시 크기만 목표 W×H 로 늘려 보여줌 (적용 전까지)
    function previewResize(tw, th) {
        tw = Math.max(1, tw); th = Math.max(1, th);
        const pad = 16;
        const availW = Math.max(64, canvasArea.clientWidth - pad);
        const availH = Math.max(64, canvasArea.clientHeight - pad);
        const scale = Math.min(availW / tw, availH / th, 1) * zoom;
        const dw = Math.max(1, Math.round(tw * scale));
        const dh = Math.max(1, Math.round(th * scale));
        canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
        overlay.style.width = dw + 'px'; overlay.style.height = dh + 'px';
        stack.style.width = dw + 'px'; stack.style.height = dh + 'px';
        dispW = dw; dispH = dh; clampPan(); applyPan();
    }
    function syncOverlaySize() {
        overlay.width = canvas.width;
        overlay.height = canvas.height;
    }
    // 표시 캔버스 = base + paint 합성. 레이어 변경 후 매번 호출
    function renderComposite() {
        if (canvas.width !== baseCanvas.width || canvas.height !== baseCanvas.height) {
            canvas.width = baseCanvas.width; canvas.height = baseCanvas.height;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(baseCanvas, 0, 0);
        ctx.drawImage(paintCanvas, 0, 0);
    }
    function updateDims() {
        if (dimsEl) dimsEl.textContent = `${canvas.width} × ${canvas.height} px`;
    }
    function isEditorActive() {
        if (typeof currentMode !== 'undefined') return currentMode === 'editor';
        return !!(modal && modal.style.display !== 'none');
    }
    function onWinResize() {
        if (!isEditorActive()) return;
        fitToView();
        renderOverlay();
    }

    // ---- 히스토리 ----
    function pushHistory() {
        history.splice(histIndex + 1);
        history.push({
            w: baseCanvas.width, h: baseCanvas.height,
            base: baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height),
            paint: paintCtx.getImageData(0, 0, paintCanvas.width, paintCanvas.height)
        });
        if (history.length > HIST_MAX) history.shift();
        histIndex = history.length - 1;
        updateUndoRedo();
    }
    function restoreSnapshot(s) {
        baseCanvas.width = s.w; baseCanvas.height = s.h; baseCtx.putImageData(s.base, 0, 0);
        paintCanvas.width = s.w; paintCanvas.height = s.h; paintCtx.putImageData(s.paint, 0, 0);
        renderComposite();
        fitToView(); syncOverlaySize(); updateDims();
        if (tool === 'crop') { setCropAspect(null); } else renderOverlay();
    }
    function undo() {
        if (histIndex <= 0) return;
        histIndex--; restoreSnapshot(history[histIndex]); updateUndoRedo();
    }
    function redo() {
        if (histIndex >= history.length - 1) return;
        histIndex++; restoreSnapshot(history[histIndex]); updateUndoRedo();
    }
    function updateUndoRedo() {
        undoBtn.disabled = histIndex <= 0;
        redoBtn.disabled = histIndex >= history.length - 1;
    }

    // ---- 툴 선택 & 서브바 ----
    function selectTool(name) {
        tool = name;
        modal.querySelectorAll('.pxe-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
        stack.className = 'pxe-canvas-stack tool-' + name;
        renderSubbar();
        fitToView();   // 리사이즈 프리뷰 등 이전 표시 배율을 실제 크기로 복원
        if (name === 'crop') setCropAspect(null); else { crop = null; renderOverlay(); }
    }

    // 최근 사용 색상 (localStorage 유지)
    function addRecentColor(color) {
        color = (color || '').toLowerCase();
        if (!color) return;
        recentColors = recentColors.filter(c => c !== color);
        recentColors.unshift(color);
        recentColors = recentColors.slice(0, 5);
        try { localStorage.setItem('pxeRecentColors', JSON.stringify(recentColors)); } catch (_) {}
    }
    function renderRecentColors(container) {
        if (!container) return;
        container.innerHTML = '';
        recentColors.forEach(c => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'pxe-swatch';
            sw.style.background = c;
            sw.title = c;
            sw.onclick = () => {
                brushColor = c;
                const colorEl = subbar.querySelector('#pxeColor');
                if (colorEl) colorEl.value = c;
                addRecentColor(c);                 // 클릭한 색을 최근 맨 앞으로
                renderRecentColors(container);
            };
            container.appendChild(sw);
        });
    }

    function renderSubbar() {
        if (tool === 'brush' || tool === 'eraser') {
            const sz = tool === 'brush' ? brushSize : eraserSize;
            subbar.innerHTML = `
                <div class="pxe-field"><label>크기</label>
                    <input type="range" id="pxeSize" min="1" max="200" value="${sz}">
                    <span class="pxe-val" id="pxeSizeVal">${sz}</span>
                </div>
                ${tool === 'brush' ? `<div class="pxe-field"><label>색상</label><input type="color" id="pxeColor" value="${brushColor}"><span class="pxe-recent" id="pxeRecent"></span></div>` : ''}
                ${tool === 'eraser' ? `<div class="pxe-field"><label>지울 대상</label>
                    <button type="button" class="pxe-chip ${eraseTarget === 'brush' ? 'active' : ''}" data-erase="brush">브러시만</button>
                    <button type="button" class="pxe-chip ${eraseTarget === 'all' ? 'active' : ''}" data-erase="all">배경 포함</button>
                </div>` : ''}`;
            const sizeEl = subbar.querySelector('#pxeSize');
            const sizeVal = subbar.querySelector('#pxeSizeVal');
            // 앱 슬라이더 스타일(.range-wrap + .range-fill 게이지) 적용 — 전역 range 스타일과 일관
            if (typeof wrapSlider === 'function') wrapSlider(sizeEl);
            sizeEl.oninput = () => {
                const v = parseInt(sizeEl.value) || 1;
                if (tool === 'brush') brushSize = v; else eraserSize = v;
                sizeVal.textContent = v;
            };
            const colorEl = subbar.querySelector('#pxeColor');
            const recentEl = subbar.querySelector('#pxeRecent');
            if (recentEl) renderRecentColors(recentEl);
            if (colorEl) {
                colorEl.oninput = () => { brushColor = colorEl.value; };
                // change(선택 완료) 시에만 최근 색상에 추가 (드래그 중 중간색 폭주 방지)
                colorEl.onchange = () => { brushColor = colorEl.value; addRecentColor(colorEl.value); if (recentEl) renderRecentColors(recentEl); };
            }
            subbar.querySelectorAll('[data-erase]').forEach(c => {
                c.onclick = () => {
                    eraseTarget = c.dataset.erase;
                    subbar.querySelectorAll('[data-erase]').forEach(x => x.classList.toggle('active', x.dataset.erase === eraseTarget));
                };
            });
        } else if (tool === 'crop') {
            subbar.innerHTML = `
                <div class="pxe-field"><label>비율</label>
                    <button type="button" class="pxe-chip" data-r="0">전체</button>
                    <button type="button" class="pxe-chip" data-r="1">1:1</button>
                    <button type="button" class="pxe-chip" data-r="1.3333">4:3</button>
                    <button type="button" class="pxe-chip" data-r="0.75">3:4</button>
                    <button type="button" class="pxe-chip" data-r="1.7778">16:9</button>
                    <button type="button" class="pxe-chip" data-r="0.5625">9:16</button>
                </div>
                <button type="button" class="pxe-btn primary" id="pxeCropApply">적용</button>
                <button type="button" class="pxe-btn" id="pxeCropCancel">취소</button>`;
            subbar.querySelectorAll('.pxe-chip').forEach(c => {
                c.onclick = () => {
                    subbar.querySelectorAll('.pxe-chip').forEach(x => x.classList.remove('active'));
                    c.classList.add('active');
                    const r = parseFloat(c.dataset.r);
                    setCropAspect(r > 0 ? r : null);
                };
            });
            subbar.querySelector('#pxeCropApply').onclick = applyCrop;
            subbar.querySelector('#pxeCropCancel').onclick = () => selectTool('move');
        } else if (tool === 'resize') {
            const cw = canvas.width, ch = canvas.height;
            subbar.innerHTML = `
                <div class="pxe-field"><label>W</label><input type="number" id="pxeRW" min="1" max="8192" value="${cw}"></div>
                <div class="pxe-field"><label>H</label><input type="number" id="pxeRH" min="1" max="8192" value="${ch}"></div>
                <label class="pxe-field"><input type="checkbox" id="pxeRLock" checked> 비율 잠금</label>
                <div class="pxe-field">
                    <button type="button" class="pxe-chip" data-w="${Math.round(cw/2)}" data-h="${Math.round(ch/2)}">½</button>
                    <button type="button" class="pxe-chip" data-w="${cw*2}" data-h="${ch*2}">2×</button>
                    <button type="button" class="pxe-chip" data-w="1024" data-h="1024">1024²</button>
                    <button type="button" class="pxe-chip" data-w="1216" data-h="832">1216×832</button>
                    <button type="button" class="pxe-chip" data-w="832" data-h="1216">832×1216</button>
                </div>
                <button type="button" class="pxe-btn" id="pxeResizeReset">${IC.refresh}<span>초기화</span></button>
                <button type="button" class="pxe-btn primary" id="pxeResizeApply">적용</button>`;
            const rw = subbar.querySelector('#pxeRW');
            const rh = subbar.querySelector('#pxeRH');
            const lock = subbar.querySelector('#pxeRLock');
            const ratio = cw / ch;
            const preview = () => previewResize(parseInt(rw.value) || 1, parseInt(rh.value) || 1);
            rw.oninput = () => { if (lock.checked) rh.value = Math.max(1, Math.round((parseInt(rw.value) || 1) / ratio)); preview(); };
            rh.oninput = () => { if (lock.checked) rw.value = Math.max(1, Math.round((parseInt(rh.value) || 1) * ratio)); preview(); };
            subbar.querySelectorAll('.pxe-chip').forEach(c => {
                c.onclick = () => { rw.value = c.dataset.w; rh.value = c.dataset.h; preview(); };
            });
            subbar.querySelector('#pxeResizeReset').onclick = () => { rw.value = cw; rh.value = ch; fitToView(); };
            subbar.querySelector('#pxeResizeApply').onclick = () => {
                let w = Math.max(1, parseInt(rw.value) || 1);
                let h = Math.max(1, parseInt(rh.value) || 1);
                const MAX = 8192;
                // 한 축이라도 상한 초과 시 두 축을 같은 비율로 축소 (종횡비 보존)
                if (w > MAX || h > MAX) { const f = Math.min(MAX / w, MAX / h); w = Math.round(w * f); h = Math.round(h * f); }
                applyResize(w, h);
            };
        } else if (tool === 'move') {
            // 이동 도구: 화면 초기화(확대·이동을 화면 맞춤으로 리셋)
            subbar.innerHTML = `<button type="button" class="pxe-btn" id="pxeViewReset">${IC.refresh}<span>화면 초기화</span></button>`;
            const rb = subbar.querySelector('#pxeViewReset');
            if (rb) rb.onclick = () => zoomReset();
        } else {
            subbar.innerHTML = '';
        }
    }

    // ---- 오버레이 렌더 ----
    function clearOverlay() { octx.clearRect(0, 0, overlay.width, overlay.height); }
    function renderOverlay() {
        clearOverlay();
        if (tool === 'crop' && crop) renderCropOverlay();
    }
    function accent() {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        return v || '#4A7AB8';
    }
    function renderCropOverlay() {
        const ds = displayScale();
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.fillStyle = 'rgba(0,0,0,0.55)';
        octx.fillRect(0, 0, overlay.width, overlay.height);
        octx.clearRect(crop.x, crop.y, crop.w, crop.h);
        const col = accent();
        octx.strokeStyle = col;
        octx.lineWidth = 2 / ds;
        octx.strokeRect(crop.x, crop.y, crop.w, crop.h);
        // 3분할 가이드
        octx.lineWidth = 1 / ds;
        octx.strokeStyle = 'rgba(255,255,255,0.4)';
        for (let i = 1; i < 3; i++) {
            const gx = crop.x + crop.w * i / 3, gy = crop.y + crop.h * i / 3;
            octx.beginPath(); octx.moveTo(gx, crop.y); octx.lineTo(gx, crop.y + crop.h); octx.stroke();
            octx.beginPath(); octx.moveTo(crop.x, gy); octx.lineTo(crop.x + crop.w, gy); octx.stroke();
        }
        // 핸들
        const hs = 12 / ds;
        octx.fillStyle = col;
        const H = cropHandles();
        for (const k in H) {
            // 핸들 사각형을 캔버스 안으로 클램 — 이미지 가장자리에서도 온전히 보이게
            const px = clamp(H[k][0] - hs / 2, 0, overlay.width - hs);
            const py = clamp(H[k][1] - hs / 2, 0, overlay.height - hs);
            octx.fillRect(px, py, hs, hs);
        }
    }
    function cropHandles() {
        const { x, y, w, h } = crop;
        return {
            nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
            se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2]
        };
    }
    function setCropAspect(r) {
        const W = canvas.width, H = canvas.height;
        if (!r) { crop = { x: 0, y: 0, w: W, h: H }; renderOverlay(); return; }
        let w = W, h = w / r;
        if (h > H) { h = H; w = h * r; }
        w = Math.min(w, W); h = Math.min(h, H);
        crop = { x: (W - w) / 2, y: (H - h) / 2, w, h };
        renderOverlay();
    }

    // ---- 포인터 디스패치 ----
    function onPointerDown(e) {
        if (e.button !== 0) return;
        try { stack.setPointerCapture(e.pointerId); } catch (_) {}
        const pt = toImg(e);
        if (tool === 'brush' || tool === 'eraser') { beginStroke(pt); }
        else if (tool === 'crop') { cropDown(pt); }
        else if (tool === 'move') {
            panning = true;
            panStart = { x: e.clientX, y: e.clientY, panX, panY };
            stack.style.cursor = 'grabbing';
        }
    }
    function onPointerMove(e) {
        if (panning) {
            // 드래그한 만큼 translate 이동 (모서리-중앙 클램프)
            panX = panStart.panX + (e.clientX - panStart.x);
            panY = panStart.panY + (e.clientY - panStart.y);
            clampPan(); applyPan();
            return;
        }
        const pt = toImg(e);
        if (drawing) { continueStroke(pt); return; }
        if (tool === 'brush' || tool === 'eraser') { drawCursor(pt); }
        else if (tool === 'crop' && cropDrag) { cropMove(pt); }
    }
    function onPointerUp() {
        if (drawing) endStroke();
        if (cropDrag) cropDrag = null;
        if (panning) { panning = false; stack.style.cursor = ''; }
    }

    // ---- 브러시/지우개 ----
    function size() { return tool === 'brush' ? brushSize : eraserSize; }
    function beginStroke(pt) { drawing = true; lastPt = pt; clearOverlay(); paint(pt, pt); }
    function continueStroke(pt) { if (!drawing) return; paint(lastPt, pt); lastPt = pt; }
    function endStroke() { drawing = false; lastPt = null; pushHistory(); }
    function strokeOp(c, a, b, sz, op, color) {
        c.save();
        c.globalCompositeOperation = op;
        c.strokeStyle = color || '#000'; c.fillStyle = color || '#000';
        c.lineWidth = sz; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        c.beginPath(); c.arc(b.x, b.y, sz / 2, 0, Math.PI * 2); c.fill();
        c.restore();
    }
    function paint(a, b) {
        const sz = size();
        if (tool === 'eraser') {
            strokeOp(paintCtx, a, b, sz, 'destination-out');                    // 브러시 획 지우기
            if (eraseTarget === 'all') strokeOp(baseCtx, a, b, sz, 'destination-out'); // 배경 이미지까지 투명
        } else {
            strokeOp(paintCtx, a, b, sz, 'source-over', brushColor);           // 브러시: paint 레이어에 색칠
        }
        renderComposite();
    }
    function drawCursor(pt) {
        clearOverlay();
        const ds = displayScale();
        octx.strokeStyle = tool === 'eraser' ? 'rgba(229,115,115,0.9)' : accent();
        octx.lineWidth = 1.5 / ds;
        octx.beginPath(); octx.arc(pt.x, pt.y, size() / 2, 0, Math.PI * 2); octx.stroke();
    }

    // ---- 자르기 ----
    function cropDown(pt) {
        const mode = cropHitTest(pt);
        if (!mode) return;
        cropDrag = { mode, pt, crop: { ...crop } };
    }
    function cropHitTest(pt) {
        const tol = 14 / displayScale();
        const H = cropHandles();
        for (const k in H) { if (Math.abs(pt.x - H[k][0]) <= tol && Math.abs(pt.y - H[k][1]) <= tol) return k; }
        if (pt.x >= crop.x && pt.x <= crop.x + crop.w && pt.y >= crop.y && pt.y <= crop.y + crop.h) return 'move';
        return null;
    }
    function cropMove(pt) {
        const dx = pt.x - cropDrag.pt.x, dy = pt.y - cropDrag.pt.y;
        const W = canvas.width, Hh = canvas.height, MIN = 8, c = cropDrag.crop, m = cropDrag.mode;
        if (m === 'move') {
            crop = { x: clamp(c.x + dx, 0, W - c.w), y: clamp(c.y + dy, 0, Hh - c.h), w: c.w, h: c.h };
        } else {
            let L = c.x, T = c.y, R = c.x + c.w, B = c.y + c.h;
            if (m.includes('w')) L = clamp(c.x + dx, 0, R - MIN);
            if (m.includes('e')) R = clamp(c.x + c.w + dx, L + MIN, W);
            if (m.includes('n')) T = clamp(c.y + dy, 0, B - MIN);
            if (m.includes('s')) B = clamp(c.y + c.h + dy, T + MIN, Hh);
            crop = { x: L, y: T, w: R - L, h: B - T };
        }
        renderOverlay();
    }
    function cropLayer(cv, cx, sx, sy, sw, sh) {
        const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
        tmp.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
        cv.width = sw; cv.height = sh;
        cx.clearRect(0, 0, sw, sh); cx.drawImage(tmp, 0, 0);
    }
    function applyCrop() {
        const sx = Math.round(crop.x), sy = Math.round(crop.y);
        const sw = Math.max(1, Math.round(crop.w)), sh = Math.max(1, Math.round(crop.h));
        cropLayer(baseCanvas, baseCtx, sx, sy, sw, sh);
        cropLayer(paintCanvas, paintCtx, sx, sy, sw, sh);
        renderComposite();
        pushHistory();
        fitToView(); syncOverlaySize(); updateDims();
        selectTool('move');
        toast('잘라냄', 'success');
    }

    // ---- 리사이즈 ----
    function resizeLayer(cv, cx, w, h) {
        const tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext('2d').drawImage(cv, 0, 0);
        cv.width = w; cv.height = h;
        cx.clearRect(0, 0, w, h);
        cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
        cx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h);
    }
    function applyResize(w, h) {
        if (w === canvas.width && h === canvas.height) { selectTool('move'); return; }
        resizeLayer(baseCanvas, baseCtx, w, h);
        resizeLayer(paintCanvas, paintCtx, w, h);
        renderComposite();
        pushHistory();
        fitToView(); syncOverlaySize(); updateDims();
        selectTool('move');
        toast(`리사이즈: ${w}×${h}`, 'success');
    }

    // ---- 출력 액션 ----
    function getB64() { return canvas.toDataURL('image/png').split(',')[1]; }

    // 배경 표시 토글 (투명/흰/검) — 이미지 없는 영역까지 캔버스 영역 전체 배경 변경
    function setCanvasBg(mode) {
        if (canvasArea) canvasArea.dataset.bg = mode;
        modal.querySelectorAll('.pxe-bgsw-btn').forEach(x => x.classList.toggle('active', x.dataset.bg === mode));
    }

    async function actSave() {
        const fmt = document.getElementById('saveFormat');
        const q = document.getElementById('jpgQuality');
        const ex = document.getElementById('excludeSlotNumber');
        try {
            const res = await fetch(`${API()}/api/save-preview`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_base64: getB64(), slot_index: 0, slot_name: '',
                    save_format: fmt ? fmt.value : 'png',
                    jpg_quality: q ? (parseInt(q.value) || 95) : 95,
                    output_folder: (typeof editorOutputFolder !== 'undefined') ? editorOutputFolder : '',
                    exclude_slot_number: ex ? ex.checked : false
                })
            });
            const r = await res.json();
            if (r.success) toast(`저장됨: ${r.filename}`, 'success'); else toast(`저장 실패: ${r.error}`, 'error');
        } catch (e) { toast('저장 오류: ' + e.message, 'error'); }
    }

    async function actGallery() {
        try {
            const res = await fetch(`${API()}/api/gallery/save`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: getB64(), filename: 'edited.png',
                    folder: (typeof currentGalleryFolder !== 'undefined' ? currentGalleryFolder : '') || '',
                    metadata: currentMetadata || undefined
                })
            });
            const r = await res.json();
            if (r.success) { toast('갤러리에 저장됨', 'success'); try { window.galleryInitialized = false; } catch (_) {} }
            else toast('갤러리 저장 실패: ' + r.error, 'error');
        } catch (e) { toast('갤러리 저장 오류: ' + e.message, 'error'); }
    }

    function actInpaint() {
        const b64 = getB64();
        // 세션 유지 — setBaseImageForInpaint 가 editor 뷰에서 genMode 로 전환하며 편집기를 숨김(보존, 칩으로 복귀)
        if (typeof setBaseImageForInpaint === 'function') setBaseImageForInpaint('data:image/png;base64,' + b64);
        else toast('인페인트 기능을 찾을 수 없습니다', 'error');
    }

    function actI2i() {
        const b64 = getB64();
        const w = canvas.width, h = canvas.height;
        try {
            baseImageData = { enabled: true, image: b64, mask: null, mode: 'img2img', strength: 0.7, noise: 0, width: w, height: h };
        } catch (e) { toast('i2i 설정 실패: ' + e.message, 'error'); return; }
        if (typeof currentMode !== 'undefined' && currentMode !== 'slot' && currentMode !== 'single' && typeof setActiveView === 'function') {
            setActiveView(typeof genMode !== 'undefined' ? genMode : 'slot');
        }
        if (typeof updateBaseImageUI === 'function') updateBaseImageUI();
        toast('i2i: Base Image 등록됨', 'success');
    }

    function actToMulti() {
        if (typeof addSlot !== 'function' || typeof addImageToSlot !== 'function') { toast('멀티 모드 함수를 찾을 수 없습니다', 'error'); return; }
        const b64 = getB64();
        // 원본 슬롯은 그대로 두고 새 슬롯을 만들어 편집본을 넣는다
        addSlot('편집본');
        const slots = document.querySelectorAll('#slotsContainer .slot');
        const idx = slots.length - 1;
        addImageToSlot(idx, { image_base64: b64, filename: 'edited.png', metadata: currentMetadata || null, seed: (currentSeed != null ? currentSeed : undefined), prompt: (currentMetadata && currentMetadata.prompt) || undefined, save_format: 'png' });
        if (typeof setActiveView === 'function') setActiveView('slot');  // 편집기 숨김(보존), 칩 유지
        toast('멀티 모드에 새 슬롯으로 추가됨', 'success');
    }

    function actToSingle() {
        if (typeof addImageToSingle !== 'function') { toast('싱글 모드 함수를 찾을 수 없습니다', 'error'); return; }
        const b64 = getB64();
        addImageToSingle({ image_base64: b64, filename: 'edited.png', metadata: currentMetadata || null, seed: (currentSeed != null ? currentSeed : undefined), prompt: (currentMetadata && currentMetadata.prompt) || undefined, save_format: 'png' });
        if (typeof setActiveView === 'function') setActiveView('single');
        // 방금 추가한 최신 썸네일을 뷰어로 선택 (사용자가 결과를 바로 보게)
        const strip = document.getElementById('singleStrip');
        if (strip) {
            const t = strip.querySelector('.single-thumb:not(.placeholder)');
            if (t && t._imageData && typeof selectSingleImage === 'function') selectSingleImage(t._imageData, t);
        }
        toast('싱글 모드에 새 이미지로 추가됨', 'success');
    }

    // ---- 뷰 표시 / 세션 (모달이 아니라 setActiveView 로 토글되는 지속 뷰) ----
    function showView() {
        if (typeof setActiveView === 'function') setActiveView('editor');
        else if (modal) modal.style.display = 'flex';
        // 컨테이너가 보여진 뒤 레이아웃 확정 → 맞춤/오버레이 갱신
        requestAnimationFrame(() => { fitToView(); renderOverlay(); });
    }
    // 편집 화면에서 나가되 세션은 유지 (칩으로 복귀 가능)
    function leaveEditor() {
        const gm = (typeof genMode !== 'undefined') ? genMode : 'slot';
        if (typeof setActiveView === 'function') setActiveView(gm);
        else if (modal) modal.style.display = 'none';
    }
    // 세션 폐기 (칩 × ): 작업 보존 안 함
    function discardSession() {
        removeChip();
        history = []; histIndex = -1; crop = null; cropDrag = null; drawing = false;
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        if (baseCanvas) { baseCanvas.width = 1; baseCanvas.height = 1; }
        if (paintCanvas) { paintCanvas.width = 1; paintCanvas.height = 1; }
        if (isEditorActive()) leaveEditor();
    }

    // ---- 임시 편집 칩 (모드바 슬롯/싱글 옆에 확장되며 등장) ----
    function ensureChip() {
        if (document.getElementById('pxeChip')) return;
        // .mode-header 안의 모드바로 스코프 한정 (사이드바의 #modeToggle 버튼과 클래스명 'mode-toggle' 이 겹침)
        const toggle = document.querySelector('.mode-header .mode-toggle');
        if (!toggle) return;
        const genSwitch = toggle.querySelector('.gen-mode-switch');
        const chip = document.createElement('div');
        chip.className = 'pxe-tab';   // 서브바의 .pxe-chip 과 충돌 방지용 고유 클래스
        chip.id = 'pxeChip';
        chip.innerHTML = `
            <button type="button" class="pxe-tab-main" id="pxeChipMain" title="편집 화면으로 돌아가기">${IC.pencil}<span>편집</span></button>
            <button type="button" class="pxe-tab-close" id="pxeChipClose" title="편집 종료 (작업 버림)">&times;</button>`;
        if (genSwitch) genSwitch.insertAdjacentElement('afterend', chip); else toggle.appendChild(chip);
        // 칩 전체(아이콘·텍스트·여백 배경) 클릭 → 편집 복귀. × 만 세션 폐기(전파 차단).
        chip.onclick = showView;
        chip.querySelector('#pxeChipClose').onclick = (e) => { e.stopPropagation(); discardSession(); };
        if (isEditorActive()) chip.classList.add('active');
        requestAnimationFrame(() => chip.classList.add('pxe-tab-in'));  // 자리 확장 애니메이션
    }
    function removeChip() {
        const chip = document.getElementById('pxeChip');
        if (chip) chip.remove();
    }

    // ---- 키보드 (편집 뷰 활성 시에만) ----
    function onKeydown(e) {
        if (!isEditorActive()) return;
        if (e.key === 'Escape') { leaveEditor(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    }

    // ---- 열기 (카드/싱글의 편집 버튼에서 호출) ----
    function open(imageInput, metadata, opts) {
        if (!modal) build();
        currentMetadata = metadata || null;
        currentOpts = opts || {};
        currentSeed = (currentOpts.seed != null) ? currentOpts.seed
            : (currentMetadata && currentMetadata.seed != null ? currentMetadata.seed : null);
        const myToken = ++openToken;
        const src = (typeof imageInput === 'string' && imageInput.startsWith('data:'))
            ? imageInput : 'data:image/png;base64,' + imageInput;
        const img = new Image();
        img.onload = () => {
            if (myToken !== openToken) return;   // 더 최근 open() 이 시작됨 → 오래된 로드 무시
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            baseCanvas.width = w; baseCanvas.height = h;      // (크기 설정이 곧 클리어)
            paintCanvas.width = w; paintCanvas.height = h;    // 새 이미지 → 페인트 레이어 초기화
            baseCtx.drawImage(img, 0, 0);
            renderComposite();
            history = []; histIndex = -1; pushHistory();
            syncOverlaySize();
            zoom = 1; panX = 0; panY = 0;   // 새 이미지 → 화면 맞춤 + 팬 리셋
            selectTool('move');
            updateDims();
            ensureChip();   // 편집 시작 → 모드바에 임시 칩 확장 등장
            showView();     // 편집기 뷰로 전환 (상태는 뷰 전환에도 보존됨)
        };
        img.onerror = () => toast('이미지를 불러오지 못했습니다', 'error');
        img.src = src;
    }

    // ---- 진입점 배선 ----
    function wireSingleButton() {
        const seb = document.getElementById('singleEditBtn');
        if (seb && !seb._pxeWired) {
            seb._pxeWired = true;
            seb.onclick = async () => {
                const d = (typeof currentSingleImageData !== 'undefined') ? currentSingleImageData : null;
                if (!d) { toast('편집할 이미지가 없습니다', 'error'); return; }
                const b64 = (typeof resolveImageBase64 === 'function') ? await resolveImageBase64(d) : (d.image || d.image_base64);
                if (b64) open(b64, d.metadata, { sourceMode: 'single', seed: d.seed });
                else toast('이미지 데이터가 없습니다', 'error');
            };
        }
    }

    function init() {
        if (!modal) build();
        wireSingleButton();
        try { const rc = JSON.parse(localStorage.getItem('pxeRecentColors') || '[]'); if (Array.isArray(rc)) recentColors = rc; } catch (_) {}
        // 지속 뷰이므로 리스너는 1회만 등록하고 isEditorActive() 로 게이팅
        window.addEventListener('resize', onWinResize);
        document.addEventListener('keydown', onKeydown, true);
        // 사이드바 접기/펴기 등으로 캔버스 영역 크기가 바뀌면 즉시 재맞춤 (undo 때까지 지연되던 문제 해결)
        if (typeof ResizeObserver !== 'undefined' && canvasArea) {
            new ResizeObserver(() => { if (isEditorActive()) { fitToView(); renderOverlay(); } }).observe(canvasArea);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // 전역 진입점 (index.html 의 슬롯 카드 편집 버튼에서 호출)
    window.openEditor = open;
})();
