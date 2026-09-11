let video, canvas, ctx, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

async function onOpenCvReady() {
    isOpenCvReady = true;
    document.getElementById('statusText').innerText = "系統就緒";
    startCamera();
}

async function startCamera() {
    video = document.getElementById('video');
    overlay = document.getElementById('overlay');
    oCtx = overlay.getContext('2d');

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        video.srcObject = stream;

        // 設定疊加層大小
        video.onloadedmetadata = () => {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
            requestAnimationFrame(processVideoFrame);
        };
    } catch (err) {
        alert("無法啟動相機: " + err.message);
    }
}

/**
 * 即時偵測迴圈：畫出藍色方框
 */
function processVideoFrame() {
    if (!isOpenCvReady || video.paused || video.ended) {
        requestAnimationFrame(processVideoFrame);
        return;
    }

    // 將影片畫到隱藏的處理畫布
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = overlay.width;
    tempCanvas.height = overlay.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(video, 0, 0);

    let src = cv.imread(tempCanvas);
    let dst = new cv.Mat();

    // 預處理：轉灰階 -> 模糊 -> 邊緣偵測
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(dst, dst, new cv.Size(5, 5), 0);
    cv.Canny(dst, dst, 75, 200);

    // 尋找輪廓
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(dst, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let bestPoly = null;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area > 50000) { // 面積夠大才算
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                bestPoly = approx;
            } else {
                approx.delete();
            }
        }
    }

    // 在疊加層畫出藍色框框
    oCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (bestPoly) {
        oCtx.strokeStyle = "#0071e3";
        oCtx.lineWidth = 8;
        oCtx.beginPath();
        let p1 = {x: bestPoly.data32S[0], y: bestPoly.data32S[1]};
        oCtx.moveTo(p1.x, p1.y);
        for (let i = 1; i < 4; i++) {
            oCtx.lineTo(bestPoly.data32S[i*2], bestPoly.data32S[i*2+1]);
        }
        oCtx.closePath();
        oCtx.stroke();
        bestPoly.delete();
    }

    src.delete(); dst.delete(); contours.delete(); hierarchy.delete();
    requestAnimationFrame(processVideoFrame);
}

// 拍照按鈕點擊
document.getElementById('btnCapture').addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // 去陰影處理 (使用我們先前的 Adaptive Threshold 邏輯)
    let src = cv.imread(canvas);
    let dst = new cv.Mat();
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 10);

    cv.imshow(canvas, dst);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    capturedPages.push(dataUrl);
    updatePreview(dataUrl);

    src.delete(); dst.delete();
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
    torchOn = !torchOn;
    try {
        await track.applyConstraints({
            advanced: [{ torch: torchOn }]
        });
        document.getElementById('btnTorch').style.color = torchOn ? "#ffcc00" : "white";
    } catch (e) {
        console.log("此設備不支援手電筒");
    }
});

// 完成掃描
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
    document.getElementById('resultPanel').style.display = 'block';
});

// 匯出 PDF
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
