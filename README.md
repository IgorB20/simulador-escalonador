# Simulador de Sistemas Operacionais

## Descrição

Este projeto foi desenvolvido para a disciplina de Sistemas Operacionais e tem como objetivo simular o escalonamento de processos em sistemas com uma ou quatro CPUs, considerando gerenciamento de memória paginada, trocas de contexto, operações de entrada e saída e falhas de página.

O simulador permite comparar diferentes algoritmos de escalonamento e políticas de substituição de páginas, gerando métricas de desempenho, diagramas de Gantt e logs detalhados da execução.

## Algoritmos implementados

- **Escalonamento de processos:** FCFS (First Come, First Served), SJF (Shortest Job First) não preemptivo e RR (Round Robin).
- **Substituição de páginas:** FIFO (First In, First Out) e LRU (Least Recently Used).

## Execução local com Node.js

**Requisitos:** Node.js versão 18 ou superior e npm instalados.

1. Clone o repositório e abra a pasta do projeto no terminal.
2. Instale as dependências:

   ```bash
   npm install
   ```

3. Execute o simulador utilizando o `tsx`.

### Exemplo com 1 CPU, FCFS e FIFO

```bash
npx tsx src/index.ts --arquivo ./cenario_A_t0.json --cpus 1 --sched fcfs --subst fifo
```

### Exemplo com 4 CPUs, SJF e LRU

```bash
npx tsx src/index.ts --arquivo ./cenario_A_t0.json --cpus 4 --sched sjf --subst lru
```

### Exemplo com 4 CPUs, Round Robin, quantum 10 e LRU

```bash
npx tsx src/index.ts --arquivo ./cenario_B_espacadas.json --cpus 4 --sched rr --quantum 10 --subst lru
```

## Execução no Windows

O projeto também disponibiliza um executável para Windows 64 bits, permitindo executar o simulador sem precisar instalar Node.js ou qualquer dependência.

1. Baixe o arquivo `simulador.exe`, `cenario_A_t0.json` e `cenario_B_espacadas.json` disponibilizados [aqui](https://github.com/IgorB20/simulador-escalonador/releases/tag/1.0.0)
2. Certifique-se de que os arquivos `simulador.exe`, `cenario_A_t0.json` e `cenario_B_espacadas.json` estejam na mesma pasta.
3. Abra essa pasta no Explorador de Arquivos, digite `powershell` na barra de endereço e pressione **Enter**.
4. Execute um dos comandos abaixo.

### Exemplo com 1 CPU, FCFS e FIFO

```powershell
.\simulador.exe --arquivo .\cenario_A_t0.json --cpus 1 --sched fcfs --subst fifo
```

### Exemplo com 4 CPUs, SJF e LRU

```powershell
.\simulador.exe --arquivo .\cenario_A_t0.json --cpus 4 --sched sjf --subst lru
```

### Exemplo com 4 CPUs, Round Robin e quantum 10

```powershell
.\simulador.exe --arquivo .\cenario_B_espacadas.json --cpus 4 --sched rr --quantum 10 --subst lru
```

Não é necessário realizar nenhuma instalação adicional para executar o programa.

## Parâmetros disponíveis

| Parâmetro | Descrição | Valores aceitos | Padrão |
| --- | --- | --- | --- |
| `--arquivo` | Caminho do arquivo JSON que contém os processos. **Obrigatório.** | Caminho do arquivo JSON | — |
| `--cpus` | Quantidade de CPUs utilizadas na simulação. | `1` ou `4` | `1` |
| `--sched` | Algoritmo de escalonamento. | `fcfs`, `sjf` ou `rr` | `fcfs` |
| `--quantum` | Quantidade de unidades de tempo do Round Robin. | — | `2` |
| `--subst` | Política de substituição de páginas. | `fifo` ou `lru` | `fifo` |
| `--quadros` | Quantidade de quadros disponíveis na memória RAM. | — | `256` |
| `--custo-troca` | Custo de uma troca de contexto em unidades de tempo. | — | `1` |
| `--fault` | Duração do bloqueio causado por uma falha de página. | — | `20` |
| `--saida` | Pasta utilizada para armazenar os resultados. | — | `resultados` |
| `--log` | Habilita o registro detalhado dos eventos e estados do sistema. | — | — |

## Logs da simulação

Para habilitar os logs, adicione `--log` ao final do comando.

### Exemplo utilizando o executável Windows

```powershell
.\simulador.exe --arquivo .\cenario_A_t0.json --cpus 1 --sched fcfs --subst fifo --log
```

O programa gera um arquivo chamado `logs.txt` na pasta de execução.

Esse arquivo contém as mudanças de estado dos processos, incluindo chegadas, despachos, preempções, falhas de página, bloqueios, retornos e términos.

Para cada evento, também são apresentados a fila de prontos, os processos bloqueados, a ocupação das CPUs e a quantidade de quadros utilizados na memória RAM.

O arquivo `logs.txt` é sobrescrito completamente a cada execução. Quando o parâmetro `--log` não é informado, o arquivo permanece vazio.

### Exemplo utilizando Node.js

```bash
npx tsx src/index.ts --arquivo ./cenario_A_t0.json --cpus 1 --sched fcfs --subst fifo --log
```



## Arquivos de resultados

Após cada simulação, o programa cria uma pasta específica para a configuração executada dentro do diretório `resultados`.

São gerados três arquivos:

- **`metricas.json`:** apresenta os parâmetros e todas as métricas calculadas na execução.
- **`metricas.csv`:** contém as principais métricas de desempenho em formato CSV, facilitando a comparação entre diferentes configurações.
- **`gantt.csv`:** registra a execução das CPUs entre os instantes 0 e 200, identificando os processos executados, as trocas de contexto e os períodos de ociosidade.

As métricas incluem espera média, espera máxima, resposta média, turnaround médio, makespan, número de trocas de contexto, quantidade de page faults e utilização das CPUs.

## Cenários de teste

O projeto utiliza dois arquivos JSON com **1.000 processos cada**.

- **`cenario_A_t0.json`:** todos os processos chegam no instante zero.
- **`cenario_B_espacadas.json`:** os processos chegam em instantes diferentes.

Esses cenários permitem avaliar o comportamento dos algoritmos sob diferentes condições de chegada e concorrência.

## Observações

- O simulador utiliza uma fila global de processos prontos, compartilhada entre as CPUs.
- Os resultados podem variar conforme o algoritmo de escalonamento, a quantidade de CPUs, a política de memória e os demais parâmetros informados.
- Para facilitar a visualização dos logs durante a apresentação, recomenda-se utilizar uma carga de teste com poucos processos, pois os cenários de 1.000 processos produzem arquivos extensos.
