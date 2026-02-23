import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Module, Course, User } from "../types";
import { 
  BookOpen, FileText, PlayCircle, MessageSquare, 
  ChevronRight, ArrowLeft, Download, Bot
} from "lucide-react";
import { ChatBot } from "../components/ChatBot";
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";

interface CourseDetailPageProps {
  user: User;
}

export const CourseDetailPage: React.FC<CourseDetailPageProps> = ({ user }) => {
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    fetch("/api/courses").then(res => res.json()).then(courses => {
      const found = courses.find((c: Course) => c.id === Number(id));
      setCourse(found);
    });
    fetch(`/api/courses/${id}/modules`).then(res => res.json()).then(setModules);
  }, [id]);

  if (!course) return null;

  return (
    <div className="max-w-7xl mx-auto">
      <Toaster position="top-right" />
      <div className="mb-8">
        <Link to="/courses" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Courses
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-indigo-100 text-indigo-600 rounded-full text-[10px] font-bold uppercase tracking-wider">{course.code}</span>
              <span className="text-slate-400">•</span>
              <span className="text-sm text-slate-500">{course.instructor_name}</span>
            </div>
            <h1 className="text-4xl font-bold text-slate-900">{course.name}</h1>
          </div>
          <div className="flex gap-3">
            <button className="px-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all">
              Course Syllabus
            </button>
            <button 
              onClick={() => setShowChat(!showChat)}
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
            >
              <Bot className="w-5 h-5" />
              AI Module Tutor
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Course Modules</h2>
          {modules.map((module, index) => (
            <div 
              key={module.id}
              className={`bg-white rounded-3xl border transition-all overflow-hidden ${
                selectedModule?.id === module.id ? "border-indigo-500 shadow-xl shadow-indigo-600/5" : "border-slate-100 shadow-sm"
              }`}
            >
              <button 
                onClick={() => setSelectedModule(selectedModule?.id === module.id ? null : module)}
                className="w-full flex items-center justify-between p-6 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{module.name}</h3>
                    <p className="text-xs text-slate-500">2 Notes • 1 Video • 1 Assignment</p>
                  </div>
                </div>
                <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${selectedModule?.id === module.id ? "rotate-90" : ""}`} />
              </button>

              <AnimatePresence>
                {selectedModule?.id === module.id && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-slate-50 bg-slate-50/50"
                  >
                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between group cursor-pointer hover:border-indigo-200 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="bg-red-50 text-red-500 p-2 rounded-lg">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">Lecture Notes.pdf</p>
                              <p className="text-[10px] text-slate-500">2.4 MB • PDF</p>
                            </div>
                          </div>
                          <Download className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                        </div>
                        <div className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between group cursor-pointer hover:border-indigo-200 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="bg-blue-50 text-blue-500 p-2 rounded-lg">
                              <PlayCircle className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">Module Overview.mp4</p>
                              <p className="text-[10px] text-slate-500">15:20 • Video</p>
                            </div>
                          </div>
                          <PlayCircle className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                        </div>
                      </div>
                      <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Bot className="w-5 h-5 text-indigo-600" />
                          <p className="text-sm font-medium text-indigo-900">Need help with this module?</p>
                        </div>
                        <button 
                          onClick={() => setShowChat(true)}
                          className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                        >
                          Ask AI Tutor →
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        <div className="space-y-8">
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-4">Instructor</h3>
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold">
                {course.instructor_name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{course.instructor_name}</p>
                <p className="text-xs text-slate-500">Professor of AI</p>
              </div>
            </div>
            <button className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2">
              <MessageSquare className="w-4 h-4" /> Message Instructor
            </button>
          </div>

          <div className="bg-slate-900 rounded-3xl p-6 text-white">
            <h3 className="font-bold mb-4">Course Progress</h3>
            <div className="space-y-4">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-400">COMPLETION</span>
                <span>65%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-indigo-500 h-full w-[65%]"></div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4">
                <div className="text-center p-3 bg-slate-800 rounded-2xl">
                  <p className="text-lg font-bold">12/18</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Lessons</p>
                </div>
                <div className="text-center p-3 bg-slate-800 rounded-2xl">
                  <p className="text-lg font-bold">4/6</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Tasks</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showChat && (
        <div className="fixed bottom-8 right-8 z-50">
          <ChatBot 
            moduleId={selectedModule?.id || modules[0]?.id || 1} 
            moduleName={selectedModule?.name || modules[0]?.name || "Course"} 
            moduleContent={selectedModule?.content || modules[0]?.content || ""}
            onClose={() => setShowChat(false)}
          />
        </div>
      )}
    </div>
  );
};
