import './polyfill.js';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractText, getDocumentProxy, getResolvedPDFJS } from 'unpdf';

export async function extractPdf(pdfPath) {
  const buffer = await readFile(pdfPath);
  const { VerbosityLevel } = await getResolvedPDFJS();
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    verbosity: VerbosityLevel.ERRORS,
  });
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return {
    text: text ?? '',
    pages: totalPages ?? 0,
  };
}

export async function convertPdfToTxt(pdfPath, outPath) {
  const { text, pages } = await extractPdf(pdfPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, text, 'utf8');
  return { pdfPath, outPath, pages, bytes: Buffer.byteLength(text, 'utf8') };
}

export async function collectPdfs(inputPath) {
  const info = await stat(inputPath);
  if (info.isFile()) {
    if (!inputPath.toLowerCase().endsWith('.pdf')) {
      throw new Error(`Not a PDF: ${inputPath}`);
    }
    return [path.resolve(inputPath)];
  }
  if (!info.isDirectory()) {
    throw new Error(`Not a file or directory: ${inputPath}`);
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf'))
    .map((e) => path.resolve(inputPath, e.name))
    .sort();
}

export function defaultOutPath(pdfPath, outDir) {
  const base = path.basename(pdfPath, path.extname(pdfPath)) + '.txt';
  if (outDir) return path.resolve(outDir, base);
  return path.resolve(path.dirname(pdfPath), base);
}
