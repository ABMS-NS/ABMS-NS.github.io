// Autenticação do Writer.
//
// Uma senha principal protege as operações que mexem no seu arquivo
// (publicar, enviar ao GitHub, apagar conteúdo...). A senha NUNCA é
// armazenada em texto puro: guardamos apenas um hash scrypt com salt
// próprio. No aplicativo desktop (Electron) o arquivo de configuração
// é criptografado com o safeStorage do sistema operacional (DPAPI no
// Windows, Keychain no macOS, libsecret no Linux). Em execução normal,
// o token de sessão existe apenas em memória — fechou o app, acabou.
//
// Também mora aqui a política de "sessão recente": operações
// destrutivas (publicar, push, exclusões) exigem a digitação da senha
// de novo, e tentativas falhas são limitadas com backoff exponencial
// para atrasar ataques de força bruta.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scrypt = promisify(scryptCb);

const SALT_LEN = 16;
const KEY_LEN = 64;
const MIN_PASSWORD = 8;
const DEFAULT_IDLE_MINUTES = 15;
const DEFAULT_RECENT_MINUTES = 5;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

// safeStorage só existe dentro do processo principal do Electron.
// Fora dele (npm run dev, node dist/writer.cjs) usamos arquivo em
// texto simples — o hash scrypt continua protegendo a senha real.
interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(buffer: Buffer): string;
}

interface AuthConfig {
  v: 1;
  salt: string; // base64
  hash: string; // base64, scrypt de KEY_LEN bytes
  idleTimeoutMinutes: number; // -1 = nunca
  recentWindowMinutes: number;
}

// Formato do arquivo em disco. Quando há safeStorage, o "enc" guarda
// o JSON da config cifrado; senão, "cfg" fica em texto (apenas o hash).
interface FileEnvelope {
  v: 1;
  cfg?: AuthConfig;
  enc?: string; // base64 da config cifrada
}

interface Session {
  createdAt: number;
  lastActivity: number;
  recentAt: number;
}

export interface AuthStatus {
  configured: boolean;
  idleTimeoutMinutes: number;
  recentWindowMinutes: number;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

export class AuthService {
  private cfg: AuthConfig | null = null;
  private readonly sessions = new Map<string, Session>();
  private failures = 0;
  private lockedUntil = 0;
  private readonly dataDir: string;
  private readonly cfgPath: string;
  private safeStoragePromise: Promise<ElectronSafeStorage | null> | null = null;

  constructor(dataDir?: string) {
    this.dataDir =
      dataDir ?? process.env.WRITER_DATA_DIR ?? path.join(os.homedir(), '.writer');
    this.cfgPath = path.join(this.dataDir, 'auth.json');
  }

  // ------------------------------------------------------------------
  // Persistência
  // ------------------------------------------------------------------

  async init(): Promise<void> {
    try {
      if (!existsSync(this.cfgPath)) {
        this.cfg = null;
        return;
      }
      const raw = JSON.parse(readFileSync(this.cfgPath, 'utf-8')) as FileEnvelope;
      let cfg: AuthConfig | undefined;
      if (raw.enc) {
        const safe = await this.safeStorage();
        if (!safe) {
          console.warn(
            '[auth] config de senha cifrada, mas safeStorage indisponível agora. A senha será redefinida.',
          );
          this.cfg = null;
          return;
        }
        cfg = JSON.parse(safe.decryptString(Buffer.from(raw.enc, 'base64'))) as AuthConfig;
      } else {
        cfg = raw.cfg;
      }
      if (cfg && typeof cfg.hash === 'string' && typeof cfg.salt === 'string') {
        this.cfg = {
          v: 1,
          salt: cfg.salt,
          hash: cfg.hash,
          idleTimeoutMinutes: clampInt(
            cfg.idleTimeoutMinutes,
            -1,
            24 * 60,
            DEFAULT_IDLE_MINUTES,
          ),
          recentWindowMinutes: clampInt(
            cfg.recentWindowMinutes,
            1,
            60,
            DEFAULT_RECENT_MINUTES,
          ),
        };
      } else {
        this.cfg = null;
      }
    } catch (err) {
      console.warn('[auth] não consegui ler a configuração de senha:', (err as Error).message);
      this.cfg = null;
    }
  }

  private async save(): Promise<void> {
    if (!this.cfg) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    const safe = await this.safeStorage();
    const envelope: FileEnvelope = safe
      ? { v: 1, enc: safe.encryptString(JSON.stringify(this.cfg)).toString('base64') }
      : { v: 1, cfg: this.cfg };
    await fs.writeFile(this.cfgPath, JSON.stringify(envelope), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  private safeStorage(): Promise<ElectronSafeStorage | null> {
    if (!this.safeStoragePromise) {
      this.safeStoragePromise = (async () => {
        try {
          const el = (await import('electron')) as {
            safeStorage?: ElectronSafeStorage;
          };
          return el.safeStorage && el.safeStorage.isEncryptionAvailable()
            ? el.safeStorage
            : null;
        } catch {
          return null;
        }
      })();
    }
    return this.safeStoragePromise;
  }

  // ------------------------------------------------------------------
  // Senha
  // ------------------------------------------------------------------

  isConfigured(): boolean {
    return this.cfg !== null;
  }

  validPassword(p: unknown): p is string {
    return typeof p === 'string' && p.length >= MIN_PASSWORD;
  }

  // Verifica a senha aplicando backoff exponencial quando há falhas
  // seguidas. Senha certa zera o contador de tentativas.
  async verifyPassword(password: string): Promise<{
    ok: boolean;
    locked: boolean;
    retryAfterSec?: number;
  }> {
    const now = Date.now();
    if (now < this.lockedUntil) {
      return {
        ok: false,
        locked: true,
        retryAfterSec: Math.max(1, Math.ceil((this.lockedUntil - now) / 1000)),
      };
    }
    // Sem senha configurada ou campo vazio: falta de protocolo, não
    // força bruta — não conta como tentativa.
    if (!this.cfg || typeof password !== 'string' || password.length === 0) {
      return { ok: false, locked: false };
    }
    // Senha curta demais para ser válida AINDA é uma tentativa real de
    // login errado — conta para o backoff.
    if (password.length < MIN_PASSWORD) {
      this.failures += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 2 ** Math.min(this.failures, 9) * 1000);
      this.lockedUntil = Date.now() + backoff;
      return { ok: false, locked: true, retryAfterSec: Math.ceil(backoff / 1000) };
    }
    const salt = Buffer.from(this.cfg.salt, 'base64');
    const expected = Buffer.from(this.cfg.hash, 'base64');
    const actual = (await scrypt(password, salt, KEY_LEN)) as Buffer;
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (ok) {
      this.failures = 0;
      this.lockedUntil = 0;
      return { ok: true, locked: false };
    }
    this.failures += 1;
    const backoff = Math.min(MAX_BACKOFF_MS, 2 ** Math.min(this.failures, 9) * 1000);
    this.lockedUntil = now + backoff;
    return { ok: false, locked: true, retryAfterSec: Math.ceil(backoff / 1000) };
  }

  async setup(password: string): Promise<string> {
    if (this.cfg) throw new Error('O Writer já tem uma senha definida.');
    if (!this.validPassword(password)) {
      throw new Error(`A senha precisa ter ao menos ${MIN_PASSWORD} caracteres.`);
    }
    const salt = randomBytes(SALT_LEN);
    const hash = (await scrypt(password, salt, KEY_LEN)) as Buffer;
    this.cfg = {
      v: 1,
      salt: salt.toString('base64'),
      hash: hash.toString('base64'),
      idleTimeoutMinutes: DEFAULT_IDLE_MINUTES,
      recentWindowMinutes: DEFAULT_RECENT_MINUTES,
    };
    await this.save();
    return this.createSession();
  }

  // Troca de senha: exige a senha atual (a própria verificação já tem
  // proteção de força bruta). Invalida todas as sessões no fim.
  async changePassword(
    current: string,
    next: string,
  ): Promise<'ok' | 'wrong' | 'weak'> {
    if (!this.validPassword(next)) return 'weak';
    if (!this.cfg) return 'wrong';
    const v = await this.verifyPassword(current);
    if (!v.ok) return 'wrong';
    const salt = randomBytes(SALT_LEN);
    const hash = (await scrypt(next, salt, KEY_LEN)) as Buffer;
    this.cfg.salt = salt.toString('base64');
    this.cfg.hash = hash.toString('base64');
    await this.save();
    this.sessions.clear();
    return 'ok';
  }

  // Caminho de recuperação ("esqueci a senha"): apaga a config e
  // permite reconfigurar do zero. Local app, apenas zona de risco se
  // alguém já tiver acesso físico ao computador.
  async resetRecovery(): Promise<void> {
    this.sessions.clear();
    this.failures = 0;
    this.lockedUntil = 0;
    this.cfg = null;
    await fs.rm(this.cfgPath, { force: true });
  }

  // ------------------------------------------------------------------
  // Sessões (memória)
  // ------------------------------------------------------------------

  createSession(): string {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.sessions.set(token, { createdAt: now, lastActivity: now, recentAt: now });
    return token;
  }

  async unlock(
    password: string,
  ): Promise<{
    ok: boolean;
    locked?: boolean;
    token?: string;
    retryAfterSec?: number;
  }> {
    const v = await this.verifyPassword(password);
    if (!v.ok) return v;
    return { ok: true, token: this.createSession() };
  }

  lockAll(): void {
    this.sessions.clear();
  }

  private idleMs(): number {
    const m = this.cfg?.idleTimeoutMinutes ?? DEFAULT_IDLE_MINUTES;
    return m < 0 ? Infinity : m * 60 * 1000;
  }

  // Valida a sessão contra o timeout de inatividade. Com `refresh`
  // (padrão) atualiza o relógio de atividade — usado por pedidos reais.
  // Sem `refresh`, apenas consulta — usado pelo poll de bloqueio.
  touch(token: string, refresh = true): boolean {
    const s = this.sessions.get(token);
    if (!s) return false;
    const now = Date.now();
    if (now - s.lastActivity > this.idleMs()) {
      this.sessions.delete(token);
      return false;
    }
    if (refresh) s.lastActivity = now;
    return true;
  }

  hasSession(token: string): boolean {
    return this.sessions.has(token);
  }

  // ------------------------------------------------------------------
  // "Sessão recente"
  // ------------------------------------------------------------------

  marksRecent(token: string): void {
    const s = this.sessions.get(token);
    if (s) s.recentAt = Date.now();
  }

  isRecent(token: string): boolean {
    const s = this.sessions.get(token);
    if (!s) return false;
    const m = this.cfg?.recentWindowMinutes ?? DEFAULT_RECENT_MINUTES;
    if (m < 0) return true;
    return Date.now() - s.recentAt <= m * 60 * 1000;
  }

  // ------------------------------------------------------------------
  // Leitura / configuração
  // ------------------------------------------------------------------

  status(): AuthStatus {
    return {
      configured: this.isConfigured(),
      idleTimeoutMinutes: this.cfg?.idleTimeoutMinutes ?? DEFAULT_IDLE_MINUTES,
      recentWindowMinutes: this.cfg?.recentWindowMinutes ?? DEFAULT_RECENT_MINUTES,
    };
  }

  async setSettings(patch: {
    idleTimeoutMinutes?: number;
    recentWindowMinutes?: number;
  }): Promise<AuthStatus> {
    if (!this.cfg) throw new Error('O Writer ainda não tem senha.');
    if (patch.idleTimeoutMinutes !== undefined) {
      // -1 = nunca travar por inatividade.
      this.cfg.idleTimeoutMinutes = clampInt(
        patch.idleTimeoutMinutes,
        -1,
        24 * 60,
        this.cfg.idleTimeoutMinutes,
      );
    }
    if (patch.recentWindowMinutes !== undefined) {
      this.cfg.recentWindowMinutes = clampInt(
        patch.recentWindowMinutes,
        1,
        60,
        this.cfg.recentWindowMinutes,
      );
    }
    await this.save();
    return this.status();
  }
}