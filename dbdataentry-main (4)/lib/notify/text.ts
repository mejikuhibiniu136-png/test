// Utilitas teks untuk adapter: memotong sesuai batas platform dan menetralkan konten dari pengguna.
export const truncate = (s: string, max: number): string => {
  const t = s.replace(/\u0000/g, '');
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
};

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Nilai field berasal dari pengguna (username, User-Agent): hilangkan backtick dan karakter kontrol.
export const inlineCode = (s: string, max: number): string => `\`${truncate(s.replace(/[`\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() || '-', max)}\``;

export const redact = (text: string, secrets: string[]): string => secrets.filter((x) => x.length >= 6).reduce((t, x) => t.split(x).join('[redacted]'), text);
