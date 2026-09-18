import { create } from 'zustand';

/**
 * Whether the support desk is open.
 *
 * The desk is a floating widget rather than a page, so anything that wants to
 * take a trader to their conversation — a notification about a reply, for
 * instance — needs a way to open it. That is all this holds.
 */
interface SupportState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useSupport = create<SupportState>((set, get) => ({
  open: false,
  setOpen(open) {
    set({ open });
  },
  toggle() {
    set({ open: !get().open });
  },
}));
