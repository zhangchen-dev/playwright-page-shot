/**
 * 凭证存储模块 - 使用 Electron safeStorage 加密保存账号密码
 *
 * 数据结构 (credentials.json):
 * {
 *   "version": 1,
 *   "credentials": {
 *     "example.com": [
 *       { "username": "user1", "password": "<base64_encrypted>", "lastUsed": "2026-08-04T10:00:00Z" }
 *     ]
 *   }
 * }
 *
 * 加密方式: Electron safeStorage（Windows DPAPI / macOS Keychain / Linux libsecret）
 */
const fs = require('fs');
const path = require('path');

class CredentialStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, credentials: {} };
    this._load();
  }

  /** 加载已存储的凭证数据 */
  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.credentials) {
          this.data = parsed;
        }
      }
    } catch (err) {
      console.warn('[CredentialStore] 加载凭证文件失败:', err.message);
      this.data = { version: 1, credentials: {} };
    }
  }

  /** 保存到磁盘 */
  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[CredentialStore] 保存凭证文件失败:', err.message);
    }
  }

  /** 获取 safeStorage 实例（延迟加载，非 Electron 环境回退为明文） */
  _getSafeStorage() {
    try {
      const { safeStorage } = require('electron');
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        return safeStorage;
      }
    } catch (e) {
      // 非 Electron 环境
    }
    return null;
  }

  /** 加密密码 */
  _encrypt(password) {
    const safeStorage = this._getSafeStorage();
    if (safeStorage) {
      return safeStorage.encryptString(password).toString('base64');
    }
    // 回退：Base64 编码（非安全，仅开发环境）
    return Buffer.from(password, 'utf-8').toString('base64');
  }

  /** 解密密码 */
  _decrypt(encrypted) {
    if (!encrypted) return '';
    const safeStorage = this._getSafeStorage();
    if (safeStorage) {
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch (err) {
        console.warn('[CredentialStore] 解密失败:', err.message);
        return '';
      }
    }
    // 回退：Base64 解码
    try {
      return Buffer.from(encrypted, 'base64').toString('utf-8');
    } catch (e) {
      return '';
    }
  }

  /**
   * 获取指定域名的已保存凭证列表（不含密码明文，用于 UI 展示）
   * @param {string} domain
   * @returns {Array<{username: string, lastUsed: string}>}
   */
  getCredentials(domain) {
    if (!domain) return [];
    const creds = this.data.credentials[domain];
    if (!creds || !Array.isArray(creds)) return [];
    return creds.map((c) => ({
      username: c.username,
      lastUsed: c.lastUsed || '',
    }));
  }

  /**
   * 获取指定域名的完整凭证（含解密后的密码，用于自动填充）
   * @param {string} domain
   * @returns {Array<{username: string, password: string, lastUsed: string}>}
   */
  getCredentialsWithPassword(domain) {
    if (!domain) return [];
    const creds = this.data.credentials[domain];
    if (!creds || !Array.isArray(creds)) return [];
    return creds.map((c) => ({
      username: c.username,
      password: this._decrypt(c.password),
      lastUsed: c.lastUsed || '',
    }));
  }

  /**
   * 获取指定域名 + 用户名的完整凭证（含密码）
   * @param {string} domain
   * @param {string} username
   * @returns {{username: string, password: string, lastUsed: string} | null}
   */
  getCredential(domain, username) {
    if (!domain || !username) return null;
    const creds = this.data.credentials[domain];
    if (!creds) return null;
    const found = creds.find((c) => c.username === username);
    if (!found) return null;
    return {
      username: found.username,
      password: this._decrypt(found.password),
      lastUsed: found.lastUsed || '',
    };
  }

  /**
   * 保存或更新凭证（同域名同用户名则更新密码）
   * @param {string} domain
   * @param {string} username
   * @param {string} password
   */
  saveCredential(domain, username, password) {
    if (!domain || !username || !password) return;

    if (!this.data.credentials[domain]) {
      this.data.credentials[domain] = [];
    }

    const creds = this.data.credentials[domain];
    const existing = creds.find((c) => c.username === username);
    const now = new Date().toISOString();

    if (existing) {
      // 更新已有凭证
      existing.password = this._encrypt(password);
      existing.lastUsed = now;
    } else {
      // 新增凭证
      creds.push({
        username,
        password: this._encrypt(password),
        lastUsed: now,
      });
    }

    this._save();
    console.log(`[CredentialStore] 已保存凭证: ${domain} / ${username}`);
  }

  /**
   * 删除指定凭证
   * @param {string} domain
   * @param {string} username
   */
  deleteCredential(domain, username) {
    if (!domain || !username) return;
    const creds = this.data.credentials[domain];
    if (!creds) return;

    this.data.credentials[domain] = creds.filter((c) => c.username !== username);

    // 如果该域名已无凭证，删除整个域名条目
    if (this.data.credentials[domain].length === 0) {
      delete this.data.credentials[domain];
    }

    this._save();
    console.log(`[CredentialStore] 已删除凭证: ${domain} / ${username}`);
  }

  /**
   * 检查指定域名是否有已保存凭证
   * @param {string} domain
   * @returns {boolean}
   */
  hasCredentials(domain) {
    if (!domain) return false;
    const creds = this.data.credentials[domain];
    return creds && creds.length > 0;
  }

  /**
   * 获取所有域名及其凭证数量（用于凭证管理 UI）
   * @returns {Array<{domain: string, count: number, credentials: Array<{username: string, lastUsed: string}>}>}
   */
  getAllDomains() {
    return Object.keys(this.data.credentials).map((domain) => {
      const creds = this.data.credentials[domain];
      return {
        domain,
        count: creds.length,
        credentials: creds.map((c) => ({
          username: c.username,
          lastUsed: c.lastUsed || '',
        })),
      };
    });
  }
}

module.exports = { CredentialStore };
