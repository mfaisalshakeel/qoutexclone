import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'success' | 'error' | 'info';
  ttl?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(toast) {
    const id = nextId++;
    set({ toasts: [...get().toasts, { ...toast, id }] });
    window.setTimeout(() => get().dismiss(id), toast.ttl ?? 5000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  success: (title: string, body?: string) => useToasts.getState().push({ title, body, tone: 'success' }),
  error: (title: string, body?: string) => useToasts.getState().push({ title, body, tone: 'error' }),
  info: (title: string, body?: string) => useToasts.getState().push({ title, body, tone: 'info' }),
};
