'use strict';
(() => {
  let records = [];
  const dialog = document.getElementById('ooModal');
  const form = document.getElementById('ooForm');
  const container = document.getElementById('ooList');
  const errorBox = document.getElementById('institutionError');
  const fields = {codeOmsu:'code_omsu',codeOo:'code_oo',numberOo:'number_oo',nameOo:'name_oo',fullName:'full_name'};
  function open(record) {
    form.reset(); document.getElementById('recordId').value = record?.id || '';
    Object.entries(fields).forEach(([id,key]) => { document.getElementById(id).value = record?.[key] || ''; });
    document.getElementById('modalTitle').textContent = record ? 'Изменить учреждение' : 'Добавить учреждение';
    Exam.message(errorBox,''); dialog.showModal();
  }
  async function load() {
    try {
      const result = await Exam.request('/api/oo'); records = result.oo || [];
      document.getElementById('institutionCount').textContent = records.length;
      container.innerHTML = records.length ? records.map(record => `<article class="record-card"><h3>${Exam.escape(record.full_name || record.name_oo || 'Учреждение')}</h3><dl class="record-meta"><div><dt>Код ОМСУ</dt><dd>${Exam.escape(record.code_omsu || '—')}</dd></div><div><dt>Код ОО</dt><dd>${Exam.escape(record.code_oo || '—')}</dd></div><div><dt>Номер ОО</dt><dd>${Exam.escape(record.number_oo || '—')}</dd></div><div><dt>Краткое название</dt><dd>${Exam.escape(record.name_oo || '—')}</dd></div></dl><div class="button-row"><button type="button" class="btn btn-secondary btn-sm" data-edit="${Number(record.id)}">Изменить</button><button type="button" class="btn btn-danger btn-sm" data-delete="${Number(record.id)}">Удалить</button></div></article>`).join('') : '<div class="empty-state"><h3>Нет данных об учреждениях</h3><p>Добавьте учреждение или загрузите сведения в разделе импорта.</p><a href="/import" class="btn btn-secondary">Перейти к импорту</a></div>';
    } catch (error) { container.innerHTML = ''; Exam.message(document.getElementById('globalMessage'),error.message); }
  }
  document.getElementById('addInstitution').addEventListener('click',() => open());
  container.addEventListener('click',async event => {
    const edit = event.target.closest('[data-edit]');
    if (edit) { open(records.find(record => Number(record.id) === Number(edit.dataset.edit))); return; }
    const remove = event.target.closest('[data-delete]');
    if (!remove || !window.confirm('Удалить сведения об этом учреждении?')) return;
    try { await Exam.busy(remove,'Удаляем…',() => Exam.request(`/api/oo/${Number(remove.dataset.delete)}`,{method:'DELETE'})); await load(); Exam.toast('Учреждение удалено.'); }
    catch (error) { Exam.toast(error.message,'error'); }
  });
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const id = document.getElementById('recordId').value;
    const data = Object.fromEntries(Object.entries(fields).map(([input,key]) => [key,document.getElementById(input).value.trim()]));
    if (!data.full_name) { Exam.message(errorBox,'Введите полное наименование учреждения.'); return; }
    try {
      await Exam.busy(form.querySelector('[type=submit]'),'Сохраняем…',() => Exam.json(id ? `/api/oo/${Number(id)}` : '/api/oo',id ? 'PUT' : 'POST',data));
      dialog.close(); await load(); Exam.toast('Сведения сохранены.');
    } catch (error) { Exam.message(errorBox,error.message); }
  });
  load();
})();
