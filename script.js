let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV 資源
let src, gray, blurred, thresh, contours, hierarchy;
let processCanvas;
let currentPoints = null; // 儲存當前偵測到的四個點

async function onOpenCvReady() {
    isOpenCvReady = true;
    document.getElementById('statusText').innerText = "掃描引擎就緒";
    startCamera();
}

async function startCamera() {
    video = document.getElementById('video');
    overlay = document.getElementById('overlay');
    oCtx = overlay.getContext('2d');
    processCanvas = document.createElement('canvas');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            overlay.width = window.innerWidth;
            overlay.height = window.innerHeight;
            src = new cv.Mat(300, 400, cv.CV_8UC4);
            gray = new cv.Mat();
            blurred = new cv.Mat();
            thresh = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            requestAnimationFrame(detectionLoop);
        };
    } catch (err) {
        document.getElementById('statusText').innerText = "相機啟動失敗";
    }
}

function detectionLoop() {
    if (!isOpenCvReady || !video || video.readyState < 2 || video.paused || video.ended) {
        requestAnimationFrame(detectionLoop);
        return;
    }

    try {
        processCanvas.width = src.cols;
        processCanvas.height = src.rows;
        const pCtx = processCanvas.getContext('2d');
        pCtx.drawImage(video, 0, 0, src.cols, src.rows);
        src.data.set(pCtx.getImageData(0, 0, src.cols, src.rows).data);

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.threshold(blurred, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

        let M = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, M);
        M.delete();

        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestApprox = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > (src.cols * src.rows * 0.1)) {
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                // 強制尋找四邊形：如果頂點接近 4 個，或者我們取它的凸包簡化為 4 個點
                if (approx.rows >= 4 && area > maxArea) {
                    maxArea = area;
                    if (bestApprox) bestApprox.delete();
                    bestApprox = approx;
                } else {
                    approx.delete();
                }
            }
        }

        oCtx.clearRect(0, 0, overlay.width, overlay.height);
        currentPoints = null;

        if (bestApprox) {
            const videoRatio = video.videoWidth / video.videoHeight;
            const screenRatio = window.innerWidth / window.innerHeight;
            let drawW, drawH, offX = 0, offY = 0;
            if (screenRatio > videoRatio) {
                drawW = window.innerWidth; drawH = window.innerWidth / videoRatio;
                offY = (window.innerHeight - drawH) / 2;
            } else {
                drawH = window.innerHeight; drawW = window.innerHeight * videoRatio;
                offX = (window.innerWidth - drawW) / 2;
            }

            const scaleX = drawW / src.cols;
            const scaleY = drawH / src.rows;

            // 只取前四個點來維持四邊形
            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 5;
            oCtx.beginPath();

            let pts = [];
            for (let i = 0; i < 4; i++) {
                let x = bestApprox.data32S[i * 2] * scaleX + offX;
                let y = bestApprox.data32S[i * 2 + 1] * scaleY + offY;
                pts.push({x: bestApprox.data32S[i * 2], y: bestApprox.data32S[i * 2 + 1]});
                if (i === 0) oCtx.moveTo(x, y);
                else oCtx.lineTo(x, y);
            }
            oCtx.closePath();
            oCtx.stroke();
            currentPoints = pts;

            bestApprox.delete();
            document.getElementById('statusText').innerText = "已鎖定講義";
        } else {
            document.getElementById('statusText').innerText = "正在搜尋講義...";
        }
    } catch (e) {}
    requestAnimationFrame(detectionLoop);
}

/**
 * 拍照並實作「透視裁切」
 */
function captureImage() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    let finalCanvas = document.createElement('canvas');
    let srcMat = cv.imread(canvas);
    let dstMat = new cv.Mat();

    if (currentPoints && currentPoints.length === 4) {
        // 1. 準備來源頂點 (需要對應回原始影片解析度)
        const scaleX = video.videoWidth / 400; // 偵測時使用的寬度是 400
        const scaleY = video.videoHeight / 300; // 偵測時使用的高度是 300

        let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            currentPoints[0].x * scaleX, currentPoints[0].y * scaleY,
            currentPoints[1].x * scaleX, currentPoints[1].y * scaleY,
            currentPoints[2].x * scaleX, currentPoints[2].y * scaleY,
            currentPoints[3].x * scaleX, currentPoints[3].y * scaleY
        ]);

        // 2. 準備目標頂點 (拉正後的長方形)
        const w = 800; const h = 1100; // 模擬 A4 比例
        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);

        // 3. 執行透視變換 (Warp Perspective)
        let M = cv.getPerspectiveTransform(srcPts, dstPts);
        cv.warpPerspective(srcMat, dstMat, M, new cv.Size(w, h));

        finalCanvas.width = w;
        finalCanvas.height = h;
        cv.imshow(finalCanvas, dstMat);

        srcPts.delete(); dstPts.delete(); M.delete();
    } else {
        // 如果沒偵測到，就直接用原圖
        finalCanvas.width = canvas.width;
        finalCanvas.height = canvas.height;
        finalCanvas.getContext('2d').drawImage(canvas, 0, 0);
        cv.cvtColor(srcMat, dstMat, cv.COLOR_RGBA2GRAY);
    }

    // 4. 最後進行去陰影濾鏡
    let grayMat = new cv.Mat();
    if (dstMat.channels() > 1) cv.cvtColor(dstMat, grayMat, cv.COLOR_RGBA2GRAY);
    else grayMat = dstMat.clone();

    cv.adaptiveThreshold(grayMat, grayMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);
    cv.imshow(finalCanvas, grayMat);

    const dataUrl = finalCanvas.toDataURL('image/jpeg', 0.8);
    capturedPages.push(dataUrl);
    updatePreview(dataUrl);

    srcMat.delete(); dstMat.delete(); grayMat.delete();
    if (window.navigator.vibrate) window.navigator.vibrate(50);
}

document.getElementById('btnCapture').addEventListener('click', captureImage);
document.getElementById('btnGallery').addEventListener('click', () => document.getElementById('galleryInput').click());
document.getElementById('galleryInput').addEventListener('change', async (e) => {
    for (let file of e.target.files) {
        const img = await new Promise(res => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
        // 對相簿圖片也進行去陰影，但不做裁切（因為沒有藍框數據）
        captureImageFromElement(img);
    }
});

function captureImageFromElement(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    let srcMat = cv.imread(canvas);
    let grayMat = new cv.Mat();
    cv.cvtColor(srcMat, grayMat, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(grayMat, grayMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);
    cv.imshow(canvas, grayMat);
    capturedPages.push(canvas.toDataURL('image/jpeg', 0.8));
    updatePreview(capturedPages[capturedPages.length-1]);
    srcMat.delete(); grayMat.delete();
}

function updatePreview(dataUrl) {
    const thumb = document.getElementById('lastScanThumb');
    thumb.src = dataUrl;
    thumb.style.display = 'block';
    document.getElementById('pageCountBadge').innerText = capturedPages.length;
    document.getElementById('pageCountBadge').style.display = 'flex';
}

function showResults() {
    if (capturedPages.length === 0) return;
    const list = document.getElementById('finalPreviewList');
    list.innerHTML = "";
    capturedPages.forEach(url => {
        const div = document.createElement('div');
        div.className = 'final-item';
        div.innerHTML = `<img src="${url}">`;
        list.appendChild(div);
    });
    document.getElementById('resultPanel').style.display = 'flex';
}

document.getElementById('btnDone').addEventListener('click', showResults);
document.getElementById('miniPreview').addEventListener('click', showResults);

document.getElementById('btnTorch').addEventListener('click', async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
        torchOn = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        document.getElementById('btnTorch').style.color = torchOn ? "#ffcc00" : "white";
    } catch (e) {}
});

document.getElementById('exportPdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    capturedPages.forEach((url, i) => {
        if (i > 0) doc.addPage();
        const imgProps = doc.getImageProperties(url);
        const pdfW = doc.internal.pageSize.getWidth();
        const pdfH = (imgProps.height * pdfW) / imgProps.width;
        doc.addImage(url, 'JPEG', 0, 0, pdfW, pdfH);
    });
    doc.save("Scan_Assignment.pdf");
});

document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('resultPanel').style.display = 'none';
});

window.addEventListener('resize', () => {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
});
