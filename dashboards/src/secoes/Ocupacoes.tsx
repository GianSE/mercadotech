import Pesquisa from "./Pesquisa";

// Pergunta 1c: o crescimento por ocupação (CBO) e por atividade da empresa
// (CNAE), com o drill down do total de TI até o cargo. Usa os mesmos menus e
// a mesma hierarquia da página do recorte.
export default function Ocupacoes() {
  return <Pesquisa parte="ocupacoes" />;
}
