/**
 * NIZAM · Google Picker — one-time grant to import an EXISTING ledger file
 * Implemented by: KIRO Contract 2 / Phase 2.5
 * Depends on: oauth.ts
 *
 * Picking a file grants this app drive.file access to THAT file only —
 * exactly the import model steering requires.
 * https://developers.google.com/workspace/drive/picker/guides/overview
 */
import { getAccessToken } from '@/lib/drive/oauth';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

// --- Minimal Picker type surface -------------------------------------------
interface PickerDoc {
  id?: string;
  name?: string;
  mimeType?: string;
}
interface PickerResponse {
  action?: string;
  docs?: PickerDoc[];
}
interface PickerBuilderLike {
  addView(view: unknown): PickerBuilderLike;
  setOAuthToken(token: string): PickerBuilderLike;
  setDeveloperKey(key: string): PickerBuilderLike;
  setCallback(cb: (response: PickerResponse) => void): PickerBuilderLike;
  setTitle(title: string): PickerBuilderLike;
  build(): { setVisible(visible: boolean): void };
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilderLike;
  DocsView: new (viewId?: unknown) => { setMimeTypes(types: string): unknown };
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
}

declare global {
  interface Window {
    gapi?: { load(api: string, cb: () => void): void };
  }
}

function getPickerNamespace(): PickerNamespace | null {
  const g = (window as unknown as { google?: { picker?: PickerNamespace } }).google;
  return g?.picker ?? null;
}

let pickerLoadPromise: Promise<PickerNamespace> | null = null;

function loadPickerApi(): Promise<PickerNamespace> {
  if (pickerLoadPromise) return pickerLoadPromise;
  pickerLoadPromise = new Promise((resolve, reject) => {
    const finish = () => {
      window.gapi?.load('picker', () => {
        const ns = getPickerNamespace();
        if (ns) resolve(ns);
        else reject(new Error('NIZAM: Picker API loaded but namespace missing'));
      });
    };
    if (window.gapi) {
      finish();
      return;
    }
    const script = document.createElement('script');
    script.src = GAPI_SRC;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error('NIZAM: failed to load Google API script'));
    document.head.appendChild(script);
  });
  return pickerLoadPromise;
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Show the Google Picker for CSV/spreadsheet files.
 * Resolves with the picked file (drive.file grant applied), or null on cancel.
 */
export async function pickLedgerFile(): Promise<PickedFile | null> {
  const token = getAccessToken();
  if (!token) throw new Error('NIZAM: sign in before picking a file');
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
  if (!apiKey) throw new Error('NIZAM: VITE_GOOGLE_API_KEY is not set (.env.local)');

  const picker = await loadPickerApi();
  return new Promise<PickedFile | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setMimeTypes('text/csv,text/plain,application/vnd.google-apps.spreadsheet');
    const dialog = new picker.PickerBuilder()
      .setTitle('NIZAM — pick your master ledger CSV')
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED) {
          const doc = response.docs?.[0];
          resolve(
            doc?.id
              ? { id: doc.id, name: doc.name ?? '', mimeType: doc.mimeType ?? '' }
              : null,
          );
        } else if (response.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    dialog.setVisible(true);
  });
}
