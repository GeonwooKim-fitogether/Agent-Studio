/** 저장 계약 — 메모리 저장소 */
import { createMemoryStore } from "../../src/adapters/store/memory/memory-store";
import { describeStoreContract } from "./store-contract";

describeStoreContract("memory", async (seed) => createMemoryStore(seed));
