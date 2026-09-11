let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV resources
let src, gray, blurred, thresh, contours, hierarchy;
let processCanvas;

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

            // Smaller matrix for faster processing
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

        // Use thresholding to find the paper (usually bright)
        cv.threshold(blurred, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

        // Morphological operations to close gaps
        let M = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, M);
        M.delete();

        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestContour = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > (src.cols * src.rows * 0.1) && area > maxArea) {
                maxArea = area;
                bestContour = cnt;
            }
        }

        oCtx.clearRect(0, 0, overlay.width, overlay.height);

        if (bestContour) {
            // Mapping coordinates back to screen
            const videoRatio = video.videoWidth / video.videoHeight;
            const screenRatio = window.innerWidth / window.innerHeight;

            let drawW, drawH, offX = 0, offY = 0;
            if (screenRatio > videoRatio) {
                drawW = window.innerWidth;
                drawH = window.innerWidth / videoRatio;
                offY = (window.innerHeight - drawH) / 2;
            } else {
                drawH = window.innerHeight;
                drawW = window.innerHeight * videoRatio;
                offX = (window.innerWidth - drawW) / 2;
            }

            const scaleX = drawW / src.cols;
            const scaleY = drawH / src.rows;

            // Simplify contour for cleaner box
            let peri = cv.arcLength(bestContour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(bestContour, approx, 0.02 * peri, true);

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 6;
            oCtx.lineJoin = "round";
            oCtx.beginPath();

            for (let i = 0; i < approx.rows; i++) {
                let x = approx.data32S[i * 2] * scaleX + offX;
                let y = approx.data32S[i * 2 + 1] * scaleY + offY;
                if (i === 0) oCtx.moveTo(x, y);
                else oCtx.lineTo(x, y);
            }
            oCtx.closePath();
            oCtx.stroke();

            // Draw points
            oCtx.fillStyle = "white";
            for (let i = 0; i < approx.rows; i++) {
                let x = approx.data32S[i * 2] * scaleX + offX;
                let y = approx.data32S[i * 2 + 1] * scaleY + offY;
                oCtx.beginPath();
                oCtx.arc(x, y, 6, 0, Math.PI * 2);
                oCtx.fill();
            }

            approx.delete();
            document.getElementById('statusText').innerText = "已鎖定範圍";
            document.getElementById('statusText').style.color = "#00ff00";
        } else {
            document.getElementById('statusText').innerText = "正在搜尋講義...";
            document.getElementById('statusText').style.color = "white";
        }
    } catch (e) {
        // Silent error
    }

    requestAnimationFrame(detectionLoop);
}

function captureImage(source) {
    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:9999;";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 100);

    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth || source.width;
    canvas.height = source.videoHeight || source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);

    let snapSrc = cv.imread(canvas);
    let snapDst = new cv.Mat();
    cv.cvtColor(snapSrc, snapDst, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(snapDst, snapDst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);

    cv.imshow(canvas, snapDst);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    capturedPages.push(dataUrl);

    document.getElementById('lastScanThumb').src = dataUrl;
    document.getElementById('lastScanThumb').style.display = 'block';
    document.getElementById('pageCountBadge').innerText = capturedPages.length;
    document.getElementById('pageCountBadge').style.display = 'flex';

    snapSrc.delete(); snapDst.delete();
    if (window.navigator.vibrate) window.navigator.vibrate(50);
}

document.getElementById('btnCapture').addEventListener('click', () => captureImage(video));
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
        captureImage(img);
    }
});

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
    } catch (e) { alert("此設備不支援手電筒"); }
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
