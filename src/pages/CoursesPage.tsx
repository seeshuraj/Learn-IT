import React, { useEffect, useState } from "react";
import { User } from "../types";
import { Search, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type CourseSummary } from "../services/api";

interface CoursesPageProps {
  user: User;
}

export const CoursesPage: React.FC<CoursesPageProps> = ({ user }) => {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const isStudent = user.role === 'student';

  useEffect(() => {
    let live = true;
    api.getCourses()
      .then(data => { if (live) setCourses(Array.isArray(data) ? data : []); })
      .catch(e => { if (live) { setCourses([]); setError(e.message || 'Could not load courses'); } });
    return () => { live = false; };
  }, [user.id, user.role]);

  const q = search.trim().toLowerCase();
  const filteredCourses = (courses ?? []).filter(c =>
    c.name.toLowerCase().includes(q) || (c.code ?? '').toLowerCase().includes(q)
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">My Courses</h1>
          <p className="text-slate-500 mt-1">
            {isStudent ? 'Courses you are enrolled in.' : 'Courses you teach.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search courses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search courses"
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all w-full sm:w-64"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredCourses.map(course => (
          <Link
            key={course.id}
            to={`/courses/${course.id}`}
            className="group bg-white rounded-[32px] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-indigo-600/10 hover:border-indigo-100 transition-all overflow-hidden flex flex-col"
          >
            <div className="h-40 bg-indigo-600 relative overflow-hidden">
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,#fff_0%,transparent_50%)]"></div>
              </div>
              <div className="absolute top-6 left-6 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-bold text-white uppercase tracking-widest">
                {course.code}
              </div>
              <div className="absolute bottom-6 left-6">
                <h3 className="text-xl font-bold text-white mb-1">{course.name}</h3>
                {course.instructor_name && <p className="text-xs text-indigo-100">{course.instructor_name}</p>}
              </div>
            </div>
            <div className="p-8 flex-1 flex flex-col">
              <div className="flex items-center gap-6 mb-8">
                <div className="flex-1">
                  <p className="text-xs text-slate-500 mb-1">Modules</p>
                  <p className="text-sm font-bold text-slate-900">{course.module_count}</p>
                </div>
                {!isStudent && (
                  <div className="flex-1">
                    <p className="text-xs text-slate-500 mb-1">Students</p>
                    <p className="text-sm font-bold text-slate-900">{course.student_count}</p>
                  </div>
                )}
              </div>
              <div className="mt-auto flex items-center justify-end">
                <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                  Open course <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </Link>
        ))}
        {courses === null && (
          <p className="text-slate-500 text-sm col-span-full">Loading courses…</p>
        )}
        {courses !== null && filteredCourses.length === 0 && (
          <p className="text-slate-500 text-sm col-span-full">
            {error ? error
              : q ? `No course matches “${search}”.`
              : isStudent ? "You aren't enrolled in any course yet. Your college admin adds you to courses."
              : "You aren't teaching any course yet. Your college admin assigns courses to professors."}
          </p>
        )}
      </div>
    </div>
  );
};
