import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { scheduleGracefulRestart } from '../utils/graceful-restart';

const execAsync = promisify(exec);

const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const TEMP_UPDATE_DIR = path.resolve(process.cwd(), '.update-temp');

const PROTECTED_PATHS = [
  '.env',
  'node_modules/',
  'uploads/',
  'backups/',
  '.update-temp/',
  '.git/',
  '.config/',
  'data/',
  'server/',
  'plugins/',
  'scripts/',
  'shared/',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
];

const PROTECTED_EXTENSIONS = ['.log'];

const PROTECTED_DB_FILES = ['drizzle.config.ts'];

const BACKUP_EXCLUDE_DIRS = ['node_modules', '.git', 'backups', 'uploads', '.update-temp'];

interface UpdateStatus {
  inProgress: boolean;
  phase: 'idle' | 'validating' | 'backing_up' | 'backing_up_db' | 'extracting' | 'installing_deps' | 'restarting' | 'health_check' | 'complete' | 'rolling_back' | 'failed';
  progress: number;
  message: string;
  currentVersion: string;
  targetVersion?: string;
  error?: string;
  startedAt?: Date;
}

interface UpdateManifest {
  version: string;
  name: string;
  minCompatibleVersion?: string;
  releaseNotes?: string;
  migrations?: { description: string; sql?: string }[];
  requiredNodeVersion?: string;
}

interface ValidationResult {
  valid: boolean;
  manifest?: UpdateManifest;
  fileCount: number;
  estimatedSize: number;
  error?: string;
}

function isProtectedPath(filePath: string): boolean {
  let normalized = filePath.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\/+/, '');
  normalized = path.posix.normalize(normalized);

  if (normalized.startsWith('../') || normalized.startsWith('/')) {
    return true;
  }

  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath.endsWith('/')) {
      if (normalized.startsWith(protectedPath) || normalized === protectedPath.slice(0, -1)) {
        return true;
      }
    } else {
      if (normalized === protectedPath) {
        return true;
      }
    }
  }

  for (const ext of PROTECTED_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return true;
    }
  }

  for (const dbFile of PROTECTED_DB_FILES) {
    if (normalized === dbFile) {
      return true;
    }
  }

  return false;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

function copyDirRecursive(src: string, dest: string, excludeDirs: string[] = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludeDirs);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

class SystemUpdateService {
  private status: UpdateStatus;

  constructor() {
    this.status = {
      inProgress: false,
      phase: 'idle',
      progress: 0,
      message: 'System is idle',
      currentVersion: this.getCurrentVersion(),
    };
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  getCurrentVersion(): string {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  async getUpdateHistory(): Promise<any[]> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM system_updates ORDER BY created_at DESC LIMIT 50
      `);
      return result.rows as any[];
    } catch {
      return [];
    }
  }

  validateZip(buffer: Buffer): ValidationResult {
    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      for (const entry of entries) {
        const entryPath = entry.entryName;
        if (entryPath.includes('..') || path.isAbsolute(entryPath)) {
          return { valid: false, fileCount: 0, estimatedSize: 0, error: `Path traversal detected in entry: ${entryPath}` };
        }
      }

      let manifest: UpdateManifest | undefined;
      let rootDir = '';

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName.split('/');
        const fileName = parts[parts.length - 1];

        if (fileName === 'update-manifest.json' && parts.length <= 2) {
          try {
            const content = entry.getData().toString('utf-8');
            manifest = JSON.parse(content) as UpdateManifest;
            if (parts.length === 2) rootDir = parts[0];
            break;
          } catch {}
        }
      }

      if (!manifest) {
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const parts = entry.entryName.split('/');
          const fileName = parts[parts.length - 1];

          if (fileName === 'package.json' && parts.length <= 2) {
            try {
              const content = entry.getData().toString('utf-8');
              const pkg = JSON.parse(content);
              if (pkg.version) {
                manifest = {
                  version: pkg.version,
                  name: pkg.name || 'Unknown',
                  releaseNotes: pkg.description,
                };
                if (parts.length === 2) rootDir = parts[0];
                break;
              }
            } catch {}
          }
        }
      }

      if (!manifest) {
        return { valid: false, fileCount: 0, estimatedSize: 0, error: 'No update-manifest.json or package.json found in the ZIP file' };
      }

      const currentVersion = this.getCurrentVersion();
      if (compareVersions(manifest.version, currentVersion) <= 0) {
        return {
          valid: false,
          fileCount: 0,
          estimatedSize: 0,
          error: `Update version (${manifest.version}) must be higher than current version (${currentVersion})`,
        };
      }

      if (manifest.minCompatibleVersion) {
        if (compareVersions(currentVersion, manifest.minCompatibleVersion) < 0) {
          return {
            valid: false,
            fileCount: 0,
            estimatedSize: 0,
            error: `Current version (${currentVersion}) is below minimum compatible version (${manifest.minCompatibleVersion})`,
          };
        }
      }

      let fileCount = 0;
      let estimatedSize = 0;
      for (const entry of entries) {
        if (!entry.isDirectory) {
          fileCount++;
          estimatedSize += entry.header.size;
        }
      }

      return { valid: true, manifest, fileCount, estimatedSize };
    } catch (error: any) {
      return { valid: false, fileCount: 0, estimatedSize: 0, error: `Failed to parse ZIP: ${error.message}` };
    }
  }

  async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(BACKUPS_DIR, `backup-${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const cwd = process.cwd();
    copyDirRecursive(cwd, backupDir, BACKUP_EXCLUDE_DIRS);

    return backupDir;
  }

  async createDatabaseBackup(backupDir: string): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn('[SystemUpdate] No DATABASE_URL set, skipping database backup');
      return;
    }

    try {
      const dumpPath = path.join(backupDir, 'database.sql');
      await execAsync(`pg_dump "${databaseUrl}" > "${dumpPath}"`, { timeout: 60000 });
      console.log('[SystemUpdate] Database backup created successfully');
    } catch (error: any) {
      console.warn('[SystemUpdate] pg_dump not available or failed, skipping database backup:', error.message);
    }
  }

  private extractFiles(zip: AdmZip, rootDir: string): number {
    const entries = zip.getEntries();
    const cwd = process.cwd();
    let extractedCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      let entryPath = entry.entryName;
      if (rootDir && entryPath.startsWith(rootDir + '/')) {
        entryPath = entryPath.substring(rootDir.length + 1);
      }
      if (!entryPath) continue;

      if (isProtectedPath(entryPath)) {
        console.log(`[SystemUpdate] Skipping protected path: ${entryPath}`);
        continue;
      }

      if (entryPath.includes('..') || path.isAbsolute(entryPath)) continue;

      const fullPath = path.join(cwd, entryPath);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) continue;

      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, entry.getData());
      extractedCount++;
    }

    return extractedCount;
  }

  async performUpdate(zipBuffer: Buffer, performedBy?: string): Promise<void> {
    if (this.status.inProgress) {
      throw new Error('An update is already in progress');
    }

    let backupPath = '';
    const fromVersion = this.getCurrentVersion();
    let toVersion = '';
    let fileCount = 0;

    try {
      this.status = {
        inProgress: true,
        phase: 'validating',
        progress: 5,
        message: 'Validating update package...',
        currentVersion: fromVersion,
        startedAt: new Date(),
      };

      fs.writeFileSync(path.join(process.cwd(), '.maintenance'), 'updating');

      const validation = this.validateZip(zipBuffer);
      if (!validation.valid || !validation.manifest) {
        throw new Error(validation.error || 'Invalid update package');
      }

      toVersion = validation.manifest.version;
      this.status.targetVersion = toVersion;
      this.status.progress = 15;
      this.status.message = `Validated update to version ${toVersion}`;

      this.status.phase = 'backing_up';
      this.status.progress = 20;
      this.status.message = 'Creating file backup...';

      backupPath = await this.createBackup();
      this.status.progress = 35;
      this.status.message = 'File backup created';

      this.status.phase = 'backing_up_db';
      this.status.progress = 40;
      this.status.message = 'Creating database backup...';

      await this.createDatabaseBackup(backupPath);
      this.status.progress = 50;
      this.status.message = 'Database backup complete';

      this.status.phase = 'extracting';
      this.status.progress = 55;
      this.status.message = 'Extracting update files...';

      const zip = new AdmZip(zipBuffer);
      let rootDir = '';
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const parts = entry.entryName.split('/');
        const fileName = parts[parts.length - 1];
        if ((fileName === 'update-manifest.json' || fileName === 'package.json') && parts.length === 2) {
          rootDir = parts[0];
          break;
        }
      }

      fileCount = this.extractFiles(zip, rootDir);
      this.status.progress = 70;
      this.status.message = `Extracted ${fileCount} files`;

      this.status.phase = 'installing_deps';
      this.status.progress = 75;
      this.status.message = 'Installing dependencies...';

      try {
        await execAsync('npm install --production', {
          timeout: 120000,
          cwd: process.cwd(),
        });
      } catch (npmError: any) {
        console.warn('[SystemUpdate] npm install warning:', npmError.message);
      }

      this.status.progress = 90;
      this.status.message = 'Dependencies installed';

      this.status.phase = 'complete';
      this.status.progress = 100;
      this.status.message = `Update to version ${toVersion} completed successfully. Server will restart shortly.`;
      this.status.inProgress = false;

      await this.recordUpdate({
        fromVersion,
        toVersion,
        status: 'success',
        backupPath,
        releaseNotes: validation.manifest.releaseNotes,
        performedBy,
        fileCount,
      });

      try {
        fs.unlinkSync(path.join(process.cwd(), '.maintenance'));
      } catch {}

      scheduleGracefulRestart(`System update to v${toVersion}`);
    } catch (error: any) {
      console.error('[SystemUpdate] Update failed:', error);

      this.status.phase = 'rolling_back';
      this.status.progress = 0;
      this.status.message = 'Rolling back due to error...';
      this.status.error = error.message;

      if (backupPath && fs.existsSync(backupPath)) {
        try {
          await this.rollback(backupPath);
          this.status.message = 'Rolled back successfully after failure';
        } catch (rollbackError: any) {
          console.error('[SystemUpdate] Rollback also failed:', rollbackError);
          this.status.message = `Update failed and rollback also failed: ${rollbackError.message}`;
        }
      }

      this.status.phase = 'failed';
      this.status.inProgress = false;

      await this.recordUpdate({
        fromVersion,
        toVersion: toVersion || 'unknown',
        status: 'failed',
        backupPath,
        errorMessage: error.message,
        performedBy,
        fileCount,
      });

      try {
        fs.unlinkSync(path.join(process.cwd(), '.maintenance'));
      } catch {}
    }
  }

  async rollback(backupPath: string): Promise<void> {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup path does not exist: ${backupPath}`);
    }

    const cwd = process.cwd();
    const entries = fs.readdirSync(backupPath, { withFileTypes: true });

    for (const entry of entries) {
      if (BACKUP_EXCLUDE_DIRS.includes(entry.name)) continue;
      if (entry.name === 'database.sql') continue;

      const srcPath = path.join(backupPath, entry.name);
      const destPath = path.join(cwd, entry.name);

      if (entry.isDirectory()) {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    try {
      await execAsync('npm install --production', {
        timeout: 120000,
        cwd: process.cwd(),
      });
    } catch (npmError: any) {
      console.warn('[SystemUpdate] npm install during rollback warning:', npmError.message);
    }
  }

  async recordUpdate(data: {
    fromVersion: string;
    toVersion: string;
    status: 'success' | 'failed' | 'rolled_back';
    backupPath?: string;
    releaseNotes?: string;
    errorMessage?: string;
    performedBy?: string;
    fileCount?: number;
  }): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS system_updates (
          id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
          from_version VARCHAR(50) NOT NULL,
          to_version VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'success',
          backup_path TEXT,
          release_notes TEXT,
          error_message TEXT,
          performed_by VARCHAR(255),
          file_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        INSERT INTO system_updates (from_version, to_version, status, backup_path, release_notes, error_message, performed_by, file_count)
        VALUES (
          ${data.fromVersion},
          ${data.toVersion},
          ${data.status},
          ${data.backupPath || null},
          ${data.releaseNotes || null},
          ${data.errorMessage || null},
          ${data.performedBy || null},
          ${data.fileCount || 0}
        )
      `);
    } catch (error: any) {
      console.error('[SystemUpdate] Failed to record update:', error.message);
    }
  }
}

export function isMaintenanceMode(): boolean {
  return fs.existsSync(path.join(process.cwd(), '.maintenance'));
}

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/admin') || req.path.startsWith('/api/auth') || req.path.includes('.')) {
    return next();
  }
  if (fs.existsSync(path.join(process.cwd(), '.maintenance'))) {
    return res.status(503).json({
      error: 'System is updating',
      message: 'The system is currently being updated. Please try again in a few minutes.',
    });
  }
  next();
}

export const systemUpdateService = new SystemUpdateService();
