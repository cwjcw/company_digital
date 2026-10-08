export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /** Private objects stay in the uploads backup but never receive a public URL. */
  visibility?: "public" | "private";
}

export interface StoredObject {
  key: string;
  contentType: string;
  body: Buffer;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<{ key: string; url: string }>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Adapter-owned private enumeration for authorized crash-orphan reconciliation. */
  listPrivateKeys?(prefix: string): AsyncIterable<string>;
}
