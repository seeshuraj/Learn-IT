import React, { useEffect, useState } from "react";
import { User } from "../types";
import { Users, Search, UserPlus, CheckCircle2, XCircle, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";

// ── Temp Password Modal ─────────────────────────────────────────────────────
interface TempPasswordModalProps {
  name: string;
  email: string;
  password: string;
  onClose: () => void;
}

const TempPasswordModal: React.FC<TempPasswordModalProps> = ({ name, email, password, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-slate-900 text-center mb-1">User Created</h2>
        <p className="text-sm text-slate-500 text-center mb-6">
          Share the temporary password with <span className="font-semibold text-slate-700">{name}</span>.
          They will be prompted to set a new password on first login.
        </p>

        {/* User info */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400 font-medium">Name</span>
            <span className="text-slate-800 font-semibold">{name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400 font-medium">Email</span>
            <span className="text-slate-800 font-semibold">{email}</span>
          </div>
        </div>

        {/* Password box */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">Temporary Password</p>
          <div className="flex items-center justify-between gap-3">
            <code className="text-base font-mono font-bold text-amber-900 break-all select-all">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 p-2 rounded-xl hover:bg-amber-100 transition-colors text-amber-700"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center mb-6">
          ⚠️ This password is shown <span className="font-semibold">once only</span> and cannot be recovered.
          Copy it before closing.
        </p>

        <button
          onClick={onClose}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors"
        >
          Done
        </button>
      </motion.div>
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────
export const AdminUserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempCreds, setTempCreds] = useState<{ name: string; email: string; password: string } | null>(null);

  useEffect(() => {
    api.getAdminUsers().then((data: any) => setUsers(Array.isArray(data) ? data : []));
  }, []);

  const filteredUsers = users.filter(
    u =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleStatus = async (user: User) => {
    const newStatus = (user as any).active === 1 ? 0 : 1;
    try {
      await api.updateAdminUser(user.id, { ...(user as any), active: newStatus });
      setUsers(prev =>
        prev.map(u => (u.id === user.id ? { ...u, active: newStatus } as any : u))
      );
      toast.success(`User ${newStatus === 1 ? "activated" : "deactivated"}`);
    } catch {
      toast.error("Failed to update user");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const newUser = {
      name:  formData.get("name")  as string,
      email: formData.get("email") as string,
      role:  formData.get("role")  as string,
      major: formData.get("major") as string,
      year:  Number(formData.get("year")),
    };
    try {
      const data: any = await api.createAdminUser(newUser);
      setUsers(prev => [...prev, { ...newUser, id: data.id, active: 1 } as any]);
      setIsModalOpen(false);
      form.reset();
      // Show temp password modal if backend returned one
      if (data.tempPassword && !data.tempPassword.startsWith("(")) {
        setTempCreds({ name: newUser.name, email: newUser.email, password: data.tempPassword });
      } else {
        toast.success("User added successfully");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to add user");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster richColors />

      {/* Add User form modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Add New User</h2>
            <p className="text-sm text-slate-500 mb-6">Create a new account for LearnIT.</p>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Full Name</label>
                <input name="name" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="e.g. John Doe" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email Address</label>
                <input name="email" type="email" required className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="john@learnit.edu" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Role</label>
                <select name="role" className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500">
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Year (Optional)</label>
                <input name="year" type="number" className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="1–4" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Major (Optional)</label>
                <input name="major" className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="Computer Science" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                <button type="submit" className="flex-1 py-3 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Temp password modal */}
      <AnimatePresence>
        {tempCreds && (
          <TempPasswordModal
            name={tempCreds.name}
            email={tempCreds.email}
            password={tempCreds.password}
            onClose={() => setTempCreds(null)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-500 mt-1">Manage students, instructors, and administrators.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
        >
          <UserPlus className="w-4 h-4" /> Add New User
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>
          <span className="text-sm text-slate-500">Total: {users.length}</span>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">User</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Role</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Major / Year</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredUsers.map(user => (
              <motion.tr
                key={(user as any).id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="hover:bg-slate-50/50 transition-colors"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                      {user.name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 capitalize">{user.role}</span>
                </td>
                <td className="px-6 py-4">
                  <span className={`flex items-center gap-1.5 text-xs font-bold w-fit px-3 py-1 rounded-full ${
                    (user as any).active === 1 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                  }`}>
                    {(user as any).active === 1
                      ? <CheckCircle2 className="w-3 h-3" />
                      : <XCircle className="w-3 h-3" />}
                    {(user as any).active === 1 ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">
                  {(user as any).major || "-"} {(user as any).year ? `Year ${(user as any).year}` : ""}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => handleToggleStatus(user)}
                    className={`p-2 rounded-lg transition-colors ${
                      (user as any).active === 1
                        ? "text-slate-400 hover:bg-red-50 hover:text-red-500"
                        : "text-slate-400 hover:bg-emerald-50 hover:text-emerald-500"
                    }`}
                  >
                    {(user as any).active === 1
                      ? <XCircle className="w-4 h-4" />
                      : <CheckCircle2 className="w-4 h-4" />}
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
