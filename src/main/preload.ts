/**
 * Preload script.
 *
 * Runs in an isolated world before the renderer loads. Exposes a small
 * typed surface on `window.helm` that calls `ipcRenderer.invoke`/`on`
 * under the hood. The renderer never imports anything Electron-specific.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcRequest, IpcEvent } from '../shared/ipc-contract';

const helm = {
  invoke<K extends keyof IpcRequest>(channel: K, payload?: IpcRequest[K]['req']): Promise<IpcRequest[K]['res']> {
    return ipcRenderer.invoke(channel, payload);
  },
  on<K extends keyof IpcEvent>(channel: K, listener: (payload: IpcEvent[K]) => void): () => void {
    const wrapped = (_e: IpcRendererEvent, payload: IpcEvent[K]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('helm', helm);

declare global {
  interface Window {
    helm: typeof helm;
  }
}
