import type { VaultEntry, VaultPlaintext } from "./types.ts";
import { nowIso } from "../../shared/time.ts";

function newId(): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function entryPublicView(e: VaultEntry): Omit<VaultEntry, "password"> {
  const { password, ...rest } = e;
  return rest;
}

export function listPublicEntries(v: VaultPlaintext): Array<Omit<VaultEntry, "password">> {
  return v.entries.map(entryPublicView);
}

export function upsertEntry(v: VaultPlaintext, entry: Partial<VaultEntry>): { id: string } {
  const t = nowIso();
  const id = entry.id ?? newId();

  const clean: VaultEntry = {
    id,
    title: String(entry.title ?? "").trim(),
    domain: entry.domain ? String(entry.domain).trim() : undefined,
    username: entry.username ? String(entry.username).trim() : undefined,
    password: entry.password ? String(entry.password) : undefined,
    notes: entry.notes ? String(entry.notes) : undefined,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : undefined,
    favorite: !!entry.favorite,
    createdAt: entry.createdAt ?? t,
    updatedAt: t,
  };

  if (!clean.title) throw new Error("VALIDATION:title");

  const idx = v.entries.findIndex((x) => x.id === id);
  if (idx >= 0) v.entries[idx] = { ...v.entries[idx], ...clean };
  else v.entries.unshift(clean);

  return { id };
}

export function deleteEntry(v: VaultPlaintext, id: string): void {
  v.entries = v.entries.filter((x) => x.id !== id);
}

export function getEntrySecret(v: VaultPlaintext, id: string): { id: string; username: string; password: string } | null {
  const e = v.entries.find((x) => x.id === id);
  if (!e) return null;
  return { id: e.id, username: e.username ?? "", password: e.password ?? "" };
}
