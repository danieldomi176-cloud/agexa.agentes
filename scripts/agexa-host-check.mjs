/** Read-only host inventory. Never installs a service or downloads a model. */
import * as fs from 'node:fs';
import * as os from 'node:os';
const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
};
const exists = (p) => fs.existsSync(p);
const memory = read('/sys/fs/cgroup/memory.max');
const cpu = read('/sys/fs/cgroup/cpu.max')?.split(' ');
const disk = fs.statfsSync(process.cwd());
const result = {
  checkedAt: new Date().toISOString(),
  scope:
    'Only the machine executing this command. A cloud result does not describe the CEO computer.',
  os: os.platform(),
  architecture: os.arch(),
  node: process.versions.node,
  logicalCpus: os.availableParallelism(),
  cpuQuota: cpu && cpu[0] !== 'max' ? Number(cpu[0]) / Number(cpu[1]) : null,
  hostMemoryGiB: Math.round(os.totalmem() / 2 ** 30),
  hostFreeMemoryGiB: Math.round(os.freemem() / 2 ** 30),
  cgroupMemoryGiB: memory && memory !== 'max' ? Number(memory) / 2 ** 30 : null,
  diskFreeGiB: Math.round((disk.bavail * disk.bsize) / 2 ** 30),
  linuxGpuDeviceExposed: exists('/dev/dri/renderD128') || exists('/dev/nvidia0'),
  gpuNote:
    'A device node is not a GPU compatibility or acceleration benchmark. On macOS/Windows inspect system hardware separately.',
};
try {
  const r = await fetch('http://127.0.0.1:11434/api/tags', {
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  });
  const tags = r.ok ? await r.json() : null;
  result.ollama = {
    reachable: r.ok,
    models: Array.isArray(tags?.models) ? tags.models.slice(0, 100).map((m) => m.name) : [],
    note: 'Reachability and installed names do not prove inference.',
  };
} catch (error) {
  result.ollama = { reachable: false, error: error.cause?.code ?? error.message, models: [] };
}
console.log(JSON.stringify(result, null, 2));
