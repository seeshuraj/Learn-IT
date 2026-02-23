import React, { useEffect, useState } from "react";
import { Course } from "../types";
import { BookOpen, Search, Filter, ArrowRight, Star } from "lucide-react";
import { Link } from "react-router-dom";

export const CoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/courses").then(res => res.json()).then(setCourses);
  }, []);

  const filteredCourses = courses.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-bold text-slate-900">My Courses</h1>
          <p className="text-slate-500 mt-1">Manage and explore your academic journey.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search courses..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all w-64"
            />
          </div>
          <button className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-all">
            <Filter className="w-5 h-5" />
          </button>
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
                <p className="text-xs text-indigo-100">{course.instructor_name}</p>
              </div>
            </div>
            <div className="p-8 flex-1 flex flex-col">
              <div className="flex items-center gap-6 mb-8">
                <div className="flex-1">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Modules</p>
                  <p className="text-sm font-bold text-slate-900">12 Lessons</p>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Students</p>
                  <p className="text-sm font-bold text-slate-900">45 Enrolled</p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between">
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="w-4 h-4 fill-current" />
                  <span className="text-sm font-bold">4.8</span>
                </div>
                <div className="text-indigo-600 font-bold text-sm flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                  Enter Course <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};
