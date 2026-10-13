'use strict';
(() => {
  const initial = JSON.parse(document.getElementById('seatingData').textContent);
  const classrooms = initial.classrooms;
  let students = initial.students;
  let blocked = new Map();
  let draggedId;
  let chosenSeat;
  let chosenStudent;
  const letters = ['А','Б','В','Г','Д','Е','Ж','З','И','К','Л','М'];
  const container = document.getElementById('classroomsContainer');
  const dialog = document.getElementById('seatDialog');
  const content = document.getElementById('seatDialogContent');
  const errorBox = document.getElementById('seatDialogError');
  const esc = Exam.escape;
  const fullName = student => [student.фимилия,student.имя,student.отчество].filter(Boolean).join(' ');
  function openDialog(title,html) {
    document.getElementById('seatDialogTitle').textContent = title;
    content.innerHTML = html; Exam.message(errorBox,'');
    if (!dialog.open) dialog.showModal();
  }
  function seatStudent(room,place) { return students.find(student => Number(student.номер_кабинета) === Number(room.номер_кабинета) && student.номер_места === place); }
  function seatButton(room,place,row,desk) {
    const student = seatStudent(room,place);
    const isBlocked = (blocked.get(Number(room.id)) || []).includes(place);
    return `<button type="button" class="desk ${student ? 'occupied' : ''} ${isBlocked ? 'blocked' : ''}" data-room="${Number(room.id)}" data-place="${esc(place)}" data-row="${row}" data-desk="${desk}" ${student && !isBlocked ? `draggable="true" data-student="${Number(student.id)}"` : ''} aria-label="Кабинет ${Number(room.номер_кабинета)}, место ${esc(place)}: ${esc(isBlocked ? 'заблокировано' : student ? fullName(student) : 'свободно')}" title="${esc(student ? fullName(student) : isBlocked ? 'Место заблокировано' : 'Свободное место')}"><span class="desk-place">${esc(place)}</span><span class="desk-name">${esc(isBlocked ? 'Закрыто' : student ? `${student.фимилия} ${String(student.имя || '').charAt(0)}.` : 'Свободно')}</span>${student && !isBlocked ? `<span>${esc(student.паралель)} класс</span>` : ''}</button>`;
  }
  function render() {
    document.getElementById('totalStudents').textContent = students.length;
    const placed = students.filter(student => student.номер_кабинета != null && student.номер_места).length;
    document.getElementById('placedStudents').textContent = placed;
    document.getElementById('unplacedStudents').textContent = students.length - placed;
    if (!classrooms.length) { container.innerHTML = '<div class="empty-state"><h3>Добавьте кабинеты для рассадки</h3><p>Сначала укажите вместимость кабинетов и количество рядов.</p><a class="btn btn-primary" href="/kabinet">Настроить кабинеты</a></div>'; return; }
    container.innerHTML = classrooms.map(room => {
      const rows = Number(room.количество_рядов_парт);
      const count = Number(room.количество_парт);
      const desksPerRow = Math.ceil(count / rows);
      let layout = '';
      for (let desk = 1; desk <= desksPerRow; desk++) {
        layout += `<div class="desk-layout-row"><span class="row-label">${desk}</span>`;
        for (let row = 1; row <= rows; row++) {
          if ((row - 1) * desksPerRow + desk > count) { layout += '<div class="desk-void"></div>'; continue; }
          layout += `<div class="desk-pair">${seatButton(room,`${desk}${letters[(row - 1) * 2]}`,row,desk)}${seatButton(room,`${desk}${letters[(row - 1) * 2 + 1]}`,row,desk)}</div>`;
        }
        layout += '</div>';
      }
      const occupied = students.filter(student => Number(student.номер_кабинета) === Number(room.номер_кабинета) && student.номер_места).length;
      return `<article class="classroom"><div class="classroom-header"><div><div class="classroom-title">Кабинет №${esc(room.номер_кабинета)}</div><div class="classroom-info">${rows} рядов · ${count} парт · ${esc(room.этаж)} этаж</div></div><span class="badge">${occupied} из ${count * 2} мест</span></div><div class="classroom-layout"><div class="desk-layout">${layout}</div></div></article>`;
    }).join('');
  }
  async function refresh() {
    try {
      const [roster,places] = await Promise.all([Exam.request('/api/students'),Promise.all(classrooms.map(room => Exam.request(`/api/classrooms/${Number(room.id)}/blocked-places`)))]);
      students = roster.students || [];
      blocked = new Map(classrooms.map((room,index) => [Number(room.id),places[index].blockedPlaces || []]));
      render();
    } catch (error) { Exam.message(document.getElementById('globalMessage'),error.message); }
  }
  async function place(studentId,room,placeNumber) {
    try {
      const data = {studentId:Number(studentId),classroomNumber:Number(room.номер_кабинета),placeNumber};
      const check = await Exam.json('/api/check-placement','POST',data);
      if (!check.canPlace) throw new Error(check.error || 'Участника нельзя разместить на этом месте: нарушены правила рассадки.');
      await Exam.json('/api/students/place','PUT',data);
      dialog.close(); await refresh(); Exam.toast('Место участника обновлено.');
    } catch (error) { throw error; }
  }
  function showSeat(button) {
    const room = classrooms.find(item => Number(item.id) === Number(button.dataset.room));
    chosenSeat = {room,place:button.dataset.place,row:Number(button.dataset.row),desk:Number(button.dataset.desk)};
    const student = seatStudent(room,chosenSeat.place);
    chosenStudent = student;
    const isBlocked = (blocked.get(Number(room.id)) || []).includes(chosenSeat.place);
    const details = student ? `<p><strong>${esc(fullName(student))}</strong></p><p>${esc(student.паралель)} класс · ${esc(student.предмет)}</p>` : `<p>${isBlocked ? 'Место заблокировано для рассадки.' : 'Место свободно.'}</p>`;
    openDialog(`Кабинет №${room.номер_кабинета} · Место ${chosenSeat.place}`,`<div class="seat-details">${details}</div><div class="button-row">${isBlocked ? '<button class="btn btn-primary" data-action="unblock">Разблокировать</button>' : student ? '<button class="btn btn-primary" data-action="move-student">Переместить участника</button><button class="btn btn-secondary" data-action="remove-student">Снять с места</button><button class="btn btn-quiet" data-action="block">Заблокировать место</button>' : '<button class="btn btn-primary" data-action="choose-student">Назначить участника</button><button class="btn btn-secondary" data-action="move-desk">Поменять парты местами</button><button class="btn btn-quiet" data-action="block">Заблокировать место</button>'}</div>`);
  }
  async function showUnplaced() {
    try {
      const result = await Exam.request('/api/students/unplaced');
      const roster = result.students || [];
      openDialog('Выберите участника',roster.length ? `<div class="form-field"><label for="studentSearch">Поиск по имени</label><input id="studentSearch" type="search" placeholder="Фамилия или имя"></div><div class="seat-options">${roster.map(student => `<button class="btn btn-secondary seat-option" data-place-student="${Number(student.id)}" data-search="${esc(fullName(student).toLowerCase())}"><span>${esc(fullName(student))}<br><small>${esc(student.паралель)} класс · ${esc(student.предмет)}</small></span></button>`).join('')}</div>` : '<div class="empty-state"><p>Все участники уже размещены или список пуст.</p></div>');
    } catch (error) { throw error; }
  }
  async function showFreePlaces() {
    try {
      const results = await Promise.all(classrooms.map(room => Exam.request(`/api/classrooms/${Number(room.id)}/free-places`)));
      const html = classrooms.map((room,index) => (results[index].freePlaces || []).length ? `<section><h3>Кабинет №${esc(room.номер_кабинета)}</h3><div class="places-grid">${results[index].freePlaces.map(place => `<button class="btn btn-secondary" data-new-place="${esc(place)}" data-room="${Number(room.id)}">${esc(place)}</button>`).join('')}</div></section>` : '').join('');
      openDialog(`Переместить: ${fullName(chosenStudent)}`,html || '<p class="muted">Свободных мест нет.</p>');
    } catch (error) { throw error; }
  }
  async function showDesks() {
    try {
      const result = await Exam.request(`/api/classrooms/${Number(chosenSeat.room.id)}/available-desks?currentRow=${chosenSeat.row}&currentDesk=${chosenSeat.desk}`);
      openDialog('Поменять парты местами',`<p class="muted">Текущее положение: ряд ${chosenSeat.row}, парта ${chosenSeat.desk}.</p><div class="places-grid">${(result.availableDesks || []).map(desk => `<button class="btn btn-secondary" data-move-row="${Number(desk.row)}" data-move-desk="${Number(desk.desk)}">${esc(desk.display)}</button>`).join('') || '<p>Нет доступных позиций.</p>'}</div>`);
    } catch (error) { throw error; }
  }
  content.addEventListener('input',event => {
    if (event.target.id !== 'studentSearch') return;
    const search = event.target.value.trim().toLowerCase();
    content.querySelectorAll('[data-search]').forEach(button => { button.hidden = !button.dataset.search.includes(search); });
  });
  content.addEventListener('click',async event => {
    const button = event.target.closest('button'); if (!button) return;
    Exam.message(errorBox,'');
    try {
      await Exam.busy(button,'Выполняем…',async () => {
        try {
          if (button.dataset.action === 'choose-student') return await showUnplaced();
          if (button.dataset.action === 'move-student') return await showFreePlaces();
          if (button.dataset.action === 'move-desk') return await showDesks();
          if (button.dataset.placeStudent) return await place(button.dataset.placeStudent,chosenSeat.room,chosenSeat.place);
          if (button.dataset.newPlace) return await place(chosenStudent.id,classrooms.find(room => Number(room.id) === Number(button.dataset.room)),button.dataset.newPlace);
          if (button.dataset.moveRow) {
            await Exam.json(`/api/classrooms/${Number(chosenSeat.room.id)}/move-desk`,'PUT',{fromRow:chosenSeat.row,fromDesk:chosenSeat.desk,toRow:Number(button.dataset.moveRow),toDesk:Number(button.dataset.moveDesk)});
          } else if (button.dataset.action === 'remove-student') {
            await Exam.json('/api/students/place','PUT',{studentId:Number(chosenStudent.id),classroomNumber:null,placeNumber:null});
          } else if (['block','unblock'].includes(button.dataset.action)) {
            await Exam.json(`/api/classrooms/${Number(chosenSeat.room.id)}/block-place`,'PUT',{placeNumber:chosenSeat.place,blocked:button.dataset.action === 'block'});
          } else return;
          dialog.close(); await refresh(); Exam.toast('Изменения сохранены.');
        } catch (error) { throw error; }
      });
    } catch (error) { Exam.message(errorBox,error.message); }
  });
  container.addEventListener('click',event => { const button = event.target.closest('.desk'); if (button) showSeat(button); });
  container.addEventListener('dragstart',event => {
    const button = event.target.closest('[data-student]');
    if (!button) return;
    draggedId = Number(button.dataset.student);
    event.dataTransfer.setData('text/plain',String(draggedId)); event.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover',event => { const button = event.target.closest('.desk:not(.blocked):not(.occupied)'); if (button) { event.preventDefault(); button.classList.add('drag-over'); } });
  container.addEventListener('dragleave',event => { event.target.closest('.desk')?.classList.remove('drag-over'); });
  container.addEventListener('drop',async event => {
    const button = event.target.closest('.desk:not(.blocked):not(.occupied)'); if (!button) return;
    event.preventDefault(); button.classList.remove('drag-over');
    try { const id = draggedId || Number(event.dataTransfer.getData('text/plain')); if (id) await place(id,classrooms.find(room => Number(room.id) === Number(button.dataset.room)),button.dataset.place); }
    catch (error) { Exam.toast(error.message,'error'); }
    finally { draggedId = null; }
  });
  document.getElementById('seatingForm').addEventListener('submit',async event => {
    event.preventDefault(); const subject = document.getElementById('subjectSelect').value;
    if (!subject) return;
    try {
      const result = await Exam.busy(document.getElementById('generateButton'),'Распределяем…',() => Exam.json('/api/generate-seating','POST',{subject}));
      await refresh(); const stats = result.stats;
      Exam.message(document.getElementById('globalMessage'),stats ? `Рассадка сформирована. Размещено: ${stats.seatingCount}. Без места: ${stats.unplacedCount || 0}.` : 'Рассадка сформирована.','success');
    } catch (error) { Exam.message(document.getElementById('globalMessage'),error.message); }
  });
  [['clearSeating','/api/clear-seating','Снять всех участников с мест? Список участников сохранится.'],['clearStudents','/api/clear-all-data','Удалить всех участников? Это действие нельзя отменить.']].forEach(([id,path,confirmation]) => {
    document.getElementById(id).addEventListener('click',async event => {
      if (!window.confirm(confirmation)) return;
      try { await Exam.busy(event.currentTarget,'Выполняем…',() => Exam.request(path,{method:'POST'})); await refresh(); Exam.toast('Изменения сохранены.'); }
      catch (error) { Exam.message(document.getElementById('globalMessage'),error.message); }
    });
  });
  document.getElementById('exportSeating').addEventListener('click',async event => {
    try {
      const data = await Exam.busy(event.currentTarget,'Экспортируем…',() => Exam.request('/api/export-seating'));
      const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'exam-seating.json'; link.click(); URL.revokeObjectURL(url);
    } catch (error) { Exam.toast(error.message,'error'); }
  });
  document.getElementById('importFile').addEventListener('change',async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Размер файла не должен превышать 20 МБ.');
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.students) || !data.students.length) throw new Error('JSON должен содержать непустой массив students.');
      await Exam.json('/api/import-seating','POST',{data}); await refresh(); Exam.toast('Рассадка импортирована.');
    } catch (error) { Exam.message(document.getElementById('globalMessage'),error instanceof SyntaxError ? 'Некорректный JSON. Проверьте формат файла.' : error.message); }
    finally { event.target.value = ''; }
  });
  render(); refresh();
})();
