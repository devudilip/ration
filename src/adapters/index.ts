/**
 * The adapter registry. Adding a provider is: create `src/adapters/<id>.ts`,
 * import it here, append it to this array, add its origin to
 * `optional_host_permissions` in public/manifest.json, and ship fixtures +
 * tests. See CONTRIBUTING.md for the worked example.
 */
import type { ProviderAdapter } from '../types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';

export const adapters: readonly ProviderAdapter[] = [claudeAdapter, codexAdapter];

export const getAdapter = (id: string): ProviderAdapter | undefined =>
  adapters.find((adapter) => adapter.id === id);
