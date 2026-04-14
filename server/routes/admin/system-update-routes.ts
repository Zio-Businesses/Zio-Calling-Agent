import { Router, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import { AdminRequest, requireAdminPermission } from '../../middleware/admin-auth';
import { systemUpdateService } from '../../services/system-update-service';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

const updateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

export function registerSystemUpdateRoutes(router: Router) {
  router.get('/system-update/status',
    requireAdminPermission('settings', 'system_settings', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const status = systemUpdateService.getStatus();
        res.json({
          success: true,
          data: {
            ...status,
            currentVersion: systemUpdateService.getCurrentVersion(),
          },
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Status error:', error);
        res.status(500).json({ success: false, error: 'Failed to get update status' });
      }
    }
  );

  router.get('/system-update/history',
    requireAdminPermission('settings', 'system_settings', 'read'),
    async (req: AdminRequest, res: Response) => {
      try {
        const history = await systemUpdateService.getUpdateHistory();
        res.json({ success: true, data: { history } });
      } catch (error: any) {
        console.error('[SystemUpdate] History error:', error);
        res.status(500).json({ success: false, error: 'Failed to get update history' });
      }
    }
  );

  router.post('/system-update/validate',
    requireAdminPermission('settings', 'system_settings', 'create'),
    updateUpload.single('update'),
    async (req: AdminRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const validation = systemUpdateService.validateZip(req.file.buffer);

        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: 'Validation failed',
            message: validation.error,
          });
        }

        res.json({
          success: true,
          data: {
            manifest: validation.manifest,
            fileCount: validation.fileCount,
            totalSize: validation.estimatedSize,
            currentVersion: systemUpdateService.getCurrentVersion(),
          },
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Validation error:', error);
        res.status(500).json({ success: false, error: 'Failed to validate update package' });
      }
    }
  );

  router.post('/system-update/apply',
    requireAdminPermission('settings', 'system_settings', 'create'),
    updateUpload.single('update'),
    async (req: AdminRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const status = systemUpdateService.getStatus();
        if (status.inProgress) {
          return res.status(409).json({ success: false, error: 'An update is already in progress' });
        }

        const performedBy = req.userId || req.adminTeamMember?.email || 'unknown';

        res.json({
          success: true,
          message: 'Update process started. Check status endpoint for progress.',
        });

        systemUpdateService.performUpdate(req.file.buffer, performedBy).catch((err) => {
          console.error('[SystemUpdate] Async update error:', err);
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Apply error:', error);
        res.status(500).json({ success: false, error: 'Failed to start update' });
      }
    }
  );

  router.post('/system-update/rollback/:updateId',
    requireAdminPermission('settings', 'system_settings', 'create'),
    async (req: AdminRequest, res: Response) => {
      try {
        const currentStatus = systemUpdateService.getStatus();
        if (currentStatus.inProgress) {
          return res.status(409).json({ success: false, error: 'Cannot rollback while an update is in progress' });
        }

        const { updateId } = req.params;

        let backupPath: string | null = null;
        try {
          const result = await db.execute(sql`
            SELECT backup_path FROM system_updates WHERE id = ${updateId}
          `);
          if (result.rows.length > 0) {
            backupPath = (result.rows[0] as any).backup_path;
          }
        } catch {
          return res.status(404).json({ success: false, error: 'Update record not found' });
        }

        if (!backupPath) {
          return res.status(404).json({ success: false, error: 'No backup path found for this update' });
        }

        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ success: false, error: 'Backup directory no longer exists' });
        }

        await systemUpdateService.rollback(backupPath);

        try {
          await db.execute(sql`
            UPDATE system_updates SET status = 'rolled_back' WHERE id = ${updateId}
          `);
        } catch {}

        res.json({
          success: true,
          message: 'Rollback completed successfully. Server will restart shortly.',
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Rollback error:', error);
        res.status(500).json({ success: false, error: 'Failed to rollback' });
      }
    }
  );

  router.delete('/system-update/backups/:updateId',
    requireAdminPermission('settings', 'system_settings', 'delete'),
    async (req: AdminRequest, res: Response) => {
      try {
        const currentStatus = systemUpdateService.getStatus();
        if (currentStatus.inProgress) {
          return res.status(409).json({ success: false, error: 'Cannot delete backups while an update is in progress' });
        }

        const { updateId } = req.params;

        let backupPath: string | null = null;
        try {
          const result = await db.execute(sql`
            SELECT backup_path FROM system_updates WHERE id = ${updateId}
          `);
          if (result.rows.length > 0) {
            backupPath = (result.rows[0] as any).backup_path;
          }
        } catch {
          return res.status(404).json({ success: false, error: 'Update record not found' });
        }

        if (!backupPath) {
          return res.status(404).json({ success: false, error: 'No backup path found for this update' });
        }

        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { recursive: true, force: true });
        }

        try {
          await db.execute(sql`
            UPDATE system_updates SET backup_path = NULL WHERE id = ${updateId}
          `);
        } catch {}

        res.json({
          success: true,
          message: 'Backup deleted successfully',
        });
      } catch (error: any) {
        console.error('[SystemUpdate] Delete backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete backup' });
      }
    }
  );
}
