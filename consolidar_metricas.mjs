import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.argv[2] ?? 'resultados';
if (!existsSync(raiz)) {
  console.error(`Pasta nao encontrada: ${raiz}`);
  process.exit(1);
}

const registros = [];
for (const pasta of readdirSync(raiz, { withFileTypes: true })) {
  if (!pasta.isDirectory()) continue;
  const caminho = join(raiz, pasta.name, 'metricas.json');
  if (!existsSync(caminho)) continue;
  const dado = JSON.parse(readFileSync(caminho, 'utf8'));
  const p = dado.parametros;
  // Ignorar exercicios de teste e configuracoes fora da matriz padrao.
  if (!p || !['cenario_A_t0', 'cenario_B_espacadas'].includes(p.cenario)) continue;
  if (p.quadros !== 256 || p.custoTroca !== 1 || p.fault !== 20) continue;
  const cpus = dado.cpus ?? [];
  const soma = (campo) => cpus.reduce((acc, cpu) => acc + (cpu[campo] ?? 0), 0);
  const utilizacaoMedia = cpus.length
    ? cpus.reduce((acc, cpu) => acc + (cpu.utilizacao ?? 0), 0) / cpus.length
    : 0;
  registros.push({
    cenario: p.cenario,
    cpus: p.cpus,
    escalonador: p.escalonador,
    quantum: p.quantum,
    substituicao: p.substituicao,
    quadros: p.quadros,
    custoTroca: p.custoTroca,
    fault: p.fault,
    processos: dado.processos,
    esperaMedia: dado.esperaMedia,
    esperaMaxima: dado.esperaMaxima,
    respostaMedia: dado.respostaMedia,
    turnaroundMedio: dado.turnaroundMedio,
    makespan: dado.makespan,
    totalTrocas: dado.totalTrocas,
    pageFaults: dado.pageFaults,
    taxaPageFaults: dado.taxaPageFaults,
    tempoUtilTotal: soma('tempoUtil'),
    tempoTrocaTotal: soma('tempoTroca'),
    tempoOciosoTotal: soma('tempoOcioso'),
    utilizacaoMedia
  });
}

const ordem = { fcfs: 0, sjf: 1, rr: 2 };
registros.sort((a, b) => a.cenario.localeCompare(b.cenario)
  || a.cpus - b.cpus || ordem[a.escalonador] - ordem[b.escalonador]
  || (a.quantum ?? 0) - (b.quantum ?? 0)
  || a.substituicao.localeCompare(b.substituicao));

function salvarCSV(nome, linhas, campos) {
  const escapar = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = campos.join(',') + '\n'
    + linhas.map((r) => campos.map((campo) => escapar(r[campo])).join(',')).join('\n') + '\n';
  writeFileSync(join(raiz, nome), texto, 'utf8');
  console.log(`Criado: ${join(raiz, nome)} (${linhas.length} linhas)`);
}

const camposResumo = ['cenario', 'cpus', 'escalonador', 'quantum', 'substituicao', 'quadros',
  'custoTroca', 'fault', 'processos', 'esperaMedia', 'esperaMaxima', 'respostaMedia',
  'turnaroundMedio', 'makespan', 'totalTrocas', 'pageFaults', 'taxaPageFaults',
  'tempoUtilTotal', 'tempoTrocaTotal', 'tempoOciosoTotal', 'utilizacaoMedia'];
salvarCSV('resumo_geral.csv', registros, camposResumo);

const grupo = (r) => [r.cenario, r.escalonador, r.quantum ?? '-', r.substituicao,
  r.quadros, r.custoTroca, r.fault].join('|');
const grupos = new Map();
for (const r of registros) {
  const chave = grupo(r);
  if (!grupos.has(chave)) grupos.set(chave, new Map());
  grupos.get(chave).set(r.cpus, r);
}
const speedups = [];
for (const g of grupos.values()) {
  const um = g.get(1);
  const quatro = g.get(4);
  if (!um || !quatro || quatro.makespan === 0) continue;
  const speedup = um.makespan / quatro.makespan;
  speedups.push({
    cenario: um.cenario, escalonador: um.escalonador, quantum: um.quantum,
    substituicao: um.substituicao, makespan1CPU: um.makespan,
    makespan4CPUs: quatro.makespan, speedup, eficiencia: speedup / 4
  });
}
speedups.sort((a,b) => a.cenario.localeCompare(b.cenario) || ordem[a.escalonador] - ordem[b.escalonador]
  || (a.quantum ?? 0) - (b.quantum ?? 0));
salvarCSV('speedup_eficiencia.csv', speedups,
  ['cenario', 'escalonador', 'quantum', 'substituicao', 'makespan1CPU', 'makespan4CPUs', 'speedup', 'eficiencia']);

const paresMemoria = new Map();
for (const r of registros) {
  const chave = [r.cenario, r.cpus, r.escalonador, r.quantum ?? '-'].join('|');
  if (!paresMemoria.has(chave)) paresMemoria.set(chave, new Map());
  paresMemoria.get(chave).set(r.substituicao, r);
}
const comparacoes = [];
for (const par of paresMemoria.values()) {
  const fifo = par.get('fifo');
  const lru = par.get('lru');
  if (!fifo || !lru) continue;
  comparacoes.push({
    cenario: fifo.cenario, cpus: fifo.cpus, escalonador: fifo.escalonador,
    quantum: fifo.quantum, faultsFIFO: fifo.pageFaults, faultsLRU: lru.pageFaults,
    diferencaFaultsFIFOmenosLRU: fifo.pageFaults - lru.pageFaults,
    makespanFIFO: fifo.makespan, makespanLRU: lru.makespan,
    diferencaMakespanFIFOmenosLRU: fifo.makespan - lru.makespan
  });
}
comparacoes.sort((a,b) => a.cenario.localeCompare(b.cenario) || a.cpus-b.cpus);
salvarCSV('comparacao_fifo_lru.csv', comparacoes,
  ['cenario', 'cpus', 'escalonador', 'quantum', 'faultsFIFO', 'faultsLRU',
   'diferencaFaultsFIFOmenosLRU', 'makespanFIFO', 'makespanLRU', 'diferencaMakespanFIFOmenosLRU']);

console.log(`Resumo: ${registros.length} configuracoes encontradas. Esperado: 24 (minimo) ou 32 (completo).`);
