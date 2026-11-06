import type { Draft } from '../src/invoice.js';
import { today } from '../src/invoice.js';
import type { Record, Repository } from '../src/store.js';
import type { EmisorData } from '@arcasdk/pdf';

export function draft(): Draft {
  return { documentType: 96, documentNumber: 30123456, name: 'CLIENTE DE PRUEBA', address: 'Calle de prueba 123',
    ivaId: 5, ivaLabel: 'Consumidor Final', description: 'Servicio de prueba', cents: 1500050,
    concept: 2, date: today(), serviceFrom: today(), serviceTo: today(), paymentDue: today() };
}
export function record(): Record {
  return { id: 'e1b16ab8-0e87-40b5-9000-9229805db92c', userId: 123, step: 'confirm', status: 'draft', draft: draft(), createdAt: new Date().toISOString() };
}
export class MemoryStore implements Repository {
  records = new Map<string, Record>();
  pdfs = new Map<string, Buffer>();
  issuer?: EmisorData;
  async getIssuer() { return this.issuer ? structuredClone(this.issuer) : undefined; }
  async saveIssuer(data: EmisorData) { this.issuer = structuredClone(data); }
  async save(r: Record) { this.records.set(r.id, structuredClone(r)); }
  async get(id: string, userId: number) { const r = this.records.get(id); return r?.userId === userId ? structuredClone(r) : undefined; }
  async active(userId: number) { return [...this.records.values()].find(r => r.userId === userId && r.status === 'draft'); }
  async pending() { return [...this.records.values()].find(r => ['issuing', 'uncertain'].includes(r.status)); }
  async creditFor(invoiceId: string) { return [...this.records.values()].find(r => r.sourceInvoiceId === invoiceId && ['draft', 'issuing', 'uncertain', 'authorized'].includes(r.status)); }
  async list(userId: number) { return [...this.records.values()].filter(r => r.userId === userId); }
  async create(userId: number) { const r = record(); r.userId = userId; r.draft = {}; r.step = 'documentType'; await this.save(r); return r; }
  async getPdf(id: string, userId: number) { return await this.get(id, userId) ? this.pdfs.get(id) : undefined; }
  async savePdf(id: string, userId: number, pdf: Buffer) { if (await this.get(id, userId)) this.pdfs.set(id, pdf); }
}
