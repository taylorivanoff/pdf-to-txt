#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  collectPdfs,
  convertPdfToTxt,
  defaultOutPath,
  extractPdf,
} from './extract.js';

function parseArgs(argv) {
  const args = {
    inputs: [],
    out: null,
    stdout: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '--out' || a === '-o') {
      args.out = argv[++i];
      if (!args.out) throw new Error('--out requires a path');
    } else if (a === '--stdout') {
      args.stdout = true;
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      args.inputs.push(a);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node src/cli.js <pdf|dir> [more...] [options]

Extract text from PDF files into .txt.

Options:
  -o, --out <path>   Output .txt file (single PDF) or directory
                     (default: ./output)
  --stdout           Print extracted text to stdout (single PDF only)
  -h, --help         Show help

Examples:
  node src/cli.js ./input
  node src/cli.js report.pdf
  node src/cli.js report.pdf -o report.txt
  node src/cli.js ./pdfs --out ./txt
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.inputs.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const pdfs = [];
  for (const input of args.inputs) {
    const found = await collectPdfs(input);
    pdfs.push(...found);
  }

  if (pdfs.length === 0) {
    console.error('No PDF files found.');
    process.exit(1);
  }

  if (args.stdout) {
    if (pdfs.length !== 1) {
      console.error('--stdout requires exactly one PDF.');
      process.exit(1);
    }
    const { text } = await extractPdf(pdfs[0]);
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
    return;
  }

  const out = args.out || 'output';
  const treatOutAsDir =
    pdfs.length > 1 || !out.toLowerCase().endsWith('.txt');

  for (const pdfPath of pdfs) {
    const outPath = treatOutAsDir
      ? defaultOutPath(pdfPath, out)
      : path.resolve(out);

    const result = await convertPdfToTxt(pdfPath, outPath);
    console.log(
      `${path.basename(result.pdfPath)} → ${result.outPath} (${result.pages} pages, ${result.bytes} bytes)`,
    );
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}
