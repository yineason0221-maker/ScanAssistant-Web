let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV resources
let src, gray, blurred, edges, contours, hierarchy;
let processCanvas;

// Stability Smoothing
let pointsBuffer = [];
const BUFFER_SIZE = 5;
let currentPoints = null;

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
            edges = new cv.Mat();
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

        // 使用 Canny + Dilation，因為它比二值化更能處理各種背景
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.Canny(blurred, edges, 50, 150);
        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(edges, edges, M);
        M.delete();

        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestPoly = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            // 降低面積門檻到 3%，讓你可以在更遠的地方掃描
            if (area > (src.cols * src.rows * 0.03)) {
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                // 不一定非要 4 個點，只要面積夠大，我們稍後會強制取最外圍四角
                if (area > maxArea) {
                    maxArea = area;
                    if (bestPoly) bestPoly.delete();
                    bestPoly = approx;
                } else {
                    approx.delete();
                }
            }
        }

        if (bestPoly) {
            // 從偵測到的輪廓中強制找出最外圍的四個角點
            let rawPts = [];
            for (let i = 0; i < bestPoly.rows; i++) {
                rawPts.push({x: bestApproxX(bestPoly, i), y: bestApproxY(bestPoly, i)});
            }

            // 簡化為 4 個極端點：(x+y最小, x-y最大, x+y最大, x-y最小)
            let sorted = getFourCorners(rawPts);

            pointsBuffer.push(sorted);
            if (pointsBuffer.length > BUFFER_SIZE) pointsBuffer.shift();
            bestPoly.delete();
        }

        oCtx.clearRect(0, 0, overlay.width, overlay.height);

        if (pointsBuffer.length > 0) {
            let avgPoints = [{x:0,y:0}, {x:0,y:0}, {x:0,y:0}, {x:0,y:0}];
            pointsBuffer.forEach(pts => {
                pts.forEach((p, i) => { avgPoints[i].x += p.x; avgPoints[i].y += p.y; });
            });
            avgPoints.forEach(p => { p.x /= pointsBuffer.length; p.y /= pointsBuffer.length; });
            currentPoints = avgPoints;

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

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 6;
            oCtx.beginPath();
            avgPoints.forEach((p, i) => {
                let x = p.x * scaleX + offX;
                let y = p.y * scaleY + offY;
                if (i === 0) oCtx.moveTo(x, y); else oCtx.lineTo(x, y);
            });
            oCtx.closePath();
            oCtx.stroke();

            avgPoints.forEach(p => {
                oCtx.fillStyle = "white";
                oCtx.beginPath(); oCtx.arc(p.x * scaleX + offX, p.y * scaleY + offY, 6, 0, Math.PI*2); oCtx.fill();
            });
            document.getElementById('statusText').innerText = "已偵測講義";
        } else {
            document.getElementById('statusText').innerText = "搜尋中...";
            currentPoints = null;
        }
    } catch (e) {}
    requestAnimationFrame(detectionLoop);
}

function bestApproxX(poly, i) { return poly.data32S[i * 2]; }
function bestApproxY(poly, i) { return poly.data32S[i * 2 + 1]; }

function getFourCorners(pts) {
    // 找出極端點：Top-Left (x+y min), Top-Right (x-y max), Bottom-Right (x+y max), Bottom-Left (x-y min)
    let tl = pts.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b));
    let tr = pts.reduce((a, b) => (a.x - a.y > b.x - b.y ? a : b));
    let br = pts.reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
    let bl = pts.reduce((a, b) => (a.x - a.y < b.x - b.y ? a : b));
    return [tl, tr, br, bl];
}

function captureImage() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    let finalCanvas = document.createElement('canvas');
    let srcMat = cv.imread(canvas);
    let dstMat = new cv.Mat();

    if (currentPoints) {
        // 加入 5% 的 Padding，防止邊緣被裁切掉
        const padding = 20;
        const scaleX = video.videoWidth / 400;
        const scaleY = video.videoHeight / 300;

        let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            currentPoints[0].x * scaleX - padding, currentPoints[0].y * scaleY - padding,
            currentPoints[1].x * scaleX + padding, currentPoints[1].y * scaleY - padding,
            currentPoints[2].x * scaleX + padding, currentPoints[2].y * scaleY + padding,
            currentPoints[3].x * scaleX - padding, currentPoints[3].y * scaleY + padding
        ]);

        const w = 1200; const h = 1600;
        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);

        let M = cv.getPerspectiveTransform(srcPts, dstPts);
        cv.warpPerspective(srcMat, dstMat, M, new cv.Size(w, h));

        finalCanvas.width = w; finalCanvas.height = h;
        cv.imshow(finalCanvas, dstMat);
        srcPts.delete(); dstPts.delete(); M.delete();
    } else {
        finalCanvas.width = canvas.width; finalCanvas.height = canvas.height;
        finalCanvas.getContext('2d').drawImage(canvas, 0, 0);
        dstMat = cv.imread(finalCanvas);
    }

    let grayMat = new cv.Mat();
    if (dstMat.channels() > 1) cv.cvtColor(dstMat, grayMat, cv.COLOR_RGBA2GRAY); else grayMat = dstMat.clone();
    cv.adaptiveThreshold(grayMat, grayMat, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);
    cv.imshow(finalCanvas, grayMat);

    capturedPages.push(finalCanvas.toDataURL('image/jpeg', 0.8));
    updatePreview(capturedPages[capturedPages.length-1]);

    srcMat.delete(); dstMat.delete(); grayMat.delete();
    if (window.navigator.vibrate) window.navigator.vibrate(50);
}

document.getElementById('btnCapture').addEventListener('click', captureImage);
document.getElementById('btnGallery').addEventListener('click', () => document.getElementById('galleryInput').click());

function updatePreview(dataUrl) {
    const thumb = document.getElementById('lastScanThumb');
    thumb.src = dataUrl; thumb.style.display = 'block';
    document.getElementById('pageCountBadge').innerText = capturedPages.length;
    document.getElementById('pageCountBadge').style.display = 'flex';
}

function showResults() {
    if (capturedPages.length === 0) return;
    const list = document.getElementById('finalPreviewList');
    list.innerHTML = "";
    capturedPages.forEach(url => {
        const div = document.createElement('div');
        div.className = 'final-item'; div.innerHTML = `<img src="${url}">`;
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
