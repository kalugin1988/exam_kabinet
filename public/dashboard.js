'use strict';
(async () => {
  try {
    const [students,classrooms,subjects] = await Promise.all([Exam.request('/api/students'),Exam.request('/api/classrooms'),Exam.request('/api/subjects')]);
    const roster = students.students || [];
    document.getElementById('participantCount').textContent = roster.length.toLocaleString('ru-RU');
    document.getElementById('seatedCount').textContent = roster.filter(student => student.номер_кабинета != null && student.номер_места).length.toLocaleString('ru-RU');
    document.getElementById('classroomCount').textContent = (classrooms.classrooms || []).length.toLocaleString('ru-RU');
    document.getElementById('subjectCount').textContent = (subjects.subjects || []).length.toLocaleString('ru-RU');
  } catch (error) { Exam.message(document.getElementById('globalMessage'),error.message); }
})();
