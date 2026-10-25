# Perguntas prováveis da banca

Respostas curtas, com o número e onde ele está no TCC.

## Dados e recorte

**Por que a união de CNAE e CBO, e não só um dos dois?**
Porque cada lente sozinha perde um grupo grande. Só pelo CNAE, você não vê os 548 mil profissionais de TI que estão fora de empresas de TI (58%). Só pela CBO, perde quem está em empresa de TI em outra função (417 mil). Cada registro carrega os dois rótulos, e por isso dá para separar os três grupos (Tabela de lentes, seção 4.6).

**Como vocês sabem que o recorte está certo?**
Por duas verificações independentes:
- **Reprodutibilidade:** recontei o recorte no dado bruto, nos 19 anos da RAIS, 445 arquivos e 23.795.000 registros, com diferença zero. Para o CAGED, a consulta do apêndice faz o mesmo em um mês (73.977 = 73.977).
- **Validação externa:** comparei com o painel do MTE, filtrando os mesmos 34 códigos CBO. Fico cerca de 1% acima, sempre acima, e em todos os estados. Esse padrão é de diferença de critério, não de erro (seção 4.3).

**Por que ~1% acima do painel?**
A diferença é pequena, tem sempre o mesmo sinal e está espalhada por todas as ocupações (de 0% a 5,7%, mediana de 0,6%). A documentação do painel não permite identificar o critério. Como é proporcional, não altera comparações entre anos, estados ou grupos.

**E o PJ?**
Fica de fora, e está declarado como limitação: RAIS e CAGED só cobrem o emprego formal (CLT e estatutário). Em TI, a contratação como PJ é comum, então o estoque real do setor é maior.

## Engenharia

**Por que DuckDB e não Spark ou um banco relacional?**
A camada tratada tem 1,3 GB. O DuckDB consulta Parquet no próprio arquivo, sem servidor e sem importar nada, e roda igual num executor gratuito do GitHub Actions e no navegador (WebAssembly). Spark seria infraestrutura para um volume que não precisa dela.

**Por que Hugging Face como data lake?**
Repositório público de dados, gratuito, com versionamento, e lido diretamente pelo DuckDB (`hf://`). O data lake é ao mesmo tempo o dado aberto: qualquer pessoa refaz as análises sem rodar a ingestão.

**O que acontece quando o MTE publica um mês novo?**
O orquestrador verifica o servidor toda semana e reprocessa só os anos com dado novo: Bronze → Silver → Gold → reconstrução do site. Não precisa de nenhuma ação manual.

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
Foi tentado e deu mediana de 48 anos. O estimador supõe uma coorte acompanhada no tempo, e a RAIS é um corte transversal, que sobre-representa vínculos longos. A tábua de vida de período responde à pergunta que o dado permite: qual o risco de desligamento em cada faixa de tempo de casa naquele ano.

**Por que o SARIMA e não o Prophet, como estava na proposta?**
Os dois foram avaliados nas mesmas 5 dobras de origem móvel, contra o mesmo ingênuo sazonal, cada um com uma grade pequena. O melhor SARIMA erra 31% menos que o ingênuo; o melhor Prophet (tendência rígida), 16% menos; com a tendência padrão ou flexível, o Prophet fica pior que o ingênuo. A série é completa e de sazonalidade estável, terreno da diferenciação sazonal do SARIMA; as vantagens do Prophet (lacunas e mudanças de tendência) não se aplicavam.

**Não dava para ajustar melhor o Prophet?**
Dava, e seria o erro: com 5 dobras, testar muitas configurações acha por acaso a que se sai bem no teste. A grade do Prophet (3 configurações) é do mesmo tamanho da do SARIMA (6), e a tendência mais flexível piorou o resultado, o que indica que o Prophet lê ruído como mudança de tendência.

**Por que o horizonte é de 18 meses e não até 2030?**
O intervalo de predição cruza o zero ao fim do primeiro ano, ou seja, o modelo não distingue saldo positivo de negativo. Projetar até 2030 daria um número sem conteúdo informativo.

**O nowcast não depende de um ano favorável?**
Não: cada ano de 2014 a 2025 foi estimado só com os anteriores. O melhor estimador erra em média 2,1% (mediana 1,4%), contra 5,1% do ingênuo; em 10 dos 12 anos, até 2,2%. Os anos ruins são 2018 e 2022, quando o estoque cresceu bem mais que o saldo do CAGED — nenhum estimador apoiado no fluxo antecipa isso. Os 0,78% de 2025 são o caso favorável, e o TCC diz isso.

## Resultados

**São Paulo não distorce tudo?**
Foi feita a análise de sensibilidade. SP cresceu 154% e o restante do país 136%, então a conclusão de crescimento não depende de SP. A remuneração depende: a mediana paulista subiu (4,20 → 4,85) e a do restante caiu (2,81 → 2,66).

**O Ceará com mediana de 1,40 SM não é estranho?**
É composição. Há centrais de atendimento classificadas em atividades de TI, então o número não indica um mercado de desenvolvimento mal pago. A localização também é a do estabelecimento, não a do trabalho.
