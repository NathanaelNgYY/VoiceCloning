import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Extract the text layer of a PDF File in the browser. Returns empty text for
// PDFs with no text layer (e.g. scanned images); throws on unreadable input.
export async function extractPdfText(file) {
  const name = file?.name || 'document.pdf';
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ').trim();
    if (pageText) parts.push(pageText);
  }
  const text = parts.join('\n\n').trim();
  return { name, text, chars: text.length };
}
