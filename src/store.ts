import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { CreateVoucherResultDto, VoucherInfoResultDto } from '@arcasdk/core';
import type { Draft, IVoucher } from './invoice.js';
import type { EmisorData } from '@arcasdk/pdf';
import type { IssuerStorage } from './issuer.js';

export type Status = 'draft' | 'issuing' | 'uncertain' | 'authorized' | 'rejected' | 'cancelled';
export interface Record {
  id: string; userId: number; step: string; status: Status; draft: Partial<Draft>;
  createdAt: string; payload?: IVoucher; cae?: string; expiration?: string; detail?: string;
  arcaResponse?: CreateVoucherResultDto;
  arcaConsultation?: VoucherInfoResultDto;
  issuer?: EmisorData;
  sourceInvoiceId?: string;
}

export interface Repository {
  save(r: Record): Promise<void>;
  get(id: string, userId: number): Promise<Record | undefined>;
  active(userId: number): Promise<Record | undefined>;
  pending(): Promise<Record | undefined>;
  list(userId: number): Promise<Record[]>;
  create(userId: number): Promise<Record>;
  creditFor(invoiceId: string): Promise<Record | undefined>;
  getPdf(id: string, userId: number): Promise<Buffer | undefined>;
  savePdf(id: string, userId: number, pdf: Buffer): Promise<void>;
}

export class Store implements Repository, IssuerStorage {
  private client: pg.Client;
  constructor(url: string, private context: string, ssl = false) {
    this.client = new pg.Client({ connectionString: url, ssl: ssl ? { rejectUnauthorized: true } : undefined,
      connectionTimeoutMillis: 10000, query_timeout: 15000 });
    this.client.on('error', () => {
      console.error('Se perdió la conexión con PostgreSQL. El bot se detiene para preservar el bloqueo de emisión.');
      process.exit(1);
    });
  }
  async open() {
    await this.client.connect();
    const lock = await this.client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [this.context]);
    if (!lock.rows[0].locked) throw new Error('Ya hay otro bot conectado para este CUIT y punto de venta.');
    await this.client.query(`CREATE TABLE IF NOT EXISTS arca_bot_invoices (
      context TEXT NOT NULL, id UUID NOT NULL, user_id BIGINT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','issuing','uncertain','authorized','rejected','cancelled')),
      body JSONB NOT NULL, pdf BYTEA, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(context,id));
      CREATE UNIQUE INDEX IF NOT EXISTS arca_bot_one_emission ON arca_bot_invoices(context) WHERE status IN ('issuing','uncertain');
      CREATE UNIQUE INDEX IF NOT EXISTS arca_bot_one_draft ON arca_bot_invoices(context,user_id) WHERE status='draft';`);
    await this.client.query(`CREATE UNIQUE INDEX IF NOT EXISTS arca_bot_one_total_credit
      ON arca_bot_invoices(context,(body->>'sourceInvoiceId'))
      WHERE body->>'sourceInvoiceId' IS NOT NULL AND status IN ('draft','issuing','uncertain','authorized')`);
    await this.client.query(`CREATE TABLE IF NOT EXISTS arca_bot_issuer (
      context TEXT PRIMARY KEY, body JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await this.client.query(`UPDATE arca_bot_invoices SET status='uncertain',
      body=jsonb_set(body,'{status}','"uncertain"'::jsonb) WHERE context=$1 AND status='issuing'`, [this.context]);
  }
  async close() { await this.client.end(); }
  async getIssuer(): Promise<EmisorData | undefined> {
    const result = await this.client.query('SELECT body FROM arca_bot_issuer WHERE context=$1', [this.context]);
    return result.rows[0]?.body;
  }
  async saveIssuer(data: EmisorData): Promise<void> {
    await this.client.query(`INSERT INTO arca_bot_issuer(context,body) VALUES ($1,$2)
      ON CONFLICT(context) DO UPDATE SET body=excluded.body,updated_at=now()`, [this.context, JSON.stringify(data)]);
  }
  async getPdf(id: string, userId: number): Promise<Buffer | undefined> {
    const result = await this.client.query("SELECT pdf FROM arca_bot_invoices WHERE context=$1 AND id=$2 AND user_id=$3 AND status='authorized'", [this.context, id, userId]);
    return result.rows[0]?.pdf ?? undefined;
  }
  async savePdf(id: string, userId: number, pdf: Buffer): Promise<void> {
    await this.client.query("UPDATE arca_bot_invoices SET pdf=$4 WHERE context=$1 AND id=$2 AND user_id=$3 AND status='authorized'", [this.context, id, userId, pdf]);
  }
  async save(r: Record) {
    await this.client.query(`INSERT INTO arca_bot_invoices(context,id,user_id,status,body) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(context,id) DO UPDATE SET status=excluded.status, body=excluded.body`,
      [this.context, r.id, r.userId, r.status, JSON.stringify(r)]);
  }
  async get(id: string, userId: number): Promise<Record | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
    const result = await this.client.query('SELECT body FROM arca_bot_invoices WHERE context=$1 AND id=$2 AND user_id=$3', [this.context, id, userId]);
    return result.rows[0]?.body;
  }
  async active(userId: number): Promise<Record | undefined> {
    const result = await this.client.query("SELECT body FROM arca_bot_invoices WHERE context=$1 AND user_id=$2 AND status='draft'", [this.context, userId]);
    return result.rows[0]?.body;
  }
  async creditFor(invoiceId: string): Promise<Record | undefined> {
    const result = await this.client.query(`SELECT body FROM arca_bot_invoices WHERE context=$1
      AND body->>'sourceInvoiceId'=$2 AND status IN ('draft','issuing','uncertain','authorized') LIMIT 1`, [this.context, invoiceId]);
    return result.rows[0]?.body;
  }
  async pending(): Promise<Record | undefined> {
    const result = await this.client.query("SELECT body FROM arca_bot_invoices WHERE context=$1 AND status IN ('issuing','uncertain') LIMIT 1", [this.context]);
    return result.rows[0]?.body;
  }
  async list(userId: number): Promise<Record[]> {
    const result = await this.client.query('SELECT body FROM arca_bot_invoices WHERE context=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10', [this.context, userId]);
    return result.rows.map(row => row.body);
  }
  async create(userId: number): Promise<Record> {
    if (await this.active(userId)) throw new Error('Ya tenés un borrador. Usá /cancelar para descartarlo.');
    const r: Record = { id: randomUUID(), userId, step: 'documentType', status: 'draft', draft: {}, createdAt: new Date().toISOString() };
    await this.save(r);
    return r;
  }
}
