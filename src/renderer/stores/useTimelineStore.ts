import { create } from 'zustand';
import type { Message } from '@shared/types';
import { useSessionsStore } from './useSessionsStore';

interface SessionTimeline {
  messages: Message[];
  loading: boolean;
  error: string | null;
  watching: boolean;
}

interface TimelineState {
  bySession: Record<string, SessionTimeline>;
  open: (sessionId: string, isActive: boolean) => Promise<void>;
  close: (sessionId: string) => Promise<void>;
}

let pushSubscribed = false;
const pushTargets = new Set<string>();

export const useTimelineStore = create<TimelineState>((set, get) => {
  function ensurePushSubscription(): void {
    if (pushSubscribed || !window.helm) return;
    pushSubscribed = true;
    window.helm.on('sessions:event', ({ sessionId, message }) => {
      if (!pushTargets.has(sessionId)) return;
      set(state => {
        const prev = state.bySession[sessionId];
        if (!prev) return state;
        return {
          bySession: {
            ...state.bySession,
            [sessionId]: { ...prev, messages: [...prev.messages, message] },
          },
        };
      });
    });
  }

  return {
    bySession: {},

    async open(sessionId, isActive) {
      if (!window.helm) return;
      ensurePushSubscription();

      // Always reset on open so switching sessions doesn't show stale state.
      set(state => ({
        bySession: {
          ...state.bySession,
          [sessionId]: { messages: [], loading: true, error: null, watching: false },
        },
      }));

      try {
        const { messages, meta } = await window.helm.invoke('sessions:get', { id: sessionId });
        // Propagate enriched meta (accurate token/cost/message counts) back
        // to the sessions store so cards and the stats strip show real data.
        useSessionsStore.getState().updateMeta(meta);
        set(state => ({
          bySession: {
            ...state.bySession,
            [sessionId]: { messages, loading: false, error: null, watching: false },
          },
        }));

        if (isActive) {
          await window.helm.invoke('sessions:watch', { id: sessionId });
          pushTargets.add(sessionId);
          set(state => {
            const cur = state.bySession[sessionId];
            if (!cur) return state;
            return {
              bySession: {
                ...state.bySession,
                [sessionId]: { ...cur, watching: true },
              },
            };
          });
        }
      } catch (err) {
        set(state => ({
          bySession: {
            ...state.bySession,
            [sessionId]: { messages: [], loading: false, error: String(err), watching: false },
          },
        }));
      }
    },

    async close(sessionId) {
      pushTargets.delete(sessionId);
      try { await window.helm?.invoke('sessions:unwatch', { id: sessionId }); } catch {}
      set(state => {
        const cur = state.bySession[sessionId];
        if (!cur) return state;
        return {
          bySession: { ...state.bySession, [sessionId]: { ...cur, watching: false } },
        };
      });
    },
  };
});
