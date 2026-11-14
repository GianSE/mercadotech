/*
 * O recorte do TCC: só TI. As páginas vieram do site do mercadobrasil
 * (GianSE/mercadobrasil), que serve várias áreas com o mesmo código, e
 * recebem a área como parâmetro; aqui ela é uma só, fixa.
 *
 * `repo` é a gold do TCC no Hugging Face. Ela tem uma área só, então as
 * tabelas ficam na raiz do repositório (sem a pasta gold-<área>/).
 */
export type Area = {
  slug: string;
  nome: string;
  sigla: string;
  resumo: string;
  /** a gold: "usuário/repositório" (raiz) ou "usuário/repositório/pasta" */
  repo: string;
  subareas: string[];
  /** família CBO (4 dígitos) -> nome */
  familias: Record<string, string>;
  /** código CBO avulso (6 dígitos) -> nome */
  avulsos: Record<string, string>;
  rotulos: { setor_dentro: string; setor_fora: string; lente_dentro: string; lente_fora: string; lente_so_setor: string; nao_area: string };
};

// As listas são as do recorte do TCC (tasks-python/_utils/escopo_tecnologia.py
// e materiais-e-métodos, quadro das famílias CBO).
export const TI: Area = {
  slug: "ti",
  nome: "TI",
  sigla: "TI",
  resumo: "Emprego formal em tecnologia no Brasil, de 2007 a 2026, a partir dos microdados da RAIS e do CAGED.",
  repo: "Gianpedro/gold-analise-mercado-ti",
  subareas: ["Desenvolvimento", "Suporte e Operação", "Infraestrutura e Dados", "Engenharia e Pesquisa", "Estatística e Ciência de Dados", "Gestão e Direção"],
  familias: {
    "1236": "Direção de serviços de informática",
    "1425": "Gerência de TI",
    "2031": "Pesquisa em computação",
    "2112": "Estatística e ciência de dados",
    "2122": "Engenharia em computação",
    "2123": "Administração de TI (BD, redes, SO)",
    "2124": "Análise de sistemas e desenvolvimento",
    "3171": "Programação e desenvolvimento (técnico)",
    "3172": "Operação e suporte ao usuário",
  },
  avulsos: {
    "313220": "Técnico em manutenção de equipamentos de informática",
    "313305": "Técnico de comunicação de dados",
    "142135": "Encarregado de proteção de dados (DPO)",
  },
  rotulos: {
    setor_dentro: "Empresa de TI",
    setor_fora: "Fora do setor de TI",
    lente_dentro: "Profissional de TI em empresa de TI",
    lente_fora: "Profissional de TI fora do setor de TI",
    lente_so_setor: "Outra ocupação em empresa de TI",
    nao_area: "Outra ocupação (empresa de TI)",
  },
};
