const Tesseract = require("tesseract.js");
const path = require("path");
const fs = require("fs");

let pdfjsLibInstance = null;

/**
 * Dynamically load pdfjs-dist ESM module in Node CJS environment
 */
async function getPdfJs() {
  if (!pdfjsLibInstance) {
    try {
      pdfjsLibInstance = await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch (e) {
      try {
        pdfjsLibInstance = await import("pdfjs-dist/build/pdf.mjs");
      } catch (e2) {
        console.warn("pdfjs-dist dynamic import warning:", e2.message);
      }
    }
  }
  return pdfjsLibInstance;
}

/**
 * Extract images from a scanned PDF buffer using pdfjs-dist
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Buffer[]>}
 */
async function extractImagesFromPdf(pdfBuffer) {
  const images = [];
  try {
    const pdfjsLib = await getPdfJs();
    if (!pdfjsLib) return images;

    const uint8Array = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdfDoc = await loadingTask.promise;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const operatorList = await page.getOperatorList();
      
      const OPS = pdfjsLib.OPS || {};
      const validOps = [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintJpegXObject,
      ].filter(Boolean);

      for (let j = 0; j < operatorList.fnArray.length; j++) {
        const fn = operatorList.fnArray[j];
        if (validOps.includes(fn)) {
          const imageName = operatorList.argsArray[j][0];
          try {
            const img = page.objs.get(imageName);
            if (img && img.data) {
              const buffer = Buffer.from(img.data);
              images.push(buffer);
            }
          } catch (e) {
            // Continuation for image decoding
          }
        }
      }
    }
  } catch (error) {
    console.error("PDF image extraction error:", error.message);
  }
  return images;
}

/**
 * Run OCR on image buffers or PDF file
 * @param {Buffer|string} source - Buffer or filepath
 * @returns {Promise<string>} Full extracted text
 */
async function runOCR(source) {
  let imageBuffers = [];

  if (Buffer.isBuffer(source)) {
    // Check if PDF buffer
    if (source.slice(0, 5).toString() === "%PDF-") {
      imageBuffers = await extractImagesFromPdf(source);
    } else {
      imageBuffers = [source];
    }
  } else if (typeof source === "string" && fs.existsSync(source)) {
    const fileBuffer = fs.readFileSync(source);
    if (source.toLowerCase().endsWith(".pdf")) {
      imageBuffers = await extractImagesFromPdf(fileBuffer);
    } else {
      imageBuffers = [fileBuffer];
    }
  }

  if (!imageBuffers || imageBuffers.length === 0) {
    console.warn("No OCR-processable images extracted from PDF.");
    return "";
  }

  let fullText = "";
  try {
    const worker = await Tesseract.createWorker("eng");

    for (let idx = 0; idx < imageBuffers.length; idx++) {
      try {
        const result = await worker.recognize(imageBuffers[idx]);
        if (result && result.data && result.data.text) {
          const text = result.data.text.trim();
          if (text) {
            fullText += `--- Page ${idx + 1} (OCR) ---\n${text}\n\n`;
          }
        }
      } catch (pageErr) {
        console.warn(`OCR error on page image ${idx + 1}:`, pageErr.message);
      }
    }

    await worker.terminate();
  } catch (ocrErr) {
    console.error("Tesseract OCR initialization/execution error:", ocrErr.message);
  }

  return fullText.trim();
}

module.exports = {
  runOCR,
  extractImagesFromPdf,
};
