// Tipos mínimos para o import dinâmico de `electron` (safeStorage) —
// o Writer também roda como servidor web simples, onde o módulo
// not exist. Aqui só descrevemos a parte que usamos.
declare module 'electron' {
  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(text: string): Buffer;
    decryptString(buffer: Buffer): string;
  };
}