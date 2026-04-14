import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, ensureValidToken } from "@/lib/queryClient";
import { AuthStorage } from "@/lib/auth-storage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RotateCcw,
  FileArchive,
  ArrowUpCircle,
  Shield,
  HardDrive,
  Database,
  Clock,
  Trash2,
  Info,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UpdateStatus {
  inProgress: boolean;
  phase: string;
  progress: number;
  message: string;
  currentVersion: string;
  targetVersion?: string;
  error?: string;
  startedAt?: string;
}

interface ValidationResult {
  manifest: {
    version: string;
    name: string;
    releaseNotes?: string;
    minCompatibleVersion?: string;
  };
  currentVersion: string;
  fileCount: number;
  totalSize: number;
}

interface UpdateHistoryItem {
  id: string;
  from_version: string;
  to_version: string;
  status: string;
  backup_path: string | null;
  release_notes: string | null;
  error_message: string | null;
  performed_by: string | null;
  file_count: number;
  created_at: string;
}

function parseProxyError(text: string, status: number): string | null {
  if (status === 413 || text.includes("413") || text.toLowerCase().includes("request entity too large") || text.toLowerCase().includes("too large")) {
    return "The file is too large for your server's upload limit. Please increase the 'client_max_body_size' in your nginx configuration (e.g., client_max_body_size 500M;) and restart nginx.";
  }
  if (status === 502 || text.includes("502") || text.toLowerCase().includes("bad gateway")) {
    return "The server is temporarily unavailable (502 Bad Gateway). Please wait a moment and try again.";
  }
  if (status === 504 || text.includes("504") || text.toLowerCase().includes("gateway timeout")) {
    return "The upload timed out. Try increasing the proxy timeout in your nginx configuration, or use a smaller update package.";
  }
  if (text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("<head>")) {
    return `Server returned an unexpected error (HTTP ${status}). This usually means a reverse proxy (like nginx) is blocking the request. Check your server configuration.`;
  }
  return null;
}

async function safeJson(res: Response, fallbackMsg: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const proxyMsg = parseProxyError(text, res.status);
    if (proxyMsg) {
      throw new Error(proxyMsg);
    }
    throw new Error(text || fallbackMsg);
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  await ensureValidToken();
  const authHeader = AuthStorage.getAuthHeader();
  return authHeader ? { Authorization: authHeader } : {};
}

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready",
  validating: "Validating update package...",
  backing_up: "Creating file backup...",
  backing_up_db: "Backing up database...",
  extracting: "Extracting update files...",
  installing_deps: "Installing dependencies...",
  restarting: "Restarting application...",
  health_check: "Running health check...",
  complete: "Update complete!",
  rolling_back: "Rolling back changes...",
  failed: "Update failed",
};

const PHASE_PROGRESS: Record<string, number> = {
  idle: 0,
  validating: 10,
  backing_up: 25,
  backing_up_db: 40,
  extracting: 55,
  installing_deps: 70,
  restarting: 85,
  health_check: 90,
  complete: 100,
  rolling_back: 50,
  failed: 0,
};

export default function SystemUpdate() {
  const { toast } = useToast();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<string>("idle");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState("");
  const [showRollbackDialog, setShowRollbackDialog] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);

  const { data: statusData, refetch: refetchStatus } = useQuery<{ data: UpdateStatus }>({
    queryKey: ["/api/admin/system-update/status"],
    refetchInterval: (query) => {
      const data = query.state.data as { data: UpdateStatus } | undefined;
      return isUpdating || data?.data?.inProgress ? 2000 : 30000;
    },
  });

  const { data: historyData, isLoading: loadingHistory } = useQuery<{ data: { history: UpdateHistoryItem[] } }>({
    queryKey: ["/api/admin/system-update/history"],
  });

  useEffect(() => {
    if (statusData?.data) {
      const status = statusData.data;
      if (status.inProgress) {
        setIsUpdating(true);
        setUpdatePhase(status.phase);
        setUpdateProgress(status.progress || PHASE_PROGRESS[status.phase] || 0);
        setUpdateMessage(status.message || PHASE_LABELS[status.phase] || "");
      } else if (status.phase === "complete" || status.phase === "failed") {
        if (isUpdating) {
          if (status.phase === "complete") {
            toast({ title: "Update Complete", description: `Successfully updated to v${status.targetVersion || "latest"}` });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/system-update/history"] });
            setSelectedFile(null);
            setValidationResult(null);
          } else if (status.phase === "failed") {
            toast({ title: "Update Failed", description: status.error || "An error occurred during update", variant: "destructive" });
          }
        }
        setIsUpdating(false);
        setUpdatePhase(status.phase);
        setUpdateProgress(status.phase === "complete" ? 100 : 0);
        setUpdateMessage(status.message || PHASE_LABELS[status.phase] || "");
      }
    }
  }, [statusData]);

  const validateMutation = useMutation({
    mutationFn: async (file: File) => {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("update", file);
      let res: globalThis.Response;
      try {
        res = await fetch("/api/admin/system-update/validate", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });
      } catch (networkErr: any) {
        throw new Error("Upload failed: Could not connect to the server. Please check your server is running and try again.");
      }
      if (!res.ok) {
        const text = await res.text();
        const proxyMsg = parseProxyError(text, res.status);
        if (proxyMsg) throw new Error(proxyMsg);
        try {
          const err = JSON.parse(text);
          throw new Error(err.message || err.error || "Validation failed");
        } catch (e: any) {
          if (e.message && e.message !== text) throw e;
          throw new Error("Validation failed");
        }
      }
      return safeJson(res, "Validation failed");
    },
    onSuccess: (data) => {
      setValidationResult(data.data);
    },
    onError: (error: Error) => {
      toast({ title: "Validation Failed", description: error.message, variant: "destructive" });
      setSelectedFile(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (file: File) => {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("update", file);
      let res: globalThis.Response;
      try {
        res = await fetch("/api/admin/system-update/apply", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });
      } catch (networkErr: any) {
        throw new Error("Upload failed: Could not connect to the server. Please check your server is running and try again.");
      }
      if (!res.ok) {
        const text = await res.text();
        const proxyMsg = parseProxyError(text, res.status);
        if (proxyMsg) throw new Error(proxyMsg);
        try {
          const err = JSON.parse(text);
          throw new Error(err.message || err.error || "Update failed");
        } catch (e: any) {
          if (e.message && e.message !== text) throw e;
          throw new Error("Update failed");
        }
      }
      return safeJson(res, "Update failed");
    },
    onSuccess: () => {
      setIsUpdating(true);
      setUpdatePhase("validating");
      setUpdateProgress(10);
      setUpdateMessage("Update started...");
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
      setIsUpdating(false);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (updateId: string) => {
      return apiRequest("POST", `/api/admin/system-update/rollback/${updateId}`);
    },
    onSuccess: () => {
      toast({ title: "Rollback Started", description: "The system is being restored to the previous version." });
      setIsUpdating(true);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-update/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-update/status"] });
      setShowRollbackDialog(null);
    },
    onError: (error: Error) => {
      toast({ title: "Rollback Failed", description: error.message, variant: "destructive" });
      setShowRollbackDialog(null);
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (updateId: string) => {
      return apiRequest("DELETE", `/api/admin/system-update/backups/${updateId}`);
    },
    onSuccess: () => {
      toast({ title: "Backup Deleted", description: "The backup files have been removed to free up space." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-update/history"] });
      setShowDeleteDialog(null);
    },
    onError: (error: Error) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
      setShowDeleteDialog(null);
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".zip")) {
      setSelectedFile(file);
      setValidationResult(null);
      validateMutation.mutate(file);
    } else {
      toast({ title: "Invalid File", description: "Please upload a .zip file", variant: "destructive" });
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setValidationResult(null);
      validateMutation.mutate(file);
    }
    e.target.value = "";
  }, []);

  const currentVersion = statusData?.data?.currentVersion || "...";
  const history = historyData?.data?.history || [];

  function formatDate(dateStr: string) {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold" data-testid="text-system-update-title">Application Update</h3>
        <p className="text-sm text-muted-foreground">
          Upload a new version ZIP to update your application. Backups are created automatically before each update.
        </p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Current Version:</span>
          <Badge variant="outline" data-testid="badge-current-version">v{currentVersion}</Badge>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3" data-testid="alert-update-warning">
        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-yellow-700 dark:text-yellow-300">Important:</span>{" "}
          The system will create a full backup before updating. Your settings (.env), uploads, and database data are preserved.
          The application will restart automatically after the update.
        </div>
      </div>

      {isUpdating && (
        <Card data-testid="card-update-progress">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Update in Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={updateProgress} className="h-2" />
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium" data-testid="text-update-phase">
                {PHASE_LABELS[updatePhase] || updateMessage}
              </span>
              <span className="text-sm text-muted-foreground" data-testid="text-update-percent">
                {updateProgress}%
              </span>
            </div>
            {updatePhase === "failed" && statusData?.data?.error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{statusData.data.error}</span>
              </div>
            )}
            {updatePhase === "complete" && (
              <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Update applied successfully. The application will restart shortly.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isUpdating && (
        <Card data-testid="card-upload-update">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5" />
              Upload Update
            </CardTitle>
            <CardDescription>Upload the update .zip package provided by the developer</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-md p-8 text-center transition-colors ${
                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              data-testid="dropzone-update-upload"
            >
              <FileArchive className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag & drop your update .zip file here, or click to browse
              </p>
              <label>
                <Button variant="outline" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </span>
                </Button>
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-update-file"
                />
              </label>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-3" data-testid="text-selected-file">
                  Selected: {selectedFile.name} ({formatSize(selectedFile.size)})
                </p>
              )}
            </div>

            {validateMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating update package...
              </div>
            )}

            {validationResult && (
              <Card className="bg-muted/30" data-testid="card-validation-result">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-medium">Valid update package</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-medium">{validationResult.manifest.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Version:</span>
                      <span className="font-medium">
                        v{validationResult.currentVersion} → v{validationResult.manifest.version}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Files:</span>
                      <span className="font-medium">{validationResult.fileCount} files</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Size:</span>
                      <span className="font-medium">{formatSize(validationResult.totalSize)}</span>
                    </div>
                  </div>

                  {validationResult.manifest.releaseNotes && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Release Notes:</span>
                      <p className="mt-1 text-foreground whitespace-pre-line">{validationResult.manifest.releaseNotes}</p>
                    </div>
                  )}

                  <div className="flex items-start gap-3 rounded-md bg-blue-500/10 p-3 text-sm">
                    <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="text-muted-foreground">
                      A full backup of your files and database will be created before applying this update. You can rollback at any time from the update history below.
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      onClick={() => selectedFile && applyMutation.mutate(selectedFile)}
                      disabled={applyMutation.isPending}
                      data-testid="button-apply-update"
                    >
                      {applyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowUpCircle className="h-4 w-4 mr-2" />
                      )}
                      Apply Update
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedFile(null);
                        setValidationResult(null);
                      }}
                      data-testid="button-cancel-update"
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-update-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Update History
          </CardTitle>
          <CardDescription>Previous updates with rollback capability</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-history">
              No updates have been applied yet. Upload a version ZIP above to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 flex-wrap rounded-md border p-3"
                  data-testid={`row-update-${item.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.status === "success" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                    ) : item.status === "rolled_back" ? (
                      <RotateCcw className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          v{item.from_version} → v{item.to_version}
                        </span>
                        <Badge
                          variant={item.status === "success" ? "default" : item.status === "rolled_back" ? "secondary" : "destructive"}
                        >
                          {item.status === "success" ? "Success" : item.status === "rolled_back" ? "Rolled Back" : "Failed"}
                        </Badge>
                        {item.file_count > 0 && (
                          <span className="text-xs text-muted-foreground">{item.file_count} files</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(item.created_at)}
                        {item.release_notes && (
                          <span className="ml-2">- {item.release_notes.substring(0, 80)}{item.release_notes.length > 80 ? "..." : ""}</span>
                        )}
                      </div>
                      {item.error_message && (
                        <div className="text-xs text-destructive mt-0.5">{item.error_message}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.backup_path && item.status === "success" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRollbackDialog(item.id)}
                        disabled={rollbackMutation.isPending || isUpdating}
                        data-testid={`button-rollback-${item.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Rollback
                      </Button>
                    )}
                    {item.backup_path && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowDeleteDialog(item.id)}
                        disabled={deleteBackupMutation.isPending || isUpdating}
                        data-testid={`button-delete-backup-${item.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!showRollbackDialog} onOpenChange={() => setShowRollbackDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Rollback</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the application to the previous version from the backup.
              Your database data and uploads will not be affected. The application will restart after the rollback.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-rollback-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => showRollbackDialog && rollbackMutation.mutate(showRollbackDialog)}
              data-testid="button-rollback-confirm"
            >
              {rollbackMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Rollback
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the backup files for this update. You will no longer be able to rollback to this version.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => showDeleteDialog && deleteBackupMutation.mutate(showDeleteDialog)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-confirm"
            >
              {deleteBackupMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
