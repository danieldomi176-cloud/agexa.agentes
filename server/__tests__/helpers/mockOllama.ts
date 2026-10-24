/** TEST ONLY: contract emulator, never a model or evidence of real AI inference. */
import { createServer } from 'node:http';

import { PLAN_ORDER } from '../../../core/src/intelligence.js';

export async function mockOllama() {
  const calls: Array<{ employeeId: string; system: string; input: Record<string, unknown> }> = [];
  const control = { mode: 'valid', delayMs: 0, failEmployee: '', models: ['agexa-test:tiny'] };
  const server = createServer(async (req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ models: control.models.map((name) => ({ name })) }));
      return;
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    const system = request.messages[0].content;
    const input = JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n')) as {
      employeeId: string;
      context: Record<string, unknown>;
    };
    calls.push({ employeeId: input.employeeId, system, input: input.context });
    const reply = () => {
      if (res.destroyed) return;
      if (control.mode === 'http_error') {
        res.writeHead(503).end();
        return;
      }
      if (control.mode === 'redirect') {
        res.writeHead(302, { Location: 'http://example.invalid/api/chat' }).end();
        return;
      }
      const result: Record<string, unknown> = {
        summary: `RESULTADO SIMULADO: ${input.employeeId}`,
        draft: '',
        observations: ['Dados exclusivamente de teste'],
        nextActions: ['Revisão do CEO'],
      };
      if (system.includes('Acrescenta plan'))
        result.plan = PLAN_ORDER.map((employeeId) => ({
          employeeId,
          objective: `SIMULAÇÃO: preparar etapa comercial de ${employeeId}`,
        }));
      if (control.mode === 'invalid' || control.failEmployee === input.employeeId)
        delete result.summary;
      if (control.mode === 'injection') result.shell = 'rm -rf /';
      if (control.mode === 'offer')
        result.draft = 'Experimenta grátis durante 7 dias em https://nao-confirmado.invalid';
      if (control.mode === 'bad_plan' && Array.isArray(result.plan))
        (result.plan as { employeeId: string }[])[0].employeeId = 'nexus';
      const content = control.mode === 'invalid_json' ? 'not-json' : JSON.stringify(result);
      const output =
        control.mode === 'large'
          ? 'x'.repeat(300000)
          : JSON.stringify({
              model: request.model,
              done: control.mode !== 'incomplete',
              message: {
                content,
                thinking: 'TEST ONLY: internal reasoning must never be persisted',
              },
            });
      res.setHeader('Content-Type', 'application/json');
      res.end(output);
    };
    if (control.delayMs) {
      const timer = setTimeout(reply, control.delayMs);
      res.once('close', () => clearTimeout(timer));
    } else reply();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock listen failed');
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    control,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
