let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;

// OpenCV 全域變數
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

            resizeOverlay();
            window.addEventListener('resize', resizeOverlay);

            // 開始偵測迴圈
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
    if (!isOpenCvReady || !video || video.paused || video.ended) {
        requestAnimationFrame(processVideoFrame);
        return;
    }

    try {
        // 直接從影片讀取畫面到 OpenCV
        const cap = new cv.VideoCapture(video);
        cap.read(src);

        // 影像處理
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        cv.Canny(blurred, edges, 75, 200);

        // 尋找輪廓
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        let maxArea = 0;
        let bestPoly = null;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            // 只要面積佔畫面 5% 以上就列入考慮，降低門檻
            if (area > (video.videoWidth * video.videoHeight * 0.05)) {
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

        // 繪製藍色框框
        oCtx.clearRect(0, 0, overlay.width, overlay.height);
        if (bestPoly) {
            const scaleX = overlay.width / video.videoWidth;
            const scaleY = overlay.height / video.videoHeight;

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 6;
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

            // 畫四個角點
            oCtx.fillStyle = "white";
            for (let i = 0; i < 4; i++) {
                let x = bestPoly.data32S[i * 2] * scaleX;
                let y = bestPoly.data32S[i * 2 + 1] * scaleY;
                oCtx.beginPath();
                oCtx.arc(x, y, 8, 0, Math.PI * 2);
                oCtx.fill();
            }
            bestPoly.delete();
        }
    } catch (e) {
        console.error("OpenCV Frame Error:", e);
    }

    requestAnimationFrame(processVideoFrame);
}

// 拍照與去陰影功能
function processAndSaveImage(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth || source.width;
    canvas.height = source.videoHeight || source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);

    let snapSrc = cv.imread(canvas);
    let snapDst = new cv.Mat();
    cv.cvtColor(snapSrc, snapDst, cv.COLOR_RGBA2GRAY);
    // 去陰影核心：自適應二值化
    cv.adaptiveThreshold(snapDst, snapDst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);

    cv.imshow(canvas, snapDst);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    capturedPages.push(dataUrl);
    updatePreview(dataUrl);

    snapSrc.delete();
    snapDst.delete();

    if (window.navigator.vibrate) window.navigator.vibrate(50);
}

document.getElementById('btnCapture').addEventListener('click', () => processAndSaveImage(video));

// 圖片預覽縮圖按鈕 (左下角)
document.getElementById('miniPreview').addEventListener('click', () => {
    if (capturedPages.length > 0) showResultPanel();
});

// 相簿選取按鈕 (右上角)
document.getElementById('btnGallery').addEventListener('click', () => {
    document.getElementById('galleryInput').click();
});

document.getElementById('galleryInput').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    document.getElementById('statusText').innerText = "匯入處理中...";
    for (let file of files) {
        const img = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
        processAndSaveImage(img);
    }
    document.getElementById('statusText').innerText = "匯入完成";
});

function updatePreview(dataUrl) {
    const thumb = document.getElementById('lastScanThumb');
    const badge = document.getElementById('pageCountBadge');
    thumb.src = dataUrl;
    thumb.style.display = 'block';
    badge.innerText = capturedPages.length;
    badge.style.display = 'flex';
}

function showResultPanel() {
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

document.getElementById('btnDone').addEventListener('click', showResultPanel);

// 手電筒開關
document.getElementById('btnTorch').addEventListener('click', async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            torchOn = !torchOn;
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            document.getElementById('btnTorch').style.color = torchOn ? "#ffcc00" : "white";
        } else {
            alert("此設備不支援手電筒");
        }
    } catch (e) { console.log(e); }
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
