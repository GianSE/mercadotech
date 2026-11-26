# Perguntas prováveis da banca

Respostas curtas, com o número e onde ele está no TCC.

## Dados e recorte

**Por que a união de CNAE e CBO, e não só um dos dois?**
Porque cada lente sozinha perde um grupo grande. Só pelo CNAE, você não vê os 548 mil profissionais de TI que estão fora de empresas de TI (58%). Só pela CBO, perde quem está em empresa de TI em outra função (417 mil). Cada registro carrega os dois rótulos, e por isso dá para separar os três grupos (Tabela 10, seção 4.5).

**Como vocês sabem que o recorte está certo?**
Por duas verificações independentes:
- **Reprodutibilidade:** recontei o recorte no dado bruto em todos os anos das duas bases: 963 arquivos e 36.480.528 registros (23.795.000 da RAIS), com diferença zero (Tabela 3, seção 4.1). A consulta do apêndice repete a conta para um mês do CAGED (73.977 = 73.977), e qualquer pessoa pode rodá-la.
- **Validação externa:** comparei com o painel do MTE, filtrando os mesmos 34 códigos CBO. Fico cerca de 1% acima, sempre acima, e em todos os estados. Esse padrão é de diferença de critério, não de erro (seção 4.2).

**Por que ~1% acima do painel?**
A diferença é pequena (RAIS: +0,83% a +1,06%; Novo CAGED: +0,7% a +2,4%), tem sempre o mesmo sinal e se repete, em mediana, em todas as UFs; as maiores aparecem só em estados de estoque muito pequeno, como Roraima. A documentação do painel não permite identificar o critério. Como é proporcional, não altera comparações entre anos, estados ou grupos.

**Por que a variação da RAIS não bate com o saldo do CAGED?**
Andam juntas (correlação de 0,97), mas em mediana a variação da RAIS é 1,24 vez o saldo. Cerca de um terço da diferença são vínculos que passam a contar como TI sem admissão nem desligamento (troca de ocupação, mudança da atividade da empresa), concentrados de 2019 a 2022; os outros dois terços são a RAIS registrando alguns pontos a mais de admissões e desligamentos. É por isso que o nowcast usa a razão histórica, e não a identidade direta (seção 4.2).

**E o PJ?**
Fica de fora, e está declarado como limitação: RAIS e CAGED só cobrem o emprego formal (CLT e estatutário). Em TI, a contratação como PJ é comum, então o estoque real do setor é maior.

## Engenharia

**Por que DuckDB e não Spark ou um banco relacional?**
A camada tratada tem 1,3 GB. O DuckDB consulta Parquet no próprio arquivo, sem servidor e sem importar nada, e roda igual num executor gratuito do GitHub Actions e no navegador (WebAssembly). Spark seria infraestrutura para um volume que não precisa dela.

**Por que Hugging Face como data lake?**
Repositório público de dados, gratuito, com versionamento, e lido diretamente pelo DuckDB (`hf://`). O data lake é ao mesmo tempo o dado aberto: qualquer pessoa refaz as análises sem rodar a ingestão.

**O que acontece quando o MTE publica um mês novo?**
O orquestrador verifica o servidor toda semana e reprocessa só os anos com dado novo: Bronze → Silver → Gold → reconstrução do site. Não precisa de nenhuma ação manual.

**Vocês usam Databricks?**
Não. "Medalhão" é o nome que a Databricks deu a um padrão de camadas (Bronze, Silver, Gold) que independe de plataforma. Aqui as camadas são repositórios públicos do Hugging Face, processados pelo GitHub Actions com DuckDB. A figura do capítulo 2 vem da documentação da Microsoft só para ilustrar o conceito.

**Vocês perderam dados no caminho?**
Foi medido, não presumido (seção 4.3.2). A recontagem dá zero da Bronze em diante, então a perda só pode estar antes. Baixei de novo os 883 pacotes e contei as linhas do texto contra a Bronze. Dois pacotes do CAGED estão corrompidos na própria fonte (0,23% do CAGED bruto; no recorte de TI, só março de 2011 pesa, 0,17% das movimentações da série). Na RAIS, nove arquivos de 2017 a 2021 perderam um bloco na ingestão local: 567.751 vínculos, 0,04% da base, menos de 0,6% do estoque de TI de cada ano. Não imputei nada: está declarado, e a lacuna da RAIS se fecha reingerindo os nove arquivos.

**Qual foi o problema de engenharia mais difícil?**
A ingestão parcial de 2022. A auditoria por arquivo dizia que estava tudo lá, mas faltavam 7 pedaços (446.267 vínculos). Só apareceu porque a série ficou implausível. A lição foi trocar a verificação por arquivo pela verificação por pedaço e passar a recontar a partir do dado bruto.

## Métodos

**Por que salário em salários mínimos, e não deflacionado?**
Para comparar 2007 com 2025 sem precisar escolher um deflator. O salário mínimo também mede a posição relativa frente ao piso legal. A limitação é que o salário mínimo teve ganho real no período, então "estável em SM" não quer dizer "estável em poder de compra".

**Por que mediana e não média?**
Porque a remuneração é muito assimétrica. Ponto importante: a mediana do total precisa ser calculada sobre os vínculos, não como média das medianas dos grupos. Esse erro foi cometido, detectado e corrigido (3,55 contra 3,41 em 2025), e está registrado no texto.

**A parcela não explicada do Oaxaca é discriminação?**
Não. É um limite superior: contém tudo que afeta salário e não está no modelo. O resultado robusto é a estrutura: no gênero, a parcela explicada é negativa; na raça, a maior parte é explicada.

**Por que não Kaplan-Meier para permanência?**
Foi tentado e deu mediana de 48 anos. O estimador supõe uma coorte acompanhada no tempo, e a RAIS é um corte transversal, que sobre-representa vínculos longos. A tábua de vida de período responde à pergunta que o dado permite: qual o risco de desligamento em cada faixa de tempo de emprego naquele ano.

**Por que o SARIMA e não o Prophet, como estava na proposta?**
Os dois foram avaliados nas mesmas 5 dobras de origem móvel, contra o mesmo ingênuo sazonal, cada um com uma grade pequena. O melhor SARIMA, (1,0,1)(1,1,1)12, erra 23,2% menos que o ingênuo; nenhuma das três configurações do Prophet o superou: a de tendência mais rígida empatou (−0,4%) e as outras ficaram abaixo (−1,0% e −8,1%). A série é completa e de sazonalidade estável, terreno da diferenciação sazonal do SARIMA; as vantagens do Prophet (lacunas e mudanças de tendência) não se aplicavam. Ressalva que o TCC declara: o ganho do SARIMA é otimista, porque a especificação foi escolhida e avaliada nas mesmas dobras, e varia muito entre as especificações (de 23% a 1%).

**Não dava para ajustar melhor o Prophet?**
Dava, e seria o erro: com 5 dobras, testar muitas configurações acha por acaso a que se sai bem no teste. A grade do Prophet (3 configurações) é do mesmo tamanho da do SARIMA (6), e a tendência mais flexível piorou o resultado, o que indica que o Prophet lê ruído como mudança de tendência.

**A série é estacionária? Que testes foram feitos?**
Dois testes complementares, que partem de hipóteses opostas. O Augmented Dickey-Fuller (ADF) rejeita a raiz unitária (p = 0,04), e o de Kwiatkowski-Phillips-Schmidt-Shin (KPSS) não rejeita a estacionariedade (p ≥ 0,10), então os dois apontam para uma série estacionária. A ressalva que o TCC declara: depois de 2020, a média do saldo mais que dobra e o desvio-padrão cresce cerca de metade, sem que se possa separar a troca de definição do CAGED do ciclo da pandemia. A diferenciação sazonal absorve a mudança de nível, mas não a de dispersão (seção 3.6.1).

**Por que o horizonte é de 18 meses e não até 2030?**
O intervalo de predição cruza o zero ao fim do primeiro ano, ou seja, o modelo não distingue saldo positivo de negativo. Projetar até 2030 daria um número sem conteúdo informativo.

**O nowcast não depende de um ano favorável?**
Não: cada ano de 2014 a 2025 foi estimado só com os anteriores. O melhor estimador, a razão mediana, erra em média 1,1% (mediana 0,9%), contra 1,6% da identidade direta e 5,1% do ingênuo; em 11 dos 12 anos, abaixo de 2,3%. O pior é 2022 (−2,8%), quando o estoque cresceu bem mais que o saldo do CAGED, em boa parte por vínculos que passaram a contar como TI sem admissão, que o fluxo não vê. Antes da correção de Rondônia, o erro médio era 2,1%. Duas ressalvas do TCC: o erro foi medido com o ano completo do CAGED, e no uso corrente (ano pela metade) é maior. Para 2026, com nove meses observados: 1,38 milhão de vínculos, alta de 1,5%.

## Resultados

**São Paulo não distorce tudo?**
Foi feita a análise de sensibilidade. SP cresceu 154% e o restante do país 168%, então a conclusão de crescimento não depende de SP. A remuneração depende: a mediana paulista subiu (4,20 → 4,85) e a do restante caiu (2,89 → 2,66). O filtro de território do dashboard permite refazer essa sensibilidade em qualquer gráfico.

**Como acharam o problema de Rondônia?**
A série tinha movimentos que nenhum mercado explicaria: queda em 2011, em plena expansão, e um salto em 2018. O maior grupo de TI do país, em alguns anos, era um único órgão: o Executivo estadual de Rondônia, com 40 a 49 mil servidores declarados como programador (CBO 317110) em oito anos e com outra ocupação nos demais. O total de servidores do órgão fica estável; só o código muda, o padrão de um valor pré-preenchido no sistema de declaração. Retirá-lo elevou o crescimento de 143% para 162%, inverteu a tendência do hiato de gênero e baixou o erro do nowcast de 2,1% para 1,1% (seção 4.3.1).

**E se houver outro caso como o de Rondônia?**
Uma verificação procura casos assim a cada construção da Gold (seção 3.5). Para cada ocupação de TI em cada município, ela compara os vínculos de um ano com os do ano anterior e lista os casos em que o número foi multiplicado ou dividido por dez ou mais, desde que um dos dois anos tenha pelo menos 5 mil vínculos. Junto, mostra o tempo médio de emprego do grupo: uma contratação em massa traz gente recém-admitida, e um grupo que surge já com anos de emprego (em Porto Velho, 158 meses em média) indica pessoas que só mudaram de código. Hoje ela só encontra Rondônia. A chave é município e ocupação, sem a natureza jurídica: com ela, uma empresa que passava de LTDA para S.A. levando os empregados aparecia como salto, e a verificação acusava 27 casos, dos quais só um era defeito.

**O Ceará com mediana de 1,40 SM não é estranho?**
É composição. No Ceará, 65% do estoque do recorte são outras ocupações em empresas de TI, mais que o dobro da proporção nacional (31%), com mediana de 1,29 SM. Mais da metade delas são de apoio administrativo, portaria e limpeza (auxiliar de escritório, assistente administrativo, zelador, porteiro, faxineiro), em grandes estabelecimentos de Fortaleza classificados em consultoria e suporte em TI. Isso sugere terceirização de mão de obra registrada em atividade de TI. Não é call center: operadores de telemarketing são só 214 vínculos (seção 4.5). A localização também é a do estabelecimento, não a do trabalho.

**Por que a tábua de vida é de 2024, se a RAIS vai até 2025?**
O ano não muda o resultado. Refeita com 2025, a tábua dá o mesmo padrão: pico de 27,9% na faixa de 6 a 12 meses (27,7% em 2024), 76,5% completam um ano (77%), 57% chegam a dois (58%), mediana de permanência de dois a três anos nos dois anos, e quem está fora das empresas de TI segue permanecendo mais (18% contra 14% chegam à faixa de 5 a 10 anos; em 2024, 20% contra 16%). O TCC registra a verificação (seção 4.6).

**Por que quem está fora das empresas de TI fica mais tempo no emprego?**
O dado mostra a diferença (um em cada cinco chega à faixa de 5 a 10 anos, contra 16% dentro das empresas de TI), mas não a causa, e a RAIS não permite separar as explicações. Há três candidatas: o tipo de empregador (administração pública e bancos, onde o vínculo é mais protegido), as oportunidades de troca (maiores entre empresas do próprio setor, que disputam o mesmo perfil) e a dinâmica das empresas de TI (postos que dependem de contratos com clientes e da abertura e do fechamento de empresas) (seção 4.6).
