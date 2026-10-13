'use strict';
(() => {
  const form = document.getElementById('documentForm');
  const all = document.getElementById('allClassrooms');
  const classroom = document.getElementById('documentClassroom');
  const classroomFields = document.getElementById('classroomFields');
  const types = new Set(['generate','general-statement','transfer-act','accompanying-sheet','registration-list']);
  function update() {
    const type = form.querySelector('[name=document_type]:checked').value;
    const needsClassroom = ['generate','accompanying-sheet','registration-list'].includes(type);
    classroomFields.hidden = !needsClassroom;
    classroom.disabled = !needsClassroom || all.checked;
    classroom.required = needsClassroom && !all.checked;
    all.disabled = !needsClassroom;
    form.action = `/forms/${types.has(type) ? type : 'generate'}`;
  }
  form.querySelectorAll('[name=document_type]').forEach(input => input.addEventListener('change',update));
  all.addEventListener('change',update);
  form.addEventListener('submit',event => {
    Exam.message(document.getElementById('documentError'),'');
    if (!form.reportValidity()) { event.preventDefault(); return; }
    if (!document.getElementById('siteCode').value.trim()) {
      event.preventDefault(); Exam.message(document.getElementById('documentError'),'Введите код площадки.'); document.getElementById('siteCode').focus();
    }
  });
  update();
})();
