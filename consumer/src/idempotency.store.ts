// Store de idempotência in-memory e limitada (v1.1 — D-029 / F-43).
// Chaveia por `order.id`, com TTL de retenção e evicção FIFO (Map preserva a
// ordem de inserção). Sem Redis/banco na v1 (C-03) — durabilidade e
// multi-instância são backlog.
export class IdempotencyStore {
  // Map<key, timestamp de inserção> — iteration order = ordem de inserção (FIFO).
  private readonly entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  // Deduplica: já processado dentro da janela de TTL?
  wasProcessed(key: string): boolean {
    this.pruneStale();
    const ts = this.entries.get(key);
    if (ts === undefined) return false;
    return Date.now() - ts <= this.ttlMs;
  }

  markProcessed(key: string): void {
    this.pruneStale();
    this.entries.set(key, Date.now());
    this.evictIfOverflow();
  }

  get size(): number {
    return this.entries.size;
  }

  // Evicção FIFO quando a store atinge o teto (evita crescer ilimitado).
  private evictIfOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  // Varredura preguiçosa: remove entradas fora da janela de TTL.
  private pruneStale(): void {
    const now = Date.now();
    for (const [key, ts] of this.entries) {
      if (now - ts > this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}