// 存储层：把「数据」和「存放位置」解耦。
// LocalStorageBackend 保留原单文件版行为（键 starmap.knowledge.v1、首次打开建种子、
// contentVersion 落后时做一次性种子合并）；HTTP 后端预留给后续的本地服务端 / 桌面端。
import { STORE_KEY } from '../constants.js';
import { createDefaultData, mergeSeedAdditions, mergeSeedContent, needsSeedUpgrade, normalizeData } from '../domain/model.js';

/**
 * 读取结果。data 一定是规范化后的完整知识库。
 * @typedef {object} LoadResult
 * @property {import('../types.js').KnowledgeData} data
 * @property {'seed'|'storage'|'server'|'import'} source
 * @property {boolean} firstRun 首次打开（没有存档）
 * @property {boolean} missing 有存档但损坏
 * @property {boolean} seeded 执行了一次性种子升级
 * @property {boolean} migrated 数据被迁移过（需要立即回写）
 * @property {{addedNodes:number,refreshedNotes:number,addedEdges:number}} [upgraded]
 */

/**
 * 统一的存储后端接口。
 * @typedef {object} StorageBackend
 * @property {string} label 显示给用户的后端名称
 * @property {() => Promise<LoadResult>} load
 * @property {(payload:import('../types.js').KnowledgeData) => Promise<void>} save
 * @property {(payload:import('../types.js').KnowledgeData) => Promise<void>} reset
 */

/**
 * 从一组可选后端里挑第一个能用的（工厂可以是异步的）。
 * @param {Array<() => Promise<StorageBackend>|StorageBackend>} factories
 * @returns {Promise<StorageBackend>}
 */
export async function pickBackend(factories) {
  const errors = [];
  for (const factory of factories) {
    try {
      const backend = await factory();
      if (backend) return backend;
    } catch (e) {
      errors.push(e);
    }
  }
  const err = new Error('没有可用的存储后端');
  err.cause = errors;
  throw err;
}

/** 浏览器 localStorage 后端。 */
export class LocalStorageBackend {
  /**
   * @param {{storage?:Storage|null, key?:string}} [opts]
   */
  constructor(opts = {}) {
    this.key = opts.key || STORE_KEY;
    this.label = '本地浏览器';
    this.storage = opts.storage !== undefined ? opts.storage : safeLocalStorage();
    this.available = !!this.storage;
  }

  /** @returns {Promise<LoadResult>} */
  load() {
    if (!this.available) {
      return seedResult(true);
    }
    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (e) {
      raw = null;
    }
    if (!raw) return seedResult(true);

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    const norm = normalizeData(parsed);
    if (!norm) return { ...seedResult(false), missing: true };

    let upgraded = null;
    if (needsSeedUpgrade(norm)) {
      upgraded = upgradeSeed(norm);
      norm.migrated = true;
    }
    return {
      data: norm,
      source: 'storage',
      firstRun: false,
      missing: false,
      seeded: !!upgraded,
      migrated: !!norm.migrated,
      upgraded: upgraded || undefined
    };
  }

  /** @param {import('../types.js').KnowledgeData} payload */
  save(payload) {
    if (!this.available) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(payload));
    } catch (e) {
      /* 配额满 / 隐私模式：调用方通过 available 判断，无需重复报错 */
    }
  }

  /** @param {import('../types.js').KnowledgeData} payload */
  reset(payload) {
    this.save(payload);
  }
}

/**
 * HTTP 后端：给将来的本地服务端 / 桌面端用。
 * @param {string} [baseUrl]
 * @returns {StorageBackend}
 */
export function createHttpBackend(baseUrl = '/api/knowledge') {
  return {
    label: '服务端',
    async load() {
      const res = await fetch(baseUrl, { headers: { accept: 'application/json' } });
      if (res.status === 404) return seedResult(true);
      if (!res.ok) throw new Error('读取知识库失败：HTTP ' + res.status);
      const norm = normalizeData(await res.json());
      if (!norm) throw new Error('知识库数据为空');
      let upgraded = null;
      if (needsSeedUpgrade(norm)) {
        upgraded = upgradeSeed(norm);
        norm.migrated = true;
      }
      return {
        data: norm,
        source: 'server',
        firstRun: false,
        missing: false,
        seeded: !!upgraded,
        migrated: !!norm.migrated,
        upgraded: upgraded || undefined
      };
    },
    async save(payload) {
      const res = await fetch(baseUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('保存失败：HTTP ' + res.status);
    },
    async reset(payload) {
      await this.save(payload);
    }
  };
}

/**
 * 内存后端：单元测试用。
 * @param {unknown} [initialRaw]
 */
export class MemoryBackend {
  constructor(initialRaw) {
    this.label = '内存';
    this.raw = initialRaw === undefined ? null : JSON.stringify(initialRaw);
    this.available = true;
  }

  /** @returns {Promise<LoadResult>} */
  async load() {
    if (this.raw === null) return seedResult(true);
    const norm = normalizeData(JSON.parse(this.raw));
    if (!norm) return { ...seedResult(false), missing: true };
    let upgraded = null;
    if (needsSeedUpgrade(norm)) {
      upgraded = upgradeSeed(norm);
      norm.migrated = true;
    }
    return {
      data: norm,
      source: 'storage',
      firstRun: false,
      missing: false,
      seeded: !!upgraded,
      migrated: !!norm.migrated,
      upgraded: upgraded || undefined
    };
  }

  async save(payload) {
    this.raw = JSON.stringify(payload);
  }

  async reset(payload) {
    this.save(payload);
  }
}

function upgradeSeed(norm) {
  return Number(norm.contentVersion) >= 2 ? mergeSeedAdditions(norm) : mergeSeedContent(norm);
}

function seedResult(firstRun) {
  return {
    data: normalizeData(createDefaultData()),
    source: 'seed',
    firstRun,
    missing: false,
    seeded: false,
    migrated: false
  };
}

function safeLocalStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__starmap_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (e) {
    return null;
  }
}