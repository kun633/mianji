import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';
import type { SleepRepository } from '../data/repository';
import type { SleepSegment } from '../domain/sleep';

class MemorySleepRepository implements SleepRepository {
  private items = new Map<string, SleepSegment>();
  async get(id: string) { return this.items.get(id); }
  async list() { return [...this.items.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)); }
  async getActive() { return [...this.items.values()].find((s) => s.status === 'active'); }
  async createActiveIfNone(segment: SleepSegment) {
    if (await this.getActive()) return false;
    this.items.set(segment.id, segment);
    return true;
  }
  async save(segment: SleepSegment) { this.items.set(segment.id, segment); }
  async remove(id: string) { this.items.delete(id); }
  async replaceAll(segments: SleepSegment[]) {
    this.items.clear();
    for (const s of segments) this.items.set(s.id, s);
  }
  async replaceAllIfUnchanged(_expected: SleepSegment[], segments: SleepSegment[]) {
    await this.replaceAll(segments);
    return true;
  }
}

describe('App Component Mounting Regression Test', () => {
  it('mounts App component cleanly without Invalid Hook Call or crash', async () => {
    const memoryRepo = new MemorySleepRepository();
    render(<App initialRepository={memoryRepo} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '历史' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  });
});
