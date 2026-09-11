let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV resources
let src, gray, blurred, edges, contours, hierarchy;
let processCanvas;
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

        // Advanced detection: Canny + Dilation
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.Canny(blurred, edges, 75, 200);
        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(edges, edges, M);
        M.delete();

        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestApprox = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > (src.cols * src.rows * 0.05)) {
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                // If it's a quad, or we can simplify it to one
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

            // Sort points: top-left, top-right, bottom-right, bottom-left
            let pts = [];
            for (let i = 0; i < bestApprox.rows; i++) {
                pts.push({x: bestApprox.data32S[i * 2], y: bestApprox.data32S[i * 2 + 1]});
            }
            pts.sort((a, b) => a.y - b.y);
            let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
            let bottom = pts.slice(-2).sort((a, b) => b.x - a.x);
            let sorted = [top[0], top[1], bottom[0], bottom[1]];

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 5;
            oCtx.beginPath();
            sorted.forEach((p, i) => {
                let x = p.x * scaleX + offX;
                let y = p.y * scaleY + offY;
                if (i === 0) oCtx.moveTo(x, y);
                else oCtx.lineTo(x, y);
            });
            oCtx.closePath();
            oCtx.stroke();
            currentPoints = sorted;

            bestApprox.delete();
            document.getElementById('statusText').innerText = "已鎖定講義";
        } else {
            document.getElementById('statusText').innerText = "正在搜尋講義...";
        }
    } catch (e) {}
    requestAnimationFrame(detectionLoop);
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

    if (currentPoints && currentPoints.length >= 4) {
        const scaleX = video.videoWidth / 400;
        const scaleY = video.videoHeight / 300;

        let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            currentPoints[0].x * scaleX, currentPoints[0].y * scaleY,
            currentPoints[1].x * scaleX, currentPoints[1].y * scaleY,
            currentPoints[2].x * scaleX, currentPoints[2].y * scaleY,
            currentPoints[3].x * scaleX, currentPoints[3].y * scaleY
        ]);

        const w = 1200; const h = 1600;
        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);

        let M = cv.getPerspectiveTransform(srcPts, dstPts);
        cv.warpPerspective(srcMat, dstMat, M, new cv.Size(w, h));

        finalCanvas.width = w;
        finalCanvas.height = h;
        cv.imshow(finalCanvas, dstMat);

        srcPts.delete(); dstPts.delete(); M.delete();
    } else {
        // Fallback: take center part if detection fails
        const w = canvas.width;
        const h = canvas.height;
        finalCanvas.width = w * 0.9;
        finalCanvas.height = h * 0.9;
        finalCanvas.getContext('2d').drawImage(canvas, w*0.05, h*0.05, w*0.9, h*0.9, 0, 0, w*0.9, h*0.9);
        dstMat = cv.imread(finalCanvas);
    }

    let grayMat = new cv.Mat();
    if (dstMat.channels() > 1) cv.cvtColor(dstMat, grayMat, cv.COLOR_RGBA2GRAY);
    else grayMat = dstMat.clone();

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
