export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
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
}
