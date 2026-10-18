export const formatWhen = (iso: string | null | undefined): string =>
  iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export type Notify = (m: string, t?: 'success' | 'error' | 'info') => void;
