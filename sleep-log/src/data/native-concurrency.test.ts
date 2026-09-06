import { expect, it, vi } from 'vitest';
const data = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: () => true}}));
vi.mock('@capacitor-community/sqlite', () => ({CapacitorSQLite: {
  checkConnectionsConsistency: async () => ({result:false}),
  createConnection: async () => {}, open: async () => {}, execute: async () => {},
  beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
  query: async () => ({values:data.ids.map(id => ({id}))}),
  run: async ({values}: {values: unknown[]}) => {data.ids.push(String(values[0]));},
}}));
import { createSleepRepository } from './repository-factory';
import type { SleepSegment } from '../domain/sleep';

it('two simultaneous starts cannot enter the same SQLite transaction and create two active records', async () => {
  const repo = await createSleepRepository();
  const now = new Date().toISOString();
  const segment: SleepSegment = {id:'first',kind:'nap',groupId:null,startAt:now,startTimezone:'Asia/Shanghai',endAt:null,endTimezone:null,status:'active',uncertainReason:null,createdAt:now,updatedAt:now,finishedAt:null,schemaVersion:1};
  const results = await Promise.all([repo.createActiveIfNone(segment), repo.createActiveIfNone({...segment,id:'second'})]);
  expect(results).toEqual([true,false]);
  expect(data.ids).toEqual(['first']);
});
