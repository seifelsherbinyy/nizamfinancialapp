/**
 * NIZAM · In-memory fake DriveClient for unit tests
 * Implemented by: KIRO Contract 2 / Phase 2.8 (test harness)
 * Depends on: src/lib/drive/driveClient.ts (interface only)
 */
import type { DriveClient, DriveFileMeta } from '@/lib/drive/driveClient';

interface FakeFile extends DriveFileMeta {
  content: string;
}

export class FakeDrive {
  files = new Map<string, FakeFile>();
  private counter = 0;

  newId(): string {
    this.counter += 1;
    return `file_${this.counter}`;
  }

  /** Simulate an out-of-band edit from another device (bumps version). */
  externalUpdate(fileId: string, content: string): void {
    const f = this.files.get(fileId);
    if (!f) throw new Error(`no such file ${fileId}`);
    f.content = content;
    f.version += 1;
  }

  client(): DriveClient {
    // Match the small set of query shapes driveDb uses.
    const matches = (f: FakeFile, query: string): boolean => {
      const nameMatch = /name='([^']+)'/.exec(query);
      if (nameMatch && f.name !== nameMatch[1]) return false;
      const mimeMatch = /mimeType='([^']+)'/.exec(query);
      if (mimeMatch && f.mimeType !== mimeMatch[1]) return false;
      const parentMatch = /'([^']+)' in parents/.exec(query);
      if (parentMatch && !(f.parents ?? []).includes(parentMatch[1] ?? '')) return false;
      const propMatch = /appProperties has \{ key='([^']+)' and value='([^']+)' \}/.exec(query);
      if (propMatch && f.appProperties?.[propMatch[1] ?? ''] !== propMatch[2]) return false;
      return true;
    };

    return {
      listFiles: async (query) =>
        [...this.files.values()].filter((f) => matches(f, query)).map(({ content: _c, ...meta }) => ({ ...meta })),
      getFileMeta: async (fileId) => {
        const f = this.files.get(fileId);
        if (!f) throw new Error(`404 no such file ${fileId}`);
        const { content: _c, ...meta } = f;
        return { ...meta };
      },
      downloadText: async (fileId) => {
        const f = this.files.get(fileId);
        if (!f) throw new Error(`404 no such file ${fileId}`);
        return f.content;
      },
      createFolder: async (name, parentId) => {
        const id = this.newId();
        const file: FakeFile = {
          id,
          name,
          version: 1,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : [],
          content: '',
        };
        this.files.set(id, file);
        const { content: _c, ...meta } = file;
        return { ...meta };
      },
      createTextFile: async (name, content, options) => {
        const id = this.newId();
        const file: FakeFile = {
          id,
          name,
          version: 1,
          mimeType: options?.mimeType ?? 'application/json',
          parents: options?.parents ?? [],
          appProperties: options?.appProperties,
          content,
        };
        this.files.set(id, file);
        const { content: _c, ...meta } = file;
        return { ...meta };
      },
      updateTextFile: async (fileId, content) => {
        const f = this.files.get(fileId);
        if (!f) throw new Error(`404 no such file ${fileId}`);
        f.content = content;
        f.version += 1;
        const { content: _c, ...meta } = f;
        return { ...meta };
      },
      deleteFile: async (fileId) => {
        this.files.delete(fileId);
      },
    };
  }
}
