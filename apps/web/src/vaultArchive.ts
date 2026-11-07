import { unzipSync, zipSync } from "fflate";
import { archiveFileName, deserializeArchive, serializeArchive, type VaultArchiveData } from "@solen/core";

/**
 * Zip/unzip and browser file download/pick glue for vault export/import.
 * The archive layout itself (directory <-> file map) lives in
 * `@solen/core`'s `archive.ts` — this module only knows ZIP and the DOM.
 */

/** Zip vault data and trigger a browser download of `<name>.astro-vault.zip`. `nameOverride`
 * lets the caller name the download after the vault's folder (Electron) instead of
 * `data.meta.name`, which is just the seeded "My Vault" literal in the browser build. */
export function downloadVaultArchive(data: VaultArchiveData, nameOverride?: string): void {
  const files = serializeArchive(data);
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archiveFileName(nameOverride ?? data.meta.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse a picked `.zip`/legacy `.solenvault.zip` File into vault data. */
export async function readVaultArchiveFile(file: File): Promise<VaultArchiveData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes);
  return deserializeArchive(files);
}

/** Open a native file picker restricted to .zip and resolve with the chosen file (or null if cancelled). */
export function pickVaultArchiveFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.style.display = "none";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    // Some browsers only fire onchange, never a cancel event — the promise
    // simply never resolves if the user dismisses the dialog, which is
    // fine for a one-shot "Import vault" action with no other awaiters.
    document.body.appendChild(input);
    input.click();
  });
}
