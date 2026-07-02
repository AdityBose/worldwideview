export class NonceCache {
    private store = new Map<string, number>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.startCleanup();
    }

    checkAndRecord(nonce: string, ttlMs: number = 300_000): boolean {
        if (this.store.has(nonce)) {
            return false;
        }
        this.store.set(nonce, Date.now() + ttlMs);
        return true;
    }

    clear(): void {
        this.store.clear();
    }

    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.store.clear();
    }

    get size(): number {
        return this.store.size;
    }

    private startCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, expiry] of this.store) {
                if (expiry < now) {
                    this.store.delete(key);
                }
            }
        }, 60_000);

        if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
            this.cleanupTimer.unref();
        }
    }
}

export const nonceCache = new NonceCache();
