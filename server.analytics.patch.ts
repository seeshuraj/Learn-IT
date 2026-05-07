// ─────────────────────────────────────────────────────────────────────────────
// PASTE THESE TWO ROUTE BLOCKS INTO server.ts
// Place them inside the `startServer()` function, after the /api/submissions routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/students/:id/analytics
// Returns per-course grade breakdown for a student
//
// app.get('/api/students/:id/analytics', (req, res) => {
//   const studentId = req.params.id;
//
//   const student = db.prepare('SELECT name FROM users WHERE id = ?').get(studentId) as any;
//   if (!student) return res.status(404).json({ error: 'Student not found' });
//
//   const enrolledCourses = db.prepare(`
//     SELECT c.id, c.code as course_code, c.name as course_name
//     FROM enrollments e JOIN courses c ON e.course_id = c.id
//     WHERE e.student_id = ?
//   `).all(studentId) as any[];
//
//   const courses = enrolledCourses.map((course: any) => {
//     const assignments = db.prepare(`
//       SELECT a.id, a.title
//       FROM assignments a JOIN modules m ON a.module_id = m.id
//       WHERE m.course_id = ? AND a.status = 'active'
//     `).all(course.id) as any[];
//
//     const grades = db.prepare(`
//       SELECT a.title, s.grade, s.submitted_at
//       FROM submissions s JOIN assignments a ON s.assignment_id = a.id
//       JOIN modules m ON a.module_id = m.id
//       WHERE s.student_id = ? AND m.course_id = ? AND s.grade IS NOT NULL
//       ORDER BY s.submitted_at ASC
//     `).all(studentId, course.id) as any[];
//
//     const avg = grades.length > 0
//       ? grades.reduce((sum: number, g: any) => sum + g.grade, 0) / grades.length
//       : null;
//
//     return {
//       course_code: course.course_code,
//       course_name: course.course_name,
//       assignments_total: assignments.length,
//       assignments_submitted: grades.length,
//       avg_grade: avg != null ? Math.round(avg * 10) / 10 : null,
//       grades,
//     };
//   });
//
//   const allGrades = courses.flatMap((c: any) => c.grades.map((g: any) => g.grade));
//   const overall_avg = allGrades.length > 0
//     ? Math.round((allGrades.reduce((a: number, b: number) => a + b, 0) / allGrades.length) * 10) / 10
//     : null;
//
//   const totalAssignments = db.prepare(`
//     SELECT COUNT(*) as count FROM assignments a
//     JOIN modules m ON a.module_id = m.id
//     JOIN enrollments e ON m.course_id = e.course_id
//     WHERE e.student_id = ? AND a.status = 'active'
//   `).get(studentId) as any;
//
//   const totalSubmitted = db.prepare(
//     'SELECT COUNT(*) as count FROM submissions WHERE student_id = ?'
//   ).get(studentId) as any;
//
//   res.json({
//     student_name: student.name,
//     overall_avg,
//     total_submitted: totalSubmitted.count,
//     total_pending: Math.max(0, totalAssignments.count - totalSubmitted.count),
//     courses,
//   });
// });

// POST /api/ai/analytics-summary
// Sends student analytics to NIM and returns an AI-generated summary
//
// app.post('/api/ai/analytics-summary', async (req, res) => {
//   try {
//     const { analytics } = req.body;
//     const prompt = `You are an academic advisor AI. A student named ${analytics.student_name} has the following performance data across their courses:\n\n${
//       analytics.courses.map((c: any) =>
//         `Course: ${c.course_code} ${c.course_name}\n  Average: ${c.avg_grade != null ? c.avg_grade + '%' : 'No grades yet'}\n  Submitted: ${c.assignments_submitted}/${c.assignments_total} assignments`
//       ).join('\n\n')
//     }\n\nOverall average: ${analytics.overall_avg != null ? analytics.overall_avg + '%' : 'No grades yet'}.\n\nWrite a concise 3-4 sentence personalised summary: where they are doing well, where they should focus, and one actionable tip. Be encouraging but honest.`;
//     const summary = await nimChat([{ role: 'user', content: prompt }], { maxTokens: 300 });
//     res.json({ summary });
//   } catch (err: any) {
//     res.status(500).json({ error: err.message });
//   }
// });
