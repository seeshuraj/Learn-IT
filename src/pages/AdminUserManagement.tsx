import React, { useEffect, useState } from "react";
import { User } from "../types";
import { Users, Search, UserPlus, CheckCircle2, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { toast, Toaster } from "sonner";
import { api } from "../services/api";

export const AdminUserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

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
      toast.success(`User ${newStatus === 1 ? 'activated' : 'deactivated'}`);
    } catch (e) {
      toast.error("Failed to update user");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const newUser = {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      role: formData.get("role") as string,
      major: formData.get("major") as string,
      year: Number(formData.get("year")),
    };
    try {
      const data: any = await api.createAdminUser(newUser);
      setUsers(prev => [...prev, { ...newUser, id: data.id, active: 1 } as any]);
      setIsModalOpen(false);
      toast.success("User added successfully");
    } catch (e: any) {
      toast.error(e.message || "Failed to add user");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <Toaster richColors />

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">
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
                <input name="year" type="number" className="w-full p-3 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500" placeholder="1-4" />
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
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Major/Year</th>
              <th className="text-left px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredUsers.map(user => (
              <motion.tr key={(user as any).id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
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
                  <span className={`flex items-center gap-1.5 text-xs font-bold w-fit px-3 py-1 rounded-full ${ (user as any).active === 1 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                    {(user as any).active === 1 ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {(user as any).active === 1 ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">
                  {(user as any).major || '-'} {(user as any).year ? `Year ${(user as any).year}` : ''}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => handleToggleStatus(user)}
                    className={`p-2 rounded-lg transition-colors ${ (user as any).active === 1 ? 'text-slate-400 hover:bg-red-50 hover:text-red-500' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-500'}`}
                  >
                    {(user as any).active === 1 ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
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
