// Entry de execução parada (web/npm dev e bundle CJS).
// O app desktop (Electron) requer este mesmo bundle e chama
// startWriterServer() sem auto-pitar, usando WRITER_IN_PROCESS.
import { startWriterServer } from './index.ts';
export * from './index.ts';

if (process.env.WRITER_IN_PROCESS !== '1' && process.env.NODE_ENV !== 'test') {
  startWriterServer({}).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}