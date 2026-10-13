'use strict';
(() => {
  let classrooms = JSON.parse(document.getElementById('classroomData').textContent);
  const form = document.getElementById('addClassroomForm');
  const cancelButton = document.getElementById('cancelRoomEdit');
  const errorBox = document.getElementById('classroomFormError');
  const fields = ['номер_кабинета','количество_парт','количество_рядов_парт','этаж'];
  function resetForm() {
    form.reset(); form.elements.id.value = '';
    document.getElementById('classroomFormTitle').textContent = 'Добавить кабинет';
    form.querySelector('[type=submit]').textContent = 'Добавить кабинет';
    cancelButton.hidden = true; Exam.message(errorBox,'');
  }
  function render() {
    document.getElementById('roomCount').textContent = classrooms.length;
    document.getElementById('classroomsTable').innerHTML = classrooms.length ? classrooms.map(room => `<article class="classroom-item"><div><strong>Кабинет №${Exam.escape(room.номер_кабинета)}</strong><div class="classroom-info">${Exam.escape(room.количество_парт)} парт · ${Exam.escape(room.количество_рядов_парт)} рядов · ${Exam.escape(room.этаж)} этаж</div><div class="classroom-info">${Number(room.количество_парт) * 2} мест</div></div><div class="classroom-actions"><button class="btn btn-secondary btn-sm" data-edit="${Number(room.id)}">Изменить</button><button class="btn btn-danger btn-sm" data-delete="${Number(room.id)}">Удалить</button></div></article>`).join('') : '<div class="empty-state"><h3>Пока нет кабинетов</h3><p>Добавьте первый кабинет с помощью формы.</p></div>';
  }
  cancelButton.addEventListener('click',resetForm);
  form.addEventListener('submit',async event => {
    event.preventDefault(); Exam.message(errorBox,'');
    const data = Object.fromEntries(fields.map(field => [field,Number(form.elements[field].value)]));
    if (fields.some(field => !Number.isInteger(data[field]) || data[field] < 1) || data.количество_рядов_парт > data.количество_парт || data.количество_рядов_парт > 6) {
      Exam.message(errorBox,'Введите положительные целые числа. Допускается до 6 рядов, не больше количества парт.'); return;
    }
    const id = Number(form.elements.id.value);
    try {
      const result = await Exam.busy(form.querySelector('[type=submit]'),'Сохраняем…', () => Exam.json(id ? `/api/classrooms/${id}` : '/api/classrooms',id ? 'PUT' : 'POST',data));
      if (id) classrooms = classrooms.map(room => room.id === id ? result.classroom : room);
      else classrooms.push(result.classroom);
      render(); resetForm(); Exam.toast(id ? 'Кабинет обновлён.' : 'Кабинет добавлен.');
    } catch (error) { Exam.message(errorBox,error.message); }
  });
  document.getElementById('classroomsTable').addEventListener('click',async event => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const room = classrooms.find(item => Number(item.id) === Number(edit.dataset.edit));
      form.elements.id.value = room.id;
      fields.forEach(field => { form.elements[field].value = room[field]; });
      document.getElementById('classroomFormTitle').textContent = `Изменить кабинет №${room.номер_кабинета}`;
      form.querySelector('[type=submit]').textContent = 'Сохранить изменения'; cancelButton.hidden = false;
      Exam.message(errorBox,''); form.elements['номер_кабинета'].focus(); return;
    }
    const remove = event.target.closest('[data-delete]');
    if (!remove || !window.confirm('Удалить кабинет? Участники этого кабинета останутся в списке без назначенного места.')) return;
    try {
      const id = Number(remove.dataset.delete);
      await Exam.busy(remove,'Удаляем…', () => Exam.request(`/api/classrooms/${id}`,{method:'DELETE'}));
      classrooms = classrooms.filter(room => Number(room.id) !== id); render();
      if (Number(form.elements.id.value) === id) resetForm();
      Exam.toast('Кабинет удалён.');
    } catch (error) { Exam.toast(error.message,'error'); }
  });
  render();
})();
