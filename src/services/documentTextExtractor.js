const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { runOCR } = require("./ocrService");

let pdfjsLibInstance = null;
async function getPdfJs() {
  if (!pdfjsLibInstance) {
    try {
      pdfjsLibInstance = await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch (e) {
      try {
        pdfjsLibInstance = await import("pdfjs-dist/build/pdf.mjs");
      } catch (e2) {
        console.warn("pdfjs-dist import warning:", e2.message);
      }
    }
  }
  return pdfjsLibInstance;
}

/**
 * Check if the extracted text has sufficient quality/length
 * @param {string} text
 * @returns {boolean}
 */
function isTextSufficient(text) {
  if (!text || typeof text !== "string") return false;
  const cleaned = text.trim();
  if (cleaned.length < 50) return false;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount >= 10;
}

/**
 * Extract text from PDF using pdfjs-dist page text items
 */
async function extractTextWithPdfJs(dataBuffer) {
  try {
    const pdfjsLib = await getPdfJs();
    if (!pdfjsLib) return "";
    const uint8Array = new Uint8Array(dataBuffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array, password: "" });
    const pdfDoc = await loadingTask.promise;
    let fullText = "";

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => item.str)
        .filter(Boolean)
        .join(" ");
      if (pageText.trim()) {
        fullText += pageText.trim() + "\n\n";
      }
    }
    return fullText.trim();
  } catch (err) {
    console.warn("pdfjs-dist text extraction warning:", err.message);
    return "";
  }
}

/**
 * Extract complete text from PDF or DOCX file
 * @param {string} filePath - Absolute path to uploaded document
 * @param {string} originalFilename - Original filename to determine extension if needed
 * @returns {Promise<{ text: string, extractionMethod: string }>}
 */
async function extractTextFromDocument(filePath, originalFilename = "") {
  const ext = path.extname(filePath || originalFilename).toLowerCase();
  let text = "";
  let extractionMethod = "pdf-text";

  if (ext === ".pdf") {
    const dataBuffer = fs.readFileSync(filePath);

    // Layer 1: pdf-parse
    try {
      const pdfData = await pdfParse(dataBuffer, { password: "" });
      if (pdfData && pdfData.text) {
        text = pdfData.text.trim();
      }
    } catch (pdfErr) {
      console.warn("pdf-parse extraction produced error:", pdfErr.message);
      text = "";
    }

    // Layer 2: pdfjs-dist text items if pdf-parse was insufficient
    if (!isTextSufficient(text)) {
      console.log("pdf-parse text insufficient. Trying pdfjs-dist page extraction...");
      const pdfJsText = await extractTextWithPdfJs(dataBuffer);
      if (isTextSufficient(pdfJsText)) {
        text = pdfJsText;
        extractionMethod = "pdf-text";
      }
    }

    // Layer 3: OCR fallback if still insufficient (scanned PDF)
    if (!isTextSufficient(text)) {
      console.log("PDF text is empty/insufficient. Running Tesseract OCR fallback...");
      try {
        const ocrText = await runOCR(filePath);
        if (ocrText && ocrText.trim()) {
          text = ocrText.trim();
          extractionMethod = "pdf-ocr";
        }
      } catch (ocrErr) {
        console.error("OCR fallback failed:", ocrErr.message);
      }
    } else {
      extractionMethod = "pdf-text";
    }
  } else if (ext === ".docx" || ext === ".doc") {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result && result.value ? result.value.trim() : "";
      extractionMethod = "docx-text";
    } catch (docxErr) {
      console.error("Mammoth DOCX text extraction failed:", docxErr.message);
      text = "";
      extractionMethod = "docx-text";
    }
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return {
    text: text || "",
    extractionMethod,
  };
}

module.exports = {
  extractTextFromDocument,
  isTextSufficient,
};
