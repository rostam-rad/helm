/**
 * Renderer-side ambient typing for the IPC bridge exposed by the
 * preload script. The preload itself lives in src/main/, so we mirror
 * the shape here rather than importing across the process boundary.
 */
import type { IpcRequest, IpcEvent } from '@shared/ipc-contract';

declare global {
  interface Window {
    helm: {
      invoke<K extends keyof IpcRequest>(channel: K, payload?: IpcRequest[K]['req']): Promise<IpcRequest[K]['res']>;
      on<K extends keyof IpcEvent>(channel: K, listener: (payload: IpcEvent[K]) => void): () => void;
    };
  }
}

export {};
