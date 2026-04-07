"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  UserCog,
  UserMinus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useAuthGuard } from "@/hooks/use-auth-guard";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/toaster";
import {
  fetchUsers,
  approveUser,
  rejectUser,
  changeUserRole,
  deleteUser,
} from "@/lib/queries";
import type { User } from "@/lib/types";

const ROLES = ["Admin", "Content Creators", "Listing Executives"];

export default function AdminUsersPage() {
  const { ready } = useAuthGuard({ requireRole: "Admin" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const { username: currentUsername } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"pending" | "active">("pending");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  // Modal state
  const [approveTarget, setApproveTarget] = useState<User | null>(null);
  const [approveRole, setApproveRole] = useState<string>("Content Creators");
  const [roleTarget, setRoleTarget] = useState<User | null>(null);
  const [roleDraft, setRoleDraft] = useState<string>("Content Creators");
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [rejectTarget, setRejectTarget] = useState<User | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: ready,
  });

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const users = usersQuery.data ?? [];
  const pendingUsers = users.filter((u) => u.is_approved !== 1);
  const activeUsers = users.filter((u) => u.is_approved === 1);

  const setBusy = (id: number, on: boolean) =>
    setBusyIds((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const doApprove = async () => {
    if (!approveTarget) return;
    setBusy(approveTarget.id, true);
    try {
      await approveUser(approveTarget.id, approveRole);
      toast({ title: `Approved ${approveTarget.username} as ${approveRole}`, variant: "success" });
      refresh();
    } catch {
      toast({ title: "Approve failed", variant: "error" });
    } finally {
      setBusy(approveTarget.id, false);
      setApproveTarget(null);
    }
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    setBusy(rejectTarget.id, true);
    try {
      await rejectUser(rejectTarget.id);
      toast({ title: `Rejected ${rejectTarget.username}`, variant: "warning" });
      refresh();
    } catch {
      toast({ title: "Reject failed", variant: "error" });
    } finally {
      setBusy(rejectTarget.id, false);
      setRejectTarget(null);
    }
  };

  const doChangeRole = async () => {
    if (!roleTarget) return;
    setBusy(roleTarget.id, true);
    try {
      await changeUserRole(roleTarget.id, roleDraft);
      toast({ title: `Role updated for ${roleTarget.username}`, variant: "success" });
      refresh();
    } catch {
      toast({ title: "Role update failed", variant: "error" });
    } finally {
      setBusy(roleTarget.id, false);
      setRoleTarget(null);
    }
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    setBusy(removeTarget.id, true);
    try {
      await deleteUser(removeTarget.id);
      toast({ title: `Removed ${removeTarget.username}`, variant: "success" });
      refresh();
    } catch {
      toast({ title: "Remove failed", variant: "error" });
    } finally {
      setBusy(removeTarget.id, false);
      setRemoveTarget(null);
    }
  };

  const list = tab === "pending" ? pendingUsers : activeUsers;

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">User Management</h1>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-md border p-1">
          {(["pending", "active"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {t === "pending" ? `Pending (${pendingUsers.length})` : `Active (${activeUsers.length})`}
            </button>
          ))}
        </div>

        {usersQuery.isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {usersQuery.isSuccess && list.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No {tab} users.
          </p>
        )}

        <div className="space-y-2">
          {list.map((u) => {
            const isMe = u.username === currentUsername;
            const isRejected = u.is_approved === -1;
            const busy = busyIds.has(u.id);
            return (
              <Card key={u.id}>
                <CardContent className="flex items-center gap-3 pt-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{u.username}</p>
                      {isMe && <Badge variant="outline">You</Badge>}
                      {isRejected && <Badge variant="destructive">Rejected</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {u.is_approved === 1 ? u.role : "Pending approval"}
                    </p>
                  </div>
                  {busy ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : tab === "active" ? (
                    <>
                      {!isMe && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setRoleTarget(u);
                            setRoleDraft(u.role);
                          }}
                          aria-label="Change role"
                        >
                          <UserCog className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                      {!isMe && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRemoveTarget(u)}
                          aria-label="Remove user"
                        >
                          <UserMinus className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setApproveTarget(u);
                          setApproveRole("Content Creators");
                        }}
                        aria-label="Approve"
                      >
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      </Button>
                      {!isRejected && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRejectTarget(u)}
                          aria-label="Reject"
                        >
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Approve dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(v) => !v && setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {approveTarget?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Assign a role:</p>
            <Select value={approveRole} onChange={(e) => setApproveRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button onClick={doApprove}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change role dialog */}
      <Dialog open={!!roleTarget} onOpenChange={(v) => !v && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role for {roleTarget?.username}</DialogTitle>
          </DialogHeader>
          <Select value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>Cancel</Button>
            <Button onClick={doChangeRole}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.username}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This permanently deletes the user.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doRemove}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectTarget?.username}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This user will not be able to sign in. They can be approved later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doReject}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
