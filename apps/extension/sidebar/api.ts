import type { OneShotRequest, OneShotResponse } from '@/utils/protocol';
import { useStore } from './store';

/** All backend traffic goes through the background worker (extension origin). */
export async function call(msg: OneShotRequest): Promise<OneShotResponse> {
  const res: OneShotResponse = await chrome.runtime.sendMessage(msg).catch((err) => ({
    ok: false,
    status: 0,
    error: err instanceof Error ? err.message : 'Extension messaging failed',
  }));
  // Session death must land the user back on the sign-in form, not in a chat
  // view where every action fails (WR-08). Only authed calls — a wrong
  // password on login is also a 401 and must not be relabelled.
  if (!res.ok && res.status === 401 && (msg.kind === 'api' || msg.kind === 'upload')) {
    useStore.getState().set({ email: null, view: 'auth', error: 'Your session expired — sign in again.' });
  }
  return res;
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
