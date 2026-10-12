import { mkdtemp, symlink, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
// Vite decodes its HTML filename. A literal '%' in a checkout path (like '1%')
// otherwise throws URIError. Serve the same files through a temporary symlink.
const temporary = project.includes('%') ? await mkdtemp(join(tmpdir(), 'one-percent-preview-')) : null;
const root = temporary ? join(temporary, 'project') : project;
if (temporary) await symlink(project, root, 'dir');
const { createServer } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);
const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 5173;
const server = await createServer({
  configFile: false,
  root,
  resolve: { preserveSymlinks: true },
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();
server.printUrls();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  if (temporary) { await unlink(root); await rmdir(temporary); }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
