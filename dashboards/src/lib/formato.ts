const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const n = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

export const fmtNum = (v: unknown) => (n(v) === null ? "—" : inteiro.format(n(v)!));
export const fmtCompacto = (v: unknown) => (n(v) === null ? "—" : compacto.format(n(v)!));
export const fmtReais = (v: unknown) => (n(v) === null ? "—" : reais.format(n(v)!));
export const fmtDec = (v: unknown, casas = 1) =>
  n(v) === null ? "—" : n(v)!.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmtSM = (v: unknown) => (n(v) === null ? "—" : `${fmtDec(v, 2)} SM`);
export const fmtPct = (v: unknown, casas = 1) => (n(v) === null ? "—" : `${fmtDec(v, casas)}%`);
export const fmtSinal = (v: unknown) =>
  n(v) === null ? "—" : `${n(v)! > 0 ? "+" : n(v)! < 0 ? "−" : ""}${inteiro.format(Math.abs(n(v)!))}`;

// Texto de rótulo vai para HTML de tooltip do ECharts: escapa sempre.
export const escapar = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// RAIS grava "Sp-Sao Paulo": vira "Sao Paulo (SP)".
export const fmtMunicipio = (m: unknown) => {
  const s = String(m ?? "");
  const r = s.match(/^([A-Za-z]{2})-(.+)$/);
  return r ? `${r[2]} (${r[1].toUpperCase()})` : s;
};
