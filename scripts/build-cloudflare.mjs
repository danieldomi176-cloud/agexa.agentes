import { build } from 'esbuild';
import { mkdir, cp, writeFile } from 'node:fs/promises';
await build({
  entryPoints: ['cloudflare/src/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'cloudflare/dist/worker.js',
});
await mkdir('cloudflare/public', { recursive: true });
await cp('webview-ui/public/assets/characters', 'cloudflare/public/characters', {
  recursive: true,
});
await writeFile(
  'cloudflare/public/index.html',
  `<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AGEXA privado</title><style>body{background:#15121f;color:#eee;font-family:monospace}section{display:flex;flex-wrap:wrap}article{border:2px solid #9470cc;padding:12px;margin:8px}img{image-rendering:pixelated;width:64px;height:64px;object-fit:none;object-position:left top}button{padding:10px}</style><h1>AGEXA — controlo privado</h1><p>Estados do backend D1. Sem ligação, os dados ficam indisponíveis.</p><button data-action="pause">Pausar</button><button data-action="resume">Retomar</button><button data-action="stop">Emergência</button><section></section><pre></pre><script>const out=document.querySelector('pre');async function update(){try{const r=await fetch('/api/state');if(!r.ok)throw Error('Autenticação/backend indisponível');const s=await r.json();const box=document.querySelector('section');box.replaceChildren();for(const e of s.employees){const a=document.createElement('article'),i=document.createElement('img'),t=document.createElement('p');i.src='/characters/char_'+e.palette+'.png';t.textContent=e.name+' — '+e.role+' — '+(e.enabled?'habilitado':'pausado');a.append(i,t);box.append(a);}out.textContent=JSON.stringify(s,null,2);}catch{out.textContent='Dados indisponíveis; verificar sessão e configuração';}setTimeout(update,10000);}for(const b of document.querySelectorAll('button'))b.onclick=async()=>{if(!confirm('Confirmar '+b.dataset.action+'?'))return;const r=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.dataset.action,confirm:true})});if(!r.ok)alert('Ação recusada');};update();</script></html>`,
);
console.log('Worker bundled without Node runtime; private panel uses original sprites. No deploy.');
