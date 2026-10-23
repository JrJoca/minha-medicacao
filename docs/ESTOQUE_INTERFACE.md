# Estoque por tomada: interface e regras

Implementação no PR #3, para revisão antes de publicar. A base 003 está aplicada
no Neon de produção; as ampliações 004 e 005 foram ensaiadas somente na branch sintética.
O domínio principal continua com a versão publicada anteriormente.

## Como usar após a implantação

1. Cadastre o medicamento com os campos originais: nome, dosagem e link. OCR
   continua exigindo revisão; “500 mg” não vira quantidade de comprimidos.
2. Em **Configurar estoque**, informe o saldo físico e a quantidade por caixa ou
   frasco. Escolha **comprimidos** ou **ml**. Zero significa esgotado; em branco
   significa desconhecido. Não há conversão entre unidades. Uma apresentação
   diferente deve ser cadastrada como outro medicamento.
3. Ao criar ou editar uma rotina, informe a **quantidade por tomada de cada
   medicamento**, com a unidade correspondente. Exemplos: 2 comprimidos de A e
   2,5 ml de B. São aceitas até três casas decimais, incluindo frações de comprimido
   explicitamente informadas; o aplicativo não determina a prescrição.
4. Selecione frequência diária quando houver uma tomada diária naquele horário.
   Para vários horários, crie uma rotina por horário. A opção de outra frequência
   preserva a orientação textual e a confirmação manual, mas fica sem previsão.
5. **Concluir rotina** grava a tomada e desconta todos os medicamentos na mesma
   transação. Relatório e histórico utilizam o mesmo caminho. Nenhuma baixa é
   causada apenas pelo horário, atraso, pausa ou ausência de confirmação.
6. **Desfazer** estorna a quantidade da baixa original uma única vez. Alterar a
   dose futura não muda o consumo passado; corrigir data/hora não desconta de novo.
7. Se faltar estoque, a tomada é registrada e o saldo fica negativo, com aviso
   para conferir o saldo físico. Esse comportamento foi escolhido pelo usuário.
8. Na página **Controle de medicamentos**, ative/desative cadastros e registre
   compras com quantidade, data, farmácia e link opcional. A compra soma unidades;
   a conferência física corrige a contagem. **Ver compras** mantém o histórico.
   Desativados saem das novas seleções, preservando rotinas e fatos existentes.

O visualizador consulta os saldos e as rotinas, com mutações bloqueadas também
no servidor. Uma troca de conta limpa os dados anteriores e cancela consultas.
Falhas de estoque não impedem o acesso a medicamentos e rotinas.

## Previsão

O consumo diário vem da soma das quantidades das **rotinas diárias ativas** do
medicamento. Dez comprimidos com uma rotina de dois por dia duram cinco dias.
Duas rotinas de um comprimido também totalizam dois por dia. Pausar/arquivar retira
sua quantidade dessa soma. Se houver rotina ativa sem dose/frequência estruturada,
a previsão fica desconhecida. O tamanho da embalagem não multiplica o saldo.

A página simula as ocorrências diárias no calendário local: última dose coberta e
primeira falta (“Repor até”). Não desconta novamente as tomadas confirmadas hoje.
Usa os dias restantes configurados nos tratamentos limitados e informa quando o
saldo cobre o período. A divisão proporcional permanece como duração de consumo.
Recorrências complexas continuam sem previsão. Detalhes e limites em
[CONTROLE_MEDICAMENTOS.md](CONTROLE_MEDICAMENTOS.md).

## Preservação e compatibilidade

- Quantidades antigas são copiadas dos campos estruturados existentes, mantendo
  campos originais, IDs, textos e timestamps. Nenhuma dose é inferida de texto.
- Rotinas e tomadas antigas não recebem descontos retroativos. A interface
  solicita a configuração de doses antes de uma nova confirmação de rotina legada.
- Tomadas antigas sem baixa não geram reposição ao desfazer.
- Consumo com saldo desconhecido é registrado na trilha, sem inventar zero. A
  primeira contagem física não desconta esses registros novamente; o estorno de
  uma baixa que não afetou saldo também não cria estoque após essa contagem.
- Movimentos guardam nome/dosagem/quantidade da tomada. Clientes só podem lê-los;
  não podem apagar, editar ou inserir movimentos diretamente.
- **Arquivar** substitui a exclusão de rotinas na nova interface, conservando
  tomadas e movimentos. Arquivadas saem de hoje/previsão e permanecem consultáveis
  nas datas em que têm registros. Exclusões diretas que destruiriam fatos falham.
- Clientes antigos continuam operando rotinas não configuradas. Em rotinas já
  configuradas, inserção/remoção de tomadas passa pelos mesmos triggers de baixa
  e estorno; edição antiga de doses/saldos é recusada com pedido de atualização.
- Comandos de confirmação, estorno, correção, conferência física e salvamento de
  rotina reutilizam um identificador após falha de rede. Uma operação concluída
  não é executada novamente; payload diferente no mesmo identificador é recusado.

## Validação

Testes locais cobrem migração, preservação, permissões, unidade/precisão,
idempotência, rollback quando um medicamento falha, saldo negativo/desconhecido,
estorno por snapshot, legado e virada de data local. Auth/Data API reais foram
exercitados em uma branch Neon com fixtures, incluindo requisições simultâneas.
O navegador validou doses por item, comprimidos/ml juntos, confirmar/desfazer,
recarregar, visualizador e celular. Capturas externas ao Git usam apenas fixtures.
TypeScript, lint e build fazem parte da verificação; o aviso preexistente de
imagem do OCR permanece separado. Android continua como última etapa.

A prévia automática da Vercel aponta para os endpoints de produção. A nova
interface depende das migrações 004 e 005; ela não constitui uma validação funcional
antes dessa aplicação. As capturas e os testes com a branch sintética são a
referência de revisão desta entrega.
