let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV 資源
let src, gray, blurred, edges, contours, hierarchy;
let processCanvas;

async function onOpenCvReady() {
    isOpenCvReady = true;
    document.getElementById('statusText').innerText = "掃描引擎已就緒";
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
            // 初始化畫布大小
            overlay.width = window.innerWidth;
            overlay.height = window.innerHeight;

            // 初始化 OpenCV 矩陣 (使用較小尺寸以提升速度)
            src = new cv.Mat(300, 300 * (video.videoWidth / video.videoHeight), cv.CV_8UC4);
            gray = new cv.Mat();
            blurred = new cv.Mat();
            edges = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();

            requestAnimationFrame(detectionLoop);
        };
    } catch (err) {
        document.getElementById('statusText').innerText = "無法存取相機";
    }
}

function detectionLoop() {
    if (!isOpenCvReady || !video || video.paused || video.ended) {
        requestAnimationFrame(detectionLoop);
        return;
    }

    try {
        // 1. 將影片縮小並讀入 OpenCV
        processCanvas.width = src.cols;
        processCanvas.height = src.rows;
        const pCtx = processCanvas.getContext('2d');
        pCtx.drawImage(video, 0, 0, src.cols, src.rows);
        src.data.set(pCtx.getImageData(0, 0, src.cols, src.rows).data);

        // 2. 邊緣偵測邏輯
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.Canny(blurred, edges, 75, 200);

        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(edges, edges, M);
        M.delete();

        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestPoly = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > (src.cols * src.rows * 0.05)) {
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

        // 3. 繪製藍色框框 (座標轉換)
        oCtx.clearRect(0, 0, overlay.width, overlay.height);

        if (bestPoly) {
            // 計算 object-fit: cover 下的對齊
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

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 6;
            oCtx.shadowBlur = 15;
            oCtx.shadowColor = "#0071e3";
            oCtx.beginPath();

            for (let i = 0; i < 4; i++) {
                let x = bestPoly.data32S[i * 2] * scaleX + offX;
                let y = bestPoly.data32S[i * 2 + 1] * scaleY + offY;
                if (i === 0) oCtx.moveTo(x, y);
                else oCtx.lineTo(x, y);
            }
            oCtx.closePath();
            oCtx.stroke();

            bestPoly.delete();
            document.getElementById('statusText').innerText = "已偵測到講義";
        } else {
            document.getElementById('statusText').innerText = "請對準講義";
        }
    } catch (e) {
        // 忽略 OpenCV 初始化的錯誤
    }

    requestAnimationFrame(detectionLoop);
}

// 拍照處理
function captureImage(source) {
    // 拍照閃光效果
    const flash = document.createElement('div');
    flash.style.position = 'fixed';
    flash.style.top = '0'; flash.style.left = '0';
    flash.style.width = '100%'; flash.style.height = '100%';
    flash.style.backgroundColor = 'white'; flash.style.zIndex = '9999';
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

    // 更新縮圖
    const thumb = document.getElementById('lastScanThumb');
    thumb.src = dataUrl;
    thumb.style.display = 'block';
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
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = e.target.result;
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
