#!/usr/bin/env node
/**
 * JSON-lines sidecar for PDF preview/convert. Uses src/extract.js (unpdf).
 * Protocol (stdin → stdout, one JSON object per line):
 *   { "op": "preview", "pdfPath": "..." }
 *   { "op": "convert", "pdfPath": "...", "outPath": "..." }
 */
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { convertPdfToTxt, extractPdf } from '../src/extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function reply(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handle(msg) {
  const op = msg?.op;
  if (op === 'preview') {
    const pdfPath = String(msg.pdfPath || '');
    if (!pdfPath) return { ok: false, error: 'Missing pdfPath' };
    const result = await extractPdf(pdfPath);
    return { ok: true, ...result };
  }
  if (op === 'convert') {
    const pdfPath = String(msg.pdfPath || '');
    const outPath = String(msg.outPath || '');
    if (!pdfPath || !outPath) return { ok: false, error: 'Missing pdfPath or outPath' };
    const converted = await convertPdfToTxt(pdfPath, outPath);
    return { ok: true, ...converted };
  }
  return { ok: false, error: `Unknown op: ${op}` };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const trimmed = String(line || '').trim();
  if (!trimmed) continue;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    reply({ ok: false, error: `Invalid JSON: ${err?.message || String(err)}` });
    continue;
  }
  try {
    reply(await handle(msg));
  } catch (err) {
    reply({
      ok: false,
      pdfPath: msg?.pdfPath,
      outPath: msg?.outPath,
      error: err?.message || String(err),
    });
  }
}

// Keep a reference so bundlers don't drop __dirname in some setups.
void __dirname;
