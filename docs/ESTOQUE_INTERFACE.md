# Interface de estoque

O estoque fica nos cartões de “Medicamentos cadastrados”. O cadastro original
continua com nome, dosagem e link; OCR e criação de rotinas conservam seus fluxos.
A interface complementa a estrutura já aplicada no Neon, sem nova migração.

## Fluxo

1. O proprietário escolhe **Configurar estoque** no cartão do medicamento.
2. Informa total de comprimidos disponíveis, comprimidos por caixa e comprimidos
   por dia. Os campos podem ficar em branco quando a informação for desconhecida.
3. A prévia mostra a duração: **10 comprimidos / 2 por dia = 5 dias**.
4. **Salvar estoque** grava a configuração no Neon pelo JWT da pessoa. O cartão
   passa a mostrar os resultados gerados no banco, inclusive após recarregar.
5. **Atualizar estoque** permite revisar os valores. **Atualizar saldos** consulta
   novamente o banco, sem modificar nenhuma informação.

O visualizador tem **Consultar estoque**, com detalhes somente para leitura.
Não recebe formulário nem botão de gravação; o RLS também bloqueia mutações.

## Estados e validação

- Sem saldo: “Estoque não informado”; nenhum zero é preenchido automaticamente.
- Saldo zero: “Estoque esgotado”, distinto de informação ausente.
- Sem saldo ou consumo diário: “Sem previsão”.
- Saldo 10 e consumo 3/dia: aproximadamente 3,33 dias e 3 dias completos cobertos.
- Valores inteiros nos limites do PostgreSQL; saldo não negativo, caixa e consumo
  diário positivos. Campos vazios são enviados como NULL.
- Tamanho da caixa não multiplica o saldo físico nem a frequência informada.
- Erro ao salvar conserva o formulário para nova tentativa, sem afirmar sucesso.
- Erro ao consultar estoques mantém medicamentos e rotinas acessíveis, mostra
  indisponibilidade e oferece nova tentativa; não inventa saldos.
- A troca de conta desmonta os dados do estoque e cancela consultas anteriores.
- Uma trava durante o envio impede gravações duplicadas pelo botão do formulário.

O saldo é declarado manualmente. Confirmar/desfazer uma tomada ainda não altera
estoque. A interface informa isso junto aos cartões. Compras, movimentos,
estornos e previsão por agenda permanecem como próximas entregas; Android fica
como última etapa.

## Implementação e evidências

- `components/medication-inventory.tsx`: listagem, consulta, formulário, estados de
  carregamento/erro e persistência por usuário.
- `lib/medication-stock.ts`: normalização, validação e prévia, sem acesso administrativo.
- A consulta usa `medication_stock_summary`; a gravação usa `medication_stock`,
  com o ID protegido da conta atual. Campos calculados não são enviados ao banco.
- 77 testes automatizados aprovados: migração/RLS/corte/base de estoque e oito
  casos da interface. Instalação com lockfile, TypeScript e build passaram.
- Lint passou com um aviso preexistente de imagem no fluxo de OCR.
- Navegador com build estático e Neon sintético: cadastro original preservado,
  saldo desconhecido, salvar/recarregar, 10/2=5, uma requisição por envio, consumo
  zero bloqueado, dias parciais, zero distinto de NULL, falha com valores mantidos,
  nova tentativa, viewer somente leitura, outra conta isolada e limpeza ao sair.
- Falha de consulta preservou medicamentos/rotinas e a nova tentativa recuperou
  os estoques. Troca de conta na mesma aba descartou uma resposta antiga atrasada.
- Layout de celular validado em 320 e 360 px, com diálogo contido na tela e ações
  alcançáveis por rolagem; sem erros de página.
- Escritas de teste restritas às fixtures. As capturas usam dados sintéticos.

O frontend está preparado para revisão no PR #3. O banco de produção já recebeu
a ampliação, mas a publicação desta interface no domínio principal continua
separada da revisão. A prévia da Vercel usa os endpoints finais do Neon; valores
salvos por contas reais na prévia pertencem ao banco atual da aplicação.
