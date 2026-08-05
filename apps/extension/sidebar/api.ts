import type { OneShotRequest, OneShotResponse } from '@/utils/protocol';

/** All backend traffic goes through the background worker (extension origin). */
export function call(msg: OneShotRequest): Promise<OneShotResponse> {
  return chrome.runtime.sendMessage(msg).catch((err) => ({
    ok: false,
    status: 0,
    error: err instanceof Error ? err.message : 'Extension messaging failed',
  }));
}

export function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}
