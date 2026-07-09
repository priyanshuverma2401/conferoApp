const fs = require('fs');
const path = require('path');

// pdf-parse inserts "-- N of M --" page separators into result.text regardless
// of whether a page actually had extractable content — strip those out before
// judging whether a PDF produced any real text.
const PDF_PAGE_MARKER = /--\s*\d+\s*of\s*\d+\s*--/g;
const MIN_MEANINGFUL_CHARS = 30;

// Dispatches by extension to pull plain text out of a resume/bio/reference doc.
// Both pdf-parse and mammoth are pure JS (no native compilation) — deliberately
// avoiding a repeat of the smart-whisper wall we hit earlier on this machine.
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt') {
    return fs.promises.readFile(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const buffer = await fs.promises.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    let text;
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }

    const meaningfulLength = text.replace(PDF_PAGE_MARKER, '').trim().length;
    if (meaningfulLength < MIN_MEANINGFUL_CHARS) {
      throw new Error(
        'No readable text found in this PDF — it looks like a scanned/image-based ' +
        'document rather than one with embedded text. Try a typed document (or export ' +
        'one with a text layer) instead.'
      );
    }
    return text;
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(`Unsupported document type: ${ext}`);
}

module.exports = { extractText };
