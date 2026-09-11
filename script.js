let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV 全域變數，避免重複建立導致記憶體洩漏
let src, gray, blurred, edges, contours, hierarchy;

async function onOpenCvReady() {
    isOpenCvReady = true;
    document.getElementById('statusText').innerText = "系統已就緒";
    startCamera();
}

async function startCamera() {
    video = document.getElementById('video');
    overlay = document.getElementById('overlay');
    oCtx = overlay.getContext('2d');

    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            // 初始化 OpenCV 矩陣
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            gray = new cv.Mat();
            blurred = new cv.Mat();
            edges = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();

            // 調整疊加層以匹配影片顯示的大小
            resizeOverlay();
            window.addEventListener('resize', resizeOverlay);

            requestAnimationFrame(processVideoFrame);
        };
    } catch (err) {
        document.getElementById('statusText').innerText = "相機啟動失敗";
        console.error(err);
    }
}

function resizeOverlay() {
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
}

function processVideoFrame() {
    if (!isOpenCvReady || video.paused || video.ended) {
        requestAnimationFrame(processVideoFrame);
        return;
    }

    // 1. 將影片讀入 OpenCV
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(video, 0, 0);
    src.data.set(tCtx.getImageData(0, 0, video.videoWidth, video.videoHeight).data);

    // 2. 影像處理
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 75, 200);

    // 3. 尋找輪廓
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestPoly = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area > (video.videoWidth * video.videoHeight * 0.1)) {
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (bestPoly) bestPoly.delete();
                bestPoly = approx;
            } else {
                approx.delete();
            }
        }
    }

    // 4. 繪製藍色框框 (需要座標轉換)
    oCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (bestPoly) {
        // 計算比例縮放
        const scaleX = overlay.width / video.videoWidth;
        const scaleY = overlay.height / video.videoHeight;

        oCtx.strokeStyle = "#0071e3";
        oCtx.lineWidth = 4;
        oCtx.lineJoin = "round";
        oCtx.beginPath();

        for (let i = 0; i < 4; i++) {
            let x = bestPoly.data32S[i * 2] * scaleX;
            let y = bestPoly.data32S[i * 2 + 1] * scaleY;
            if (i === 0) oCtx.moveTo(x, y);
            else oCtx.lineTo(x, y);
        }
        oCtx.closePath();
        oCtx.stroke();

        // 畫四個角點強化視覺
        oCtx.fillStyle = "white";
        for (let i = 0; i < 4; i++) {
            let x = bestPoly.data32S[i * 2] * scaleX;
            let y = bestPoly.data32S[i * 2 + 1] * scaleY;
            oCtx.beginPath();
            oCtx.arc(x, y, 6, 0, Math.PI * 2);
            oCtx.fill();
        }

        bestPoly.delete();
    }

    requestAnimationFrame(processVideoFrame);
}

// 拍照與去陰影
document.getElementById('btnCapture').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // 執行去陰影濾鏡
    let snapSrc = cv.imread(canvas);
    let snapDst = new cv.Mat();
    cv.cvtColor(snapSrc, snapDst, cv.COLOR_RGBA2GRAY);

    // 自適應二值化 (Block Size 必須是奇數)
    cv.adaptiveThreshold(snapDst, snapDst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);

    cv.imshow(canvas, snapDst);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    capturedPages.push(dataUrl);
    updatePreview(dataUrl);

    snapSrc.delete();
    snapDst.delete();

    // 觸覺回饋 (手機振動)
    if (window.navigator.vibrate) window.navigator.vibrate(50);
});

function updatePreview(dataUrl) {
    const thumb = document.getElementById('lastScanThumb');
    const badge = document.getElementById('pageCountBadge');
    thumb.src = dataUrl;
    thumb.style.display = 'block';
    badge.innerText = capturedPages.length;
    badge.style.display = 'flex';
}

// 手電筒開關
document.getElementById('btnTorch').addEventListener('click', async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities();

    if (capabilities.torch) {
        torchOn = !torchOn;
        try {
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            document.getElementById('btnTorch').style.color = torchOn ? "#ffcc00" : "white";
        } catch (e) { console.error("手電筒控制失敗", e); }
    } else {
        alert("此設備或瀏覽器不支援手電筒");
    }
});

// 完成與匯出
document.getElementById('btnDone').addEventListener('click', () => {
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
});

document.getElementById('exportPdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    capturedPages.forEach((url, i) => {
        if (i > 0) doc.addPage();
        const imgProps = doc.getImageProperties(url);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        doc.addImage(url, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    });
    doc.save("Scan_Assignment.pdf");
});

document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('resultPanel').style.display = 'none';
});
