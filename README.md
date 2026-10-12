# Benchmark automático da API Node.js na própria máquina

Requer Node.js 22 ou superior. Na pasta do projeto:

```sh
npm install
npm run benchmark
```

Um único comando inicia o Fastify em um processo separado e numa porta local livre, aquece a API, aumenta as conexões automaticamente (10, 20, 40, 80…) por 10 segundos em cada etapa e encerra o servidor automaticamente. O relatório JSON fica em results/.

## Encontrar a capacidade de conexões

O modo automático é o padrão. Dobra as conexões até reprovar uma etapa ou atingir o teto de 10.000. Se houver reprovação, testa valores intermediários entre a maior etapa aprovada e a menor reprovada, incluindo valores abaixo do início quando necessário.

```sh
npm run benchmark -- --start-connections 10 --max-connections 20000 --precision 5 --duration 15 --max-p99 200 --max-error-rate 1
```

O relatório `capacity` informa a maior quantidade aprovada, a menor reprovada e a largura do intervalo estimado. O refinamento termina quando o intervalo é de até `--precision` conexões ou após `--refinements` tentativas (12 por padrão). Se o teto passar, o programa informa que o limite não foi encontrado. Aumente o teto para continuar a investigação. O modo manual continua disponível com `--connections`.

Esse é um limite estimado de conexões **ativas sob carga**, com os critérios e cenário escolhidos. Não mede o máximo de sockets ociosos que o sistema operacional consegue manter. A busca pressupõe que aumentar a carga piora a qualidade; ruído, aquecimento e variações do sistema podem alterar o intervalo. Repita para confirmar e considere o consumo do gerador local.

Encontrar uma etapa reprovada durante a busca é esperado: o modo automático retorna saída 0 ao concluir a estimativa, 2 se nenhuma etapa passar, 1 em falhas de execução.

## Cenários

```sh
npm run benchmark -- --scenario cpu --iterations 1000
npm run benchmark -- --scenario io --delay-ms 20
npm run benchmark -- --connections 10,50,100,300,500 --duration 20 --max-p99 200 --max-error-rate 1
```

simple retorna JSON pequeno; cpu executa cálculo síncrono por requisição; io simula uma espera assíncrona sem acessar banco ou disco. No modo manual, o teste para na primeira reprovação e retorna saída 2. No modo automático, a reprovação inicia o refinamento.

## O que o relatório mede

- Requisições por segundo, latência p99, erros, timeouts e respostas fora de 2xx por etapa.
- CPU do processo da API como percentual de um núcleo: 100% equivale a um núcleo ocupado; outros trabalhos internos podem superar esse valor.
- Maior memória RSS da API observada em amostras e atraso p99 do event loop por etapa.
- Modelo da CPU, núcleos lógicos, memória total e versão do Node.js.
- Etapa aprovada com maior throughput observado, segundo os limites escolhidos.

O Fastify usa um processo. O resultado não representa automaticamente a capacidade de todos os núcleos, nem uma aplicação real com banco, autenticação e outras dependências. Conexões simultâneas não representam usuários. O gerador também consome CPU e memória da máquina, portanto este é um benchmark local do conjunto API + gerador. Não determina isoladamente o limite do servidor. Se todas as etapas passarem, o limite não foi encontrado nessa faixa. Repita os testes para comparar resultados.

A coleta de memória ocorre aproximadamente a cada 500 ms, não captura todos os picos. O gerador mantém conexões e envia outra requisição após receber a resposta; não simula uma taxa fixa de chegada. P99 é a latência abaixo da qual ficaram aproximadamente 99% das observações.

Referências: [Fastify](https://fastify.dev/docs/latest/Guides/Getting-Started/), [Autocannon](https://github.com/mcollina/autocannon).

## Validação

A busca foi validada com cinco testes automatizados (expansão, refinamento, teto, reprovação inicial e limite de tentativas) e execuções locais curtas que verificaram reprovação e teto aprovado. Os testes curtos não medem a capacidade máxima. A instalação reportou três avisos moderados na cadeia de dependências do Autocannon; consulte npm audit para os detalhes.
