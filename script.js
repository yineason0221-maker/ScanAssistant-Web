let video, overlay, oCtx;
let isOpenCvReady = false;
let stream = null;
let capturedPages = [];
let torchOn = false;
let cap = null;

// OpenCV 全域矩陣
let src, gray, blurred, edges, contours, hierarchy;
let srcSmall; // 用於快速偵測的小尺寸矩陣

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
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        video.onloadedmetadata = () => {
            // 初始化 OpenCV 資源
            src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            srcSmall = new cv.Mat(300, 300 * (video.videoWidth / video.videoHeight), cv.CV_8UC4);
            gray = new cv.Mat();
            blurred = new cv.Mat();
            edges = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            cap = new cv.VideoCapture(video);

            resizeOverlay();
            window.addEventListener('resize', resizeOverlay);

            requestAnimationFrame(processVideoFrame);
        };
    } catch (err) {
        document.getElementById('statusText').innerText = "相機啟動失敗";
    }
}

function resizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
}

function processVideoFrame() {
    if (!isOpenCvReady || !video || video.paused || video.ended) {
        requestAnimationFrame(processVideoFrame);
        return;
    }

    try {
        cap.read(src);

        // 為了速度，先將圖片縮小再偵測
        cv.resize(src, srcSmall, new cv.Size(srcSmall.cols, srcSmall.rows));

        cv.cvtColor(srcSmall, gray, cv.COLOR_RGBA2GRAY);
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
            if (area > (srcSmall.cols * srcSmall.rows * 0.05)) {
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

        oCtx.clearRect(0, 0, overlay.width, overlay.height);

        if (bestPoly) {
            // 座標轉換：從 srcSmall 的小尺寸轉回畫面的實際尺寸
            const scaleX = overlay.width / srcSmall.cols;
            const scaleY = overlay.height / srcSmall.rows;

            oCtx.strokeStyle = "#0071e3";
            oCtx.lineWidth = 6;
            oCtx.beginPath();

            for (let i = 0; i < 4; i++) {
                let x = bestPoly.data32S[i * 2] * scaleX;
                let y = bestPoly.data32S[i * 2 + 1] * scaleY;
                if (i === 0) oCtx.moveTo(x, y);
                else oCtx.lineTo(x, y);
            }
            oCtx.closePath();
            oCtx.stroke();

            bestPoly.delete();
            document.getElementById('statusText').innerText = "已鎖定講義";
            document.getElementById('statusText').style.color = "#00ff00";
        } else {
            document.getElementById('statusText').innerText = "正在對準講義...";
            document.getElementById('statusText').style.color = "white";
        }
    } catch (e) {
        console.log("OpenCV Error");
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
    cv.adaptiveThreshold(snapDst, snapDst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 15);

    cv.imshow(canvas, snapDst);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    capturedPages.push(dataUrl);
    updatePreview(dataUrl);

    snapSrc.delete(); snapDst.delete();
    if (window.navigator.vibrate) window.navigator.vibrate(50);
}

document.getElementById('btnCapture').addEventListener('click', () => processAndSaveImage(video));
document.getElementById('miniPreview').addEventListener('click', showResultPanel);
document.getElementById('btnGallery').addEventListener('click', () => document.getElementById('galleryInput').click());
document.getElementById('galleryInput').addEventListener('change', async (e) => {
    for (let file of e.target.files) {
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

document.getElementById('btnTorch').addEventListener('click', async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            torchOn = !torchOn;
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            document.getElementById('btnTorch').style.color = torchOn ? "#ffcc00" : "white";
        }
    } catch (e) { alert("此設備不支援手電筒"); }
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
