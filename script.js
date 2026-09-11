let processedImages = [];
let isOpenCvReady = false;

function onOpenCvReady() {
    isOpenCvReady = true;
    document.getElementById('status').innerText = "系統已就緒，請上傳圖片";
    document.getElementById('status').style.color = "#28a745";
}

document.getElementById('imageInput').addEventListener('change', async (e) => {
    if (!isOpenCvReady) {
        alert("系統還在載入，請稍候...");
        return;
    }

    const files = e.target.files;
    const previewContainer = document.getElementById('previewContainer');
    previewContainer.innerHTML = "";
    processedImages = [];

    document.getElementById('status').innerText = "處理中...";

    for (let file of files) {
        const img = await loadImage(file);
        const processedDataUrl = processImage(img);

        processedImages.push(processedDataUrl);

        const item = document.createElement('div');
        item.className = 'preview-item';
        const previewImg = document.createElement('img');
        previewImg.src = processedDataUrl;
        item.appendChild(previewImg);
        previewContainer.appendChild(item);
    }

    document.getElementById('status').innerText = `處理完成，共 ${processedImages.length} 頁`;
    document.querySelector('.controls').style.display = 'block';
});

function loadImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * 核心影像處理功能：去陰影與增強
 */
function processImage(imgElement) {
    const canvas = document.getElementById('canvasOutput');
    const ctx = canvas.getContext('2d');
    canvas.width = imgElement.width;
    canvas.height = imgElement.height;

    // 使用 OpenCV 進行去陰影處理
    let src = cv.imread(imgElement);
    let dst = new cv.Mat();

    // 1. 轉為灰階
    cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

    // 2. 自適應二值化 (這是去陰影的最強大演算法)
    // 它會根據周圍像素的亮度來決定該點是黑還是白，從而消除大面積的陰影
    cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 10);

    cv.imshow('canvasOutput', dst);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    src.delete();
    dst.delete();

    return dataUrl;
}

// 匯出 PDF
document.getElementById('downloadPdf').addEventListener('click', () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    processedImages.forEach((dataUrl, index) => {
        if (index > 0) doc.addPage();

        // 取得圖片寬高以適應 PDF 頁面
        const imgProps = doc.getImageProperties(dataUrl);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        doc.addImage(dataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    });

    doc.save("Scan_Result.pdf");
});

// 下載單張圖片
document.getElementById('downloadImages').addEventListener('click', () => {
    processedImages.forEach((dataUrl, index) => {
        const link = document.createElement('a');
        link.download = `Scan_Page_${index + 1}.jpg`;
        link.href = dataUrl;
        link.click();
    });
});
