// Baixar o que está na tela: o gráfico em PNG e a tabela em CSV, para colar
// em slide, relatório ou planilha.
import type { Linha } from "./db";

type Coluna = { chave: string; rotulo: string; formato?: (v: unknown) => string; numero?: boolean };

export const nomeArquivo = (titulo: string) =>
  titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "grafico";

function baixar(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function baixarImagem(dataUrl: string, titulo: string) {
  baixar(dataUrl, `${nomeArquivo(titulo)}.png`);
}

// CSV no padrão do Excel em português: ponto e vírgula, vírgula decimal e
// BOM, para os acentos abrirem certos. Números saem crus (sem milhar nem
// "SM"), para a planilha poder somar; texto sai como aparece na tela.
export function baixarCsv(colunas: Coluna[], linhas: Linha[], titulo: string) {
  const celula = (c: Coluna, v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = c.numero && typeof v === "number" ? String(v).replace(".", ",") : c.formato && !c.numero ? c.formato(v) : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [colunas.map((c) => celula({ ...c, numero: false, formato: undefined }, c.rotulo)).join(";"), ...linhas.map((l) => colunas.map((c) => celula(c, l[c.chave])).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + corpo], { type: "text/csv;charset=utf-8" }));
  baixar(url, `${nomeArquivo(titulo)}.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
