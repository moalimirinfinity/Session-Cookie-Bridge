import { mediumAdapter } from "./medium.adapter";
import type { PlatformAdapter } from "./types";

const adapters: PlatformAdapter[] = [mediumAdapter];

export function listPlatformAdapters(): PlatformAdapter[] {
  return [...adapters];
}

export function getPlatformAdapter(platformId: string): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.id === platformId);
}
