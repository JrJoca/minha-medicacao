# Guia completo — gerar e instalar o APK Minha medicação

Este guia considera um computador com Windows 10 ou 11 e um celular Android.

## 1. Arquivos necessários

Tenha a pasta completa do projeto `controle-medicacao` no computador. Evite
colocá-la dentro do OneDrive. Um caminho curto recomendado é:

`C:\Projetos\controle-medicacao`

O projeto já contém a pasta `android`, a configuração do Capacitor e os scripts
necessários para gerar o APK.

## 2. Instalar o Node.js

1. Acesse https://nodejs.org/.
2. Baixe e instale uma versão 22 ou superior.
3. Mantenha as opções padrão do instalador.
4. Feche e abra novamente o PowerShell.
5. Confirme a instalação:

```powershell
node --version
```

O resultado deve começar com `v22` ou um número superior.

## 3. Ativar o pnpm

Abra o PowerShell e execute:

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm --version
```

## 4. Instalar o Android Studio

1. Acesse https://developer.android.com/studio.
2. Baixe e instale a versão estável mais recente.
3. No primeiro início, escolha a instalação padrão.
4. Autorize o Android Studio a baixar o Android SDK e as ferramentas sugeridas.

No Android Studio, abra **More Actions > SDK Manager** e confirme:

- **SDK Platforms:** Android 16 / API 36.
- **SDK Tools:** Android SDK Build-Tools.
- **SDK Tools:** Android SDK Platform-Tools.
- **SDK Tools:** Android SDK Command-line Tools.

Clique em **Apply** e aceite as licenças.

## 5. Instalar as dependências do projeto

Abra o PowerShell dentro da pasta do projeto:

```powershell
cd C:\Projetos\controle-medicacao
pnpm install
```

## 6. Gerar e sincronizar o conteúdo do aplicativo

Ainda no PowerShell, execute:

```powershell
pnpm android:sync
```

Esse comando compila o React e copia o resultado para o projeto Android. Use-o
sempre que a interface ou as funcionalidades do aplicativo forem alteradas.

## 7. Abrir o projeto Android

Execute:

```powershell
pnpm android:open
```

O Android Studio abrirá a pasta `android`. Aguarde até a mensagem de
sincronização do Gradle desaparecer. Na primeira execução, o download das
dependências pode demorar.

Se o Android Studio perguntar qual JDK utilizar, escolha o JDK incorporado ao
Android Studio, também chamado de **Embedded JDK**.

## 8. Preparar o celular

Os nomes dos menus podem variar conforme a fabricante.

1. Abra **Configurações > Sobre o telefone**.
2. Toque sete vezes em **Número da versão**, **Versão do sistema** ou **Versão
   do HyperOS/MIUI**.
3. Confirme o desbloqueio das opções de desenvolvedor.
4. Abra **Configurações > Configurações adicionais > Opções do desenvolvedor**.
5. Ative **Depuração USB**.
6. Conecte o celular ao computador usando um cabo USB que transfira dados.
7. No celular, aceite a mensagem **Permitir depuração USB neste computador**.

No Windows, pode ser necessário instalar o driver USB da fabricante. Caso o
celular não apareça, use outro cabo, outra porta USB e confirme que o modo USB
está definido como **Transferência de arquivos**.

## 9. Instalar diretamente pelo Android Studio

Este é o melhor caminho para o primeiro teste:

1. Na barra superior do Android Studio, selecione o celular conectado.
2. Confirme que a configuração selecionada é `app`.
3. Clique no botão verde **Run**.
4. Aguarde a compilação e instalação.
5. O aplicativo **Minha medicação** abrirá automaticamente no celular.

Se o celular não aparecer, abra **Tools > Troubleshoot Device Connections** no
Android Studio.

## 10. Gerar o arquivo APK de teste

Feche o Android Studio ou deixe-o aberto. No PowerShell, dentro do projeto,
execute:

```powershell
pnpm android:apk:debug
```

O APK será criado em:

`android\app\build\outputs\apk\debug\app-debug.apk`

Outra opção no Android Studio é usar **Build > Build APK(s)**.

## 11. Copiar e instalar o APK manualmente

1. Copie `app-debug.apk` para o celular por USB ou Google Drive.
2. No celular, abra o aplicativo **Arquivos**.
3. Toque no APK.
4. Quando solicitado, autorize **Instalar apps desconhecidos** somente para o
   aplicativo usado para abrir o arquivo.
5. Volte e toque em **Instalar**.

Use somente o APK gerado no seu computador. Depois da instalação, você pode
desativar novamente a permissão para instalar aplicativos desconhecidos.

## 12. Primeiro acesso

1. Abra **Minha medicação**.
2. Entre com a mesma conta utilizada na versão web.
3. Confirme se medicamentos, rotinas e relatórios foram carregados.
4. Quando o Android solicitar, permita o envio de notificações.

O APK e a versão web compartilham a mesma conta e o mesmo banco Supabase.

## 13. Permissões para os lembretes

Abra **Configurações > Aplicativos > Minha medicação** e confira:

- **Notificações:** permitidas.
- **Alarmes e lembretes:** permitidos, quando essa opção existir.
- **Bateria:** escolha **Sem restrições** se os alertas atrasarem.
- Em aparelhos Xiaomi/HyperOS, habilite **Inicialização automática** se essa
  opção estiver disponível.

Faça um teste criando uma rotina para alguns minutos à frente e bloqueie a tela
do celular. Confirme o alerta principal e o alerta do horário limite.

## 14. Testes recomendados

- Entrar e sair da conta.
- Criar e editar medicamento.
- Criar, pausar, editar e excluir rotina.
- Concluir e desfazer uma rotina.
- Abrir o WhatsApp.
- Consultar e corrigir relatórios.
- Reiniciar o celular e testar novamente uma notificação.
- Conferir dados alterados no APK também na versão web.

## 15. Atualizar o aplicativo

Após qualquer alteração no código:

```powershell
pnpm install
pnpm android:sync
pnpm android:apk:debug
```

Copie o novo APK para o celular e instale por cima do anterior. Não altere o
identificador `br.com.joaquimkurama.minhamedicacao`.

Se o Android informar que o pacote é incompatível, provavelmente o APK foi
assinado por outra chave. Nesse caso, desinstalar resolve, mas remove a sessão
local. Os dados salvos no Supabase permanecem na conta.

## 16. APK assinado para uso definitivo

O APK de depuração é suficiente para testes pessoais. Para uma distribuição
mais estável:

1. No Android Studio, abra **Build > Generate Signed Bundle / APK**.
2. Escolha **APK**.
3. Clique em **Create new** para criar um arquivo de chave `.jks`.
4. Guarde o arquivo, o alias e as senhas em local seguro.
5. Escolha a variante `release`.
6. Gere o APK assinado.

Nunca perca a chave: futuras atualizações precisam usar a mesma assinatura. Não
adicione o arquivo `.jks` ao projeto nem o envie por mensagens.

## 17. Problemas comuns

### `node` ou `pnpm` não reconhecido

Feche e abra novamente o PowerShell. Se continuar, reinstale o Node.js e
confirme que ele foi adicionado ao PATH.

### Licenças do Android SDK pendentes

Abra o SDK Manager, instale ou atualize os componentes e aceite as licenças.

### Celular não aparece

- Confirme a depuração USB.
- Troque o cabo e a porta USB.
- Selecione Transferência de arquivos.
- Instale o driver USB da fabricante.
- Revogue as autorizações de depuração USB e conecte novamente.

### Aplicativo abre uma tela branca

Execute novamente `pnpm android:sync`, aguarde o término e gere outro APK.

### Dados não carregam

Confirme a conexão com a internet e tente entrar novamente. O aplicativo usa o
Supabase e precisa de acesso à internet para sincronizar os dados.

### Notificação não aparece

Confirme as permissões de notificações, alarmes, bateria e inicialização
automática. Depois, abra o aplicativo para sincronizar novamente as rotinas.
