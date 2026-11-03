import { MemoriaRAM } from "./RAM.js";
import { readFileSync, mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { join, parse } from "node:path";

type Escalonador = "fcfs" | "sjf" | "rr";

export type BurstCPU = {
    cpu: number;
    refs: number[];
};

export type BurstES = {
    es: number;
};

export type EstadoProcesso =
    | "novo"
    | "pronto"
    | "executando"
    | "bloqueado"
    | "terminado";

export type Processo = {
    // Dados do JSON
    pid: number;
    chegada: number;
    classe: "curto" | "longo";
    paginas: number;
    bursts: (BurstCPU | BurstES)[];

    // Dados da simulação
    estado?: EstadoProcesso;
    burstAtual?: number;
    executado?: number;
    faultPendente?: boolean;

    // Métricas
    entrouProntosEm?: number;
    tempoEspera?: number;
    primeiroDespacho?: number;
    termino?: number;
};

function obterBurstCPU(processo: Processo): BurstCPU {
    const burst = processo.bursts[processo.burstAtual ?? 0];

    if (!burst || !("cpu" in burst)) {
        throw new Error(`P${processo.pid} não está em um burst de CPU`);
    }

    return burst;
}

class CPU {

    public disponivel = true;
    public processoAtual: Processo | null = null;

    // Troca de contexto
    public ultimoPid: number | null = null;
    public trocaRestante = 0;
    public totalTrocas = 0;
    public quantumUsado = 0;

    public tempoUtil = 0;
    public tempoTroca = 0;
    public tempoOcioso = 0;

    executarUnidade(): boolean {
        if (!this.processoAtual) return false;

        const processo = this.processoAtual;
        const burst = obterBurstCPU(processo);

        processo.executado = (processo.executado ?? 0) + 1;

        return processo.executado >= burst.cpu;
    }
}

class SO {
    private processos: Processo[];
    private time: number = 0;
    private cpus: CPU[] = [];
    private fila_prontos: Processo[] = []; // prontos
    private ram: MemoriaRAM;
    private totalPageFaults = 0;
    private arquivoLog: number | null = null;
    private gantt: string[][] = []; // Uma linha por tick, com o evento de cada CPU
    private fault: number; // tempo de espera para page fault

    private fila_bloqueados: {
        processo: Processo;
        retorno: number; // tempo de retorno do bloqueio
        motivo: "es" | "page_fault" | "sem_vitima";
    }[] = [];

    constructor(
        num_cpus: number,
        private custoTroca: number = 1,
        private escalonador: Escalonador = "sjf",
        private quantum: number = 2,
        carga: Processo[] = [],
        quadros: number = 256,
        substituicao: "fifo" | "lru" = "fifo",
        fault: number = 20,
        private log: boolean = false
    ) {
        if (this.escalonador === "rr" && this.quantum <= 0) {
            throw new Error("O quantum deve ser maior que zero");
        }

        this.processos = structuredClone(carga);
        this.ram = new MemoriaRAM(quadros, substituicao);
        this.fault = fault;

        for (let i = 0; i < num_cpus; i++) {
            this.cpus.push(new CPU());
        }
    }

    execute() {
        // "w" recria/trunca logs.txt em TODA execucao, mesmo sem --log.
        this.arquivoLog = openSync("logs.txt", "w");

        try {
            return this.executarSimulacao();
        } finally {
            closeSync(this.arquivoLog);
            this.arquivoLog = null;
        }
    }

    private executarSimulacao() {
        let terminados = 0;
        this.registrar("INICIO DA SIMULACAO");

        while (terminados < this.processos.length) {
            const cpusAtivasNesteTick = new Set<CPU>();
            const eventosTick: string[] = Array(this.cpus.length).fill("OCIOSA");
            // 1. Verificar chegadas
            const chegadas = this.processos.filter(
                p => p.chegada === this.time
            );

            // 2. Verificar retornos de E/S e page fault.
            // Tratar chegadas e retornos por PID preserva a ordem original.
            const retornos = this.fila_bloqueados.filter(b => b.retorno === this.time);
            const eventos = [
                ...chegadas.map(p => ({ processo: p, tipo: "chegada" as const })),
                ...retornos.map(b => ({ processo: b.processo, tipo: "retorno" as const, bloqueio: b }))
            ].sort((a, b) => a.processo.pid - b.processo.pid);

            for (const evento of eventos) {
                const p = evento.processo;

                if (evento.tipo === "retorno") {
                    // Remover apenas este bloqueio antes de registrar o estado.
                    this.fila_bloqueados.splice(this.fila_bloqueados.indexOf(evento.bloqueio), 1);
                }

                p.estado = "pronto";
                p.entrouProntosEm = this.time;
                this.fila_prontos.push(p);

                const descricao = evento.tipo === "chegada"
                    ? "CHEGADA"
                    : evento.bloqueio.motivo === "es"
                        ? "RETORNO DE E/S"
                        : `RETORNO DE ${evento.bloqueio.motivo.toUpperCase()}`;
                this.registrar(descricao, p.pid);
            }

            // 3. Escolher escalonador
            if (this.escalonador === "sjf") {
                const ordemAnterior = this.fila_prontos.map(p => p.pid).join(",");
                this.fila_prontos = this.SJF();
                if (ordemAnterior !== this.fila_prontos.map(p => p.pid).join(",")) {
                    this.registrar("ORDENACAO DA FILA PELO SJF");
                }
            }

            // FCFS e RR mantêm a ordem da fila

            // Verificar preempções do Round Robin
            if (this.escalonador === "rr") {
                for (const cpu of this.cpus) {

                    if (!cpu.processoAtual) continue;
                    if (cpu.quantumUsado < this.quantum) continue;

                    if (this.fila_prontos.length > 0) {
                        const p = cpu.processoAtual;

                        p.estado = "pronto";
                        p.entrouProntosEm = this.time;

                        this.fila_prontos.push(p);

                        cpu.processoAtual = null;
                        cpu.disponivel = true;
                        cpu.quantumUsado = 0;

                        this.registrar("PREEMPCAO POR QUANTUM", p.pid);

                    } else {
                        // Ninguém esperando: continua com novo quantum
                        cpu.quantumUsado = 0;
                    }
                }
            }

            // CPUs que terminaram um burst neste instante
            const burstsConcluidos: CPU[] = [];

            // 4. Executar CPUs
            for (const [indiceCPU, cpu] of this.cpus.entries()) {

                while (true) {

                    // Despachar processo
                    if (cpu.disponivel) {
                        const p = this.fila_prontos.shift();
                        if (!p) break;

                        cpu.processoAtual = p;
                        cpu.disponivel = false;
                        p.estado = "executando";
                        cpu.quantumUsado = 0;

                        // Somar o tempo que ficou esperando na fila
                        p.tempoEspera = (p.tempoEspera ?? 0)
                            + (this.time - (p.entrouProntosEm ?? this.time));

                        // Registrar a primeira vez que recebeu uma CPU
                        if (p.primeiroDespacho === undefined) {
                            p.primeiroDespacho = this.time;
                        }

                        // Verificar se precisa de troca de contexto
                        if (cpu.ultimoPid !== p.pid) {
                            cpu.trocaRestante = this.custoTroca;

                            if (this.custoTroca > 0) {
                                cpu.totalTrocas++;
                            }
                        }

                        cpu.ultimoPid = p.pid;
                        this.registrar(`DESPACHO NA CPU ${indiceCPU}`, p.pid);
                    }

                    // Executar a troca de contexto, se necessária
                    if (cpu.trocaRestante > 0) {
                        cpu.trocaRestante--;

                        cpu.tempoTroca++;
                        cpusAtivasNesteTick.add(cpu);
                        eventosTick[indiceCPU] = "TROCA";

                        // O despacho ja ficou registrado com o estado da troca.
                        // Consome esta unidade de tempo sem executar o processo
                        break;
                    }

                    const p = cpu.processoAtual!;
                    const burst = obterBurstCPU(p);

                    const indice = p.executado ?? 0;
                    const pagina = burst.refs[indice];

                    if (pagina === undefined) {
                        throw new Error(`Referência inválida em P${p.pid}`);
                    }

                    // 5. Acessar RAM
                    const resultado = this.ram.acessar(p.pid, pagina);

                    if (resultado !== "hit") {

                        if (!p.faultPendente) {
                            this.totalPageFaults++;
                            p.faultPendente = true;
                        }

                        p.estado = "bloqueado";

                        this.fila_bloqueados.push({
                            processo: p,
                            retorno: this.time + this.fault,
                            motivo: resultado === "sem_vitima" ? "sem_vitima" : "page_fault"
                        });

                        cpu.processoAtual = null;
                        cpu.disponivel = true;
                        cpu.quantumUsado = 0;
                        this.registrar(
                            `${resultado === "sem_vitima" ? "SEM VITIMA" : "PAGE FAULT"} NA PAGINA ${pagina} (CPU ${indiceCPU}; RETORNO EM t=${this.time + this.fault})`,
                            p.pid
                        );
                        // Tentar outro processo na mesma CPU
                        continue;
                    }

                    p.faultPendente = false;

                    // 6. Executar uma unidade de CPU
                    const terminouBurst = cpu.executarUnidade();
                    cpu.tempoUtil++;
                    cpusAtivasNesteTick.add(cpu);
                    eventosTick[indiceCPU] = `P${p.pid}`;

                    if (this.escalonador === "rr") {
                        cpu.quantumUsado++;
                    }

                    // Execucao regular nao altera o estado do processo.
                    // Registramos o fim do burst na etapa 7, sem gerar um log por tick.
                    if (terminouBurst) {
                        burstsConcluidos.push(cpu);
                    }

                    break;
                }
            }

            // 7. Tratar bursts concluidos no fim da unidade
            for (const cpu of burstsConcluidos) {
                const p = cpu.processoAtual!;
                const indiceCPU = this.cpus.indexOf(cpu);
                const instante = this.time + 1;
                const indiceAtual = p.burstAtual ?? 0;
                const proximo = p.bursts[indiceAtual + 1];

                // O burst de CPU terminou, mas a transicao de estado ainda sera feita.
                this.registrar(`FIM DE BURST DE CPU NA CPU ${indiceCPU}`, p.pid, instante);

                if (proximo && "es" in proximo) {
                    const retorno = instante + proximo.es;
                    p.estado = "bloqueado";
                    p.burstAtual = indiceAtual + 2;
                    p.executado = 0;
                    this.fila_bloqueados.push({ processo: p, retorno, motivo: "es" });

                    cpu.processoAtual = null;
                    cpu.disponivel = true;
                    cpu.quantumUsado = 0;

                    this.registrar(`INICIO DE E/S (RETORNO EM t=${retorno})`, p.pid, instante);

                } else if (!proximo) {
                    p.estado = "terminado";
                    p.termino = instante;
                    this.ram.liberar(p.pid);
                    terminados++;

                    cpu.processoAtual = null;
                    cpu.disponivel = true;
                    cpu.quantumUsado = 0;

                    this.registrar("TERMINO DO PROCESSO", p.pid, instante);
                } else {
                    throw new Error(`Sequência de bursts inválida em P${p.pid}`);
                }
            }

            for (const cpu of this.cpus) {
                if (!cpusAtivasNesteTick.has(cpu)) {
                    cpu.tempoOcioso++;
                }
            }

            // Guardar apenas a janela 0-200 para o Gantt.
            if (this.time < 200) this.gantt.push(eventosTick);

            // 8. Avançar o relógio
            this.time++;
        }

        console.log(`Tempo total: ${this.time}`);
        console.log(`Page faults: ${this.totalPageFaults}`);

        //validacao de metricas
        for (const cpu of this.cpus) {
            const total = cpu.tempoUtil
                + cpu.tempoTroca
                + cpu.tempoOcioso;

            if (total !== this.time) {
                throw new Error("Contabilização de tempo da CPU incorreta");
            }
        }

        const metricas = this.calcularMetricas();
        this.registrar(`FIM DA SIMULACAO (MAKESPAN=${metricas.makespan}, PAGE FAULTS=${metricas.pageFaults})`);

        console.log("Resumo da simulação:");
        console.log(metricas);

        console.table(metricas.cpus);

        return metricas;
    }

    gerarGanttCSV(): string {
        const linhas = ["cpu,inicio,fim,evento"];

        for (let cpu = 0; cpu < this.cpus.length; cpu++) {
            let inicio = 0;
            let evento = this.gantt[0]?.[cpu] ?? "OCIOSA";

            // Intervalos [inicio, fim). Completa com OCIOSA se a simulacao
            // terminar antes do instante 200.
            for (let t = 1; t <= 200; t++) {
                const proximo = t === 200 ? null : (this.gantt[t]?.[cpu] ?? "OCIOSA");
                if (proximo !== evento) {
                    linhas.push(`${cpu},${inicio},${t},${evento}`);
                    inicio = t;
                    evento = proximo ?? "OCIOSA";
                }
            }
        }

        return linhas.join("\n") + "\n";
    }

    // Registra o evento e uma fotografia COMPLETA do estado logo apos a mudanca.
    // Grava diretamente em disco para nao manter o log inteiro em memoria.
    private registrar(evento: string, pid?: number, instante: number = this.time) {
        if (!this.log || this.arquivoLog === null) return;

        const prontos = this.fila_prontos.map(p => `P${p.pid}`).join(", ") || "vazia";
        const bloqueados = [...this.fila_bloqueados]
            .sort((a, b) => a.retorno - b.retorno || a.processo.pid - b.processo.pid)
            .map(b => `P${b.processo.pid} (retorno=${b.retorno}; ${b.motivo})`)
            .join(", ") || "nenhum";
        const cpus = this.cpus.map((cpu, i) => {
            if (!cpu.processoAtual) return `CPU ${i}: LIVRE`;
            const troca = cpu.trocaRestante > 0
                ? ` (trocando; restante=${cpu.trocaRestante})`
                : "";
            return `CPU ${i}: P${cpu.processoAtual.pid}${troca}`;
        }).join(" | ");
        const quadros = this.ram.visualizar();
        const ocupados = quadros.filter(p => p !== null).length;

        writeSync(this.arquivoLog,
            `[t=${instante}] EVENTO: ${evento} | PID: ${pid === undefined ? "-" : `P${pid}`}\n`
            + `  Prontos (em ordem): [${prontos}]\n`
            + `  Bloqueados: [${bloqueados}]\n`
            + `  ${cpus}\n`
            + `  RAM: ${ocupados}/${quadros.length} quadros ocupados\n\n`,
            undefined, "utf8"
        );
    }

    SJF(): Processo[] {
        return this.fila_prontos.sort((a, b) => {
            const burstA = obterBurstCPU(a);
            const burstB = obterBurstCPU(b);

            const restanteA = burstA.cpu - (a.executado ?? 0);
            const restanteB = burstB.cpu - (b.executado ?? 0);

            return restanteA - restanteB;
        });
    }

    calcularMetricas() {
        const total = this.processos.length;

        const soma = (valores: number[]) =>
            valores.reduce((a, b) => a + b, 0);

        const media = (valores: number[]) =>
            valores.length > 0 ? soma(valores) / valores.length : 0;

        // Métricas dos processos
        const esperas = this.processos.map(
            p => p.tempoEspera ?? 0
        );

        const respostas = this.processos.map(
            p => p.primeiroDespacho! - p.chegada
        );

        const turnarounds = this.processos.map(
            p => p.termino! - p.chegada
        );

        // Métricas das CPUs
        const metricasCPUs = this.cpus.map((cpu, indice) => ({
            cpu: indice,

            tempoUtil: cpu.tempoUtil,
            tempoTroca: cpu.tempoTroca,
            tempoOcioso: cpu.tempoOcioso,

            utilizacao: this.time > 0
                ? ((cpu.tempoUtil + cpu.tempoTroca) / this.time) * 100
                : 0,

            percentualUtil: this.time > 0
                ? (cpu.tempoUtil / this.time) * 100
                : 0,

            percentualTroca: this.time > 0
                ? (cpu.tempoTroca / this.time) * 100
                : 0,

            percentualOcioso: this.time > 0
                ? (cpu.tempoOcioso / this.time) * 100
                : 0,

            totalTrocas: cpu.totalTrocas
        }));

        const totalTrocas = soma(
            this.cpus.map(cpu => cpu.totalTrocas)
        );

        // Cada unidade útil representa uma referência lógica à memória
        const totalReferencias = soma(
            this.cpus.map(cpu => cpu.tempoUtil)
        );

        return {
            processos: total,

            esperaMedia: media(esperas),
            esperaMaxima: Math.max(0, ...esperas),

            respostaMedia: media(respostas),
            turnaroundMedio: media(turnarounds),

            makespan: this.time,

            totalTrocas,

            pageFaults: this.totalPageFaults,
            taxaPageFaults: totalReferencias > 0
                ? (this.totalPageFaults / totalReferencias) * 100
                : 0,

            cpus: metricasCPUs
        };
    }

}

// Leitura dos argumentos de linha de comando.
function lerArgumentos(args: string[]) {
    const aceitos = new Set([
        "--arquivo", "--cpus", "--sched", "--quantum", "--subst",
        "--quadros", "--custo-troca", "--fault", "--saida"
    ]);
    const valores = new Map<string, string>();
    let log = false;

    for (let i = 0; i < args.length; i++) {
        const chave = args[i]!;
        if (chave === "--log") {
            log = true;
            continue;
        }
        if (!aceitos.has(chave)) throw new Error(`Argumento desconhecido: ${chave}`);
        const valor = args[++i];
        if (!valor || valor.startsWith("--")) {
            throw new Error(`Informe um valor para ${chave}`);
        }
        valores.set(chave, valor);
    }

    const arquivo = valores.get("--arquivo");
    if (!arquivo) throw new Error("Uso: --arquivo <caminho.json> [--cpus 1|4] [--sched fcfs|sjf|rr] ...");

    const inteiro = (nome: string, padrao: number, minimo: number) => {
        const texto = valores.get(nome);
        if (texto === undefined) return padrao;
        const numero = Number(texto);
        if (!Number.isInteger(numero) || numero < minimo) {
            throw new Error(`${nome} deve ser um inteiro >= ${minimo}`);
        }
        return numero;
    };

    const cpus = inteiro("--cpus", 1, 1);
    if (![1, 4].includes(cpus)) throw new Error("--cpus deve ser 1 ou 4");

    const sched = valores.get("--sched") ?? "fcfs";
    if (!["fcfs", "sjf", "rr"].includes(sched)) {
        throw new Error("--sched deve ser fcfs, sjf ou rr");
    }

    const subst = valores.get("--subst") ?? "fifo";
    if (!["fifo", "lru"].includes(subst)) {
        throw new Error("--subst deve ser fifo ou lru");
    }

    return {
        arquivo,
        cpus,
        sched: sched as Escalonador,
        quantum: inteiro("--quantum", 2, 1),
        subst: subst as "fifo" | "lru",
        quadros: inteiro("--quadros", 256, 1),
        custoTroca: inteiro("--custo-troca", 1, 0),
        fault: inteiro("--fault", 20, 1),
        saida: valores.get("--saida") ?? "resultados",
        log
    };
}

function lerProcessos(arquivo: string): Processo[] {
    return JSON.parse(readFileSync(arquivo, "utf8")) as Processo[];
}

function salvarResultados(
    opcoes: ReturnType<typeof lerArgumentos>,
    metricas: ReturnType<SO["execute"]>,
    ganttCSV: string
) {
    const cenario = parse(opcoes.arquivo).name;
    const nome = `${cenario}_${opcoes.cpus}cpu_${opcoes.sched}`
        + (opcoes.sched === "rr" ? `_q${opcoes.quantum}` : "")
        + `_${opcoes.subst}_${opcoes.quadros}quadros_t${opcoes.custoTroca}_f${opcoes.fault}`;
    const pasta = join(opcoes.saida, nome);
    mkdirSync(pasta, { recursive: true });

    const parametros = {
        cenario,
        cpus: opcoes.cpus,
        escalonador: opcoes.sched,
        quantum: opcoes.sched === "rr" ? opcoes.quantum : null,
        substituicao: opcoes.subst,
        quadros: opcoes.quadros,
        custoTroca: opcoes.custoTroca,
        fault: opcoes.fault
    };

    writeFileSync(join(pasta, "metricas.json"),
        JSON.stringify({ parametros, ...metricas }, null, 2), "utf8");

    const { cpus, ...globais } = metricas;
    const soma = (campo: "tempoUtil" | "tempoTroca" | "tempoOcioso") =>
        cpus.reduce((total, cpu) => total + cpu[campo], 0);

    const registroCSV = {
        ...parametros,
        ...globais,
        tempoUtilTotal: soma("tempoUtil"),
        tempoTrocaTotal: soma("tempoTroca"),
        tempoOciosoTotal: soma("tempoOcioso"),
        utilizacaoMedia: cpus.reduce((total, cpu) => total + cpu.utilizacao, 0) / cpus.length
    };
    const campos = Object.keys(registroCSV);
    const escapar = (valor: unknown) => {
        const texto = valor == null ? "" : String(valor);
        return /[,"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    };
    const csv = campos.join(",") + "\n"
        + Object.values(registroCSV).map(escapar).join(",") + "\n";
    writeFileSync(join(pasta, "metricas.csv"), csv, "utf8");
    writeFileSync(join(pasta, "gantt.csv"), ganttCSV, "utf8");

    console.log(`Arquivos salvos em: ${pasta}`);
}

try {
    const opcoes = lerArgumentos(process.argv.slice(2));
    const carga = lerProcessos(opcoes.arquivo);

    console.log(`Carregados ${carga.length} processos de ${opcoes.arquivo}`);
    console.log(`CPUs=${opcoes.cpus} sched=${opcoes.sched} Q=${opcoes.quantum} RAM=${opcoes.quadros} subst=${opcoes.subst} custoTroca=${opcoes.custoTroca} fault=${opcoes.fault}`);

    const so = new SO(
        opcoes.cpus,
        opcoes.custoTroca,
        opcoes.sched,
        opcoes.quantum,
        carga,
        opcoes.quadros,
        opcoes.subst,
        opcoes.fault,
        opcoes.log
    );
    const metricas = so.execute();
    salvarResultados(opcoes, metricas, so.gerarGanttCSV());
} catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
}
