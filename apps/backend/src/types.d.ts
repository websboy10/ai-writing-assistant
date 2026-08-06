declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  interface PdfPage {
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: { canvasContext: never; viewport: unknown }): { promise: Promise<void> };
    cleanup(): void;
  }
  interface PdfDocument {
    numPages: number;
    getPage(n: number): Promise<PdfPage>;
  }
  export function getDocument(opts: {
    data: Uint8Array;
    cMapUrl?: string;
    cMapPacked?: boolean;
    standardFontDataUrl?: string;
  }): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
}
