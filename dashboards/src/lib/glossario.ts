// Uma linha para cada termo técnico do painel: aparece no "?" ao lado dele.
// Escrito para quem não leu o TCC, sem fórmula.
export const GLOSSARIO = {
  estoque: "Vínculos de emprego formal ativos em 31 de dezembro, segundo a RAIS. É a fotografia do mercado no fim do ano.",
  saldo: "Admissões menos desligamentos no período, segundo o CAGED. Positivo quer dizer que o mercado criou vagas líquidas.",
  sm: "Salários mínimos: a remuneração dividida pelo salário mínimo do ano. Permite comparar 2007 com 2025 sem escolher um índice de inflação.",
  mediana: "O valor do meio: metade das pessoas ganha mais, metade ganha menos. Ao contrário da média, não é puxada por poucos salários muito altos.",
  lentes: "TI pode ser definida pela empresa (o setor, pela CNAE) ou pela ocupação da pessoa (pela CBO). O painel guarda as duas: profissional de TI dentro de empresa de TI, fora dela, e outras ocupações dentro de empresas de TI.",
  giro: "Vínculos encerrados no ano divididos pelo estoque. Mede quanto o mercado troca de gente.",
  risco: "Chance de um vínculo ser encerrado no ano, conforme o tempo de casa no início dele.",
  sobrevivencia: "Parte dos vínculos que continuaria no emprego ao fim de cada faixa de tempo de casa, se o risco daquele ano valesse para todos.",
  hiato: "Quanto o primeiro grupo ganha a mais que o segundo, em média, em porcentagem. Negativo: o segundo grupo ganha mais.",
  perfil: "Efeito do perfil: a parte da diferença que vem de os grupos terem perfis diferentes (escolaridade, área, porte da empresa, região, idade, jornada e tempo de casa). Negativo: pelo perfil, o segundo grupo deveria ganhar mais.",
  pagamento: "Entre pessoas iguais: a diferença que sobra comparando pessoas com o mesmo perfil. Não prova discriminação: é o máximo que a discriminação poderia explicar.",
  trajetoria: "Municípios agrupados por semelhança de tamanho, especialização, crescimento, giro e salário: polo maduro, emergente e mercado incipiente.",
  porMil: "Vínculos de TI para cada mil habitantes: mede o quanto o lugar é especializado em TI, e não o seu tamanho.",
  nowcast: "Estimar o presente: o estoque do ano corrente, que a RAIS só publica no ano seguinte, a partir do fluxo que o CAGED já divulgou.",
  sarima: "Modelo de série temporal que aprende a tendência e o ciclo anual do saldo mensal. Foi escolhido por errar menos que as alternativas em testes com o passado.",
  faixa80: "Intervalo em que o valor real deve cair em 8 de cada 10 casos, segundo o modelo.",
  mae: "Erro absoluto médio: em média, quanto a previsão errou, em vagas, nos testes com o passado.",
  razao_chances: "Razão de chances: quantas vezes a chance de sair do emprego no ano muda em relação ao grupo de referência, comparando pessoas iguais em todo o resto. ×1 = mesmo risco; ×2 = o dobro; ×0,5 = metade.",
  backtest: "Teste com o passado: o modelo finge estar num ano já conhecido, faz a previsão só com o que sabia então e compara com o que de fato aconteceu.",
  silver: "A camada do pipeline com os registros brutos já recortados para TI: cada vínculo da RAIS e cada movimentação do CAGED de uma ocupação ou empresa de tecnologia, antes de qualquer agregação.",
} as const;

export type Termo = keyof typeof GLOSSARIO;
