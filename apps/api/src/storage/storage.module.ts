import { Global, Module } from "@nestjs/common";
import { LocalObjectStorage } from "./local-object-storage";
import { OBJECT_STORAGE } from "./object-storage";

@Global()
@Module({
  providers: [LocalObjectStorage, { provide: OBJECT_STORAGE, useExisting: LocalObjectStorage }],
  exports: [OBJECT_STORAGE]
})
export class StorageModule {}
