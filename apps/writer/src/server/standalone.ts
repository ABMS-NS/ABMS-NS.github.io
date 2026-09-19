// Entry de execução (web/npm dev e bundle CJS). Em NODE_ENV=test ou
// WRITER_IN_PROCESS=1, apenas expõe startWriterServer para quem quiser
// embutir o servidor no próprio processo.
import { startWriterServer } from './index.ts';
export * from './index.ts';

if (process.env.WRITER_IN_PROCESS !== '1' && process.env.NODE_ENV !== 'test') {
  startWriterServer({}).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}